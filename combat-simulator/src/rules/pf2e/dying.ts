import type { CombatantState, CombatMemory } from "../../memory/combatMemory.js";
import type { SeededRng } from "./rng.js";

/** Default PF2e death threshold (Dying value that kills you). */
export const DYING_DEATH_VALUE = 4;

export type VitalState = "ok" | "unconscious" | "dying" | "dead";

export type VitalStatus = {
  state: VitalState;
  dying: number;
  wounded: number;
  /** Short label for roster/UI, e.g. "Dying 2 (unconscious)". */
  label: string;
  /** PF2e timing / what happens next. */
  note: string;
};

export type RecoveryOutcome = "crit_success" | "success" | "failure" | "crit_failure";

export type RecoveryResult = {
  d20: number;
  dc: number;
  outcome: RecoveryOutcome;
  dyingBefore: number;
  dyingAfter: number;
  died: boolean;
  stabilized: boolean;
  line: string;
};

function condValue(c: CombatantState, name: string): number {
  const hit = c.conditions.find((x) => x.name === name);
  return hit?.value ?? 0;
}

function setCond(c: CombatantState, name: string, value: number | undefined): void {
  c.conditions = c.conditions.filter((x) => x.name !== name);
  if (value != null && value > 0) {
    c.conditions.push({ id: name, name, value });
  }
}

function setFlag(c: CombatantState, name: string, on: boolean): void {
  c.conditions = c.conditions.filter((x) => x.name !== name);
  if (on) c.conditions.push({ id: name, name });
}

export function dyingValue(c: CombatantState): number {
  return condValue(c, "dying");
}

export function woundedValue(c: CombatantState): number {
  return condValue(c, "wounded");
}

export function isDead(c: CombatantState): boolean {
  return c.conditions.some((x) => x.name === "dead") || dyingValue(c) >= DYING_DEATH_VALUE;
}

export function isUnconscious(c: CombatantState): boolean {
  if (isDead(c)) return false;
  return c.hp <= 0 || c.conditions.some((x) => x.name === "unconscious");
}

export function isDying(c: CombatantState): boolean {
  return !isDead(c) && dyingValue(c) > 0;
}

/** Keep legacy `downed` in sync: cannot act while dead, dying, or unconscious at 0 HP. */
export function syncDowned(c: CombatantState): void {
  c.downed = isDead(c) || c.hp <= 0 || dyingValue(c) > 0;
}

function markDead(c: CombatantState, reason: string): void {
  c.hp = 0;
  setCond(c, "dying", undefined);
  setFlag(c, "unconscious", false);
  setFlag(c, "dead", true);
  c.downed = true;
  void reason;
}

/**
 * Apply HP loss with PF2e zero-HP / dying rules.
 * - Dropping to 0: gain Dying (1 + Wounded), +1 if the hit was a crit.
 * - Already at 0: increase Dying by 1 (by 2 on a crit).
 * (PF2e has no D&D-style "massive damage = instant death" from high HP loss alone.)
 */
export function applyIncomingDamage(
  target: CombatantState,
  damage: number,
  opts?: { critical?: boolean },
): { died: boolean; dropped: boolean; dying: number } {
  if (damage <= 0 || isDead(target)) {
    syncDowned(target);
    return { died: isDead(target), dropped: false, dying: dyingValue(target) };
  }

  const crit = !!opts?.critical;
  const wasUp = target.hp > 0;

  if (wasUp) {
    target.hp = Math.max(0, target.hp - damage);
    if (target.hp > 0) {
      syncDowned(target);
      return { died: false, dropped: false, dying: dyingValue(target) };
    }
    // Reduced to 0 HP → Dying 1 + Wounded, +1 if critical hit.
    let dying = 1 + woundedValue(target);
    if (crit) dying += 1;
    setCond(target, "dying", dying);
    setFlag(target, "unconscious", true);
    setFlag(target, "dead", false);
    if (dying >= DYING_DEATH_VALUE) {
      markDead(target, "dying reached maximum on drop");
      return { died: true, dropped: true, dying: 0 };
    }
    syncDowned(target);
    return { died: false, dropped: true, dying };
  }

  // Already at 0 HP: taking damage increases Dying (unconscious → dying if needed).
  let dying = dyingValue(target);
  if (dying <= 0) dying = 1;
  else dying += 1;
  if (crit) dying += 1;
  setCond(target, "dying", dying);
  setFlag(target, "unconscious", true);
  if (dying >= DYING_DEATH_VALUE) {
    markDead(target, "dying reached maximum");
    return { died: true, dropped: false, dying: 0 };
  }
  syncDowned(target);
  return { died: false, dropped: false, dying };
}

/** Healing while dying/unconscious: HP > 0 clears dying & unconscious and increases Wounded. */
export function applyHealing(target: CombatantState, amount: number): number {
  if (amount <= 0 || isDead(target)) return 0;
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  const healed = target.hp - before;
  if (target.hp > 0) {
    const hadDying = dyingValue(target) > 0 || before <= 0;
    setCond(target, "dying", undefined);
    setFlag(target, "unconscious", false);
    if (hadDying) {
      setCond(target, "wounded", woundedValue(target) + 1);
    }
  }
  syncDowned(target);
  return healed;
}

/**
 * PF2e recovery check at the start of your turn while Dying.
 * Flat check DC 10 + Dying value.
 */
export function runDyingRecoveryCheck(actor: CombatantState, rng: SeededRng): RecoveryResult | null {
  if (isDead(actor) || dyingValue(actor) <= 0) return null;

  const dyingBefore = dyingValue(actor);
  const dc = 10 + dyingBefore;
  const d20 = rng.d20();
  const successBy = d20 - dc;
  let outcome: RecoveryOutcome;
  if (d20 === 20 || successBy >= 10) outcome = "crit_success";
  else if (d20 === 1 || successBy <= -10) outcome = "crit_failure";
  else if (d20 >= dc) outcome = "success";
  else outcome = "failure";

  let dyingAfter = dyingBefore;
  if (outcome === "crit_success") dyingAfter = Math.max(0, dyingBefore - 2);
  else if (outcome === "success") dyingAfter = Math.max(0, dyingBefore - 1);
  else if (outcome === "failure") dyingAfter = dyingBefore + 1;
  else dyingAfter = dyingBefore + 2;

  if (dyingAfter <= 0) {
    setCond(actor, "dying", undefined);
    setFlag(actor, "unconscious", true);
    actor.hp = 0;
  } else if (dyingAfter >= DYING_DEATH_VALUE) {
    markDead(actor, "failed recovery check");
    dyingAfter = 0;
  } else {
    setCond(actor, "dying", dyingAfter);
    setFlag(actor, "unconscious", true);
  }
  syncDowned(actor);

  const died = isDead(actor);
  const stabilized = !died && dyingValue(actor) === 0 && actor.hp <= 0;
  const outcomeLabel =
    outcome === "crit_success"
      ? "critical success"
      : outcome === "crit_failure"
        ? "critical failure"
        : outcome;
  const line = died
    ? `  ${actor.name} recovery check ${d20} vs DC ${dc} (${outcomeLabel}) — dies at Dying ${DYING_DEATH_VALUE}`
    : stabilized
      ? `  ${actor.name} recovery check ${d20} vs DC ${dc} (${outcomeLabel}) — Dying cleared; still unconscious at 0 HP (stable)`
      : `  ${actor.name} recovery check ${d20} vs DC ${dc} (${outcomeLabel}) — Dying ${dyingBefore} → ${dyingValue(actor)}`;

  return {
    d20,
    dc,
    outcome,
    dyingBefore,
    dyingAfter: died ? DYING_DEATH_VALUE : dyingValue(actor),
    died,
    stabilized,
    line,
  };
}

export function describeVitalStatus(c: CombatantState): VitalStatus {
  const dying = dyingValue(c);
  const wounded = woundedValue(c);
  if (isDead(c)) {
    return {
      state: "dead",
      dying: 0,
      wounded,
      label: "dead",
      note: "Dead (Dying reached 4). Only magic that can restore life would help — outside this sim.",
    };
  }
  if (dying > 0) {
    const failsLeft = DYING_DEATH_VALUE - dying;
    return {
      state: "dying",
      dying,
      wounded,
      label: `Dying ${dying} (unconscious)`,
      note:
        `PF2e: dies at Dying ${DYING_DEATH_VALUE}. At the start of each of their turns they attempt a recovery check (flat DC ${10 + dying}). ` +
        `Without healing, at most ${failsLeft} failed recovery check${failsLeft === 1 ? "" : "s"} ` +
        `(~${failsLeft} of their turn${failsLeft === 1 ? "" : "s"}) remain before death; a critical failure increases Dying by 2 and can kill sooner. ` +
        `Any healing that raises HP above 0 removes Dying and increases Wounded.`,
    };
  }
  if (c.hp <= 0 || c.conditions.some((x) => x.name === "unconscious")) {
    return {
      state: "unconscious",
      dying: 0,
      wounded,
      label: "unconscious (stable)",
      note:
        "PF2e: at 0 HP with no Dying value — unconscious but stable. They do not make recovery checks and will not die from Dying progression, but any new damage makes them Dying again. They stay unconscious until healed above 0 HP.",
    };
  }
  const woundedNote =
    wounded > 0
      ? ` Wounded ${wounded}: if reduced to 0 HP again, Dying starts at ${1 + wounded}.`
      : "";
  return {
    state: "ok",
    dying: 0,
    wounded,
    label: wounded > 0 ? `ok (Wounded ${wounded})` : "ok",
    note: woundedNote.trim() || "Conscious and above 0 HP.",
  };
}

export function formatVitalRosterLine(c: CombatantState): string {
  const v = describeVitalStatus(c);
  const wounded = v.wounded > 0 && v.state !== "ok" ? ` Wounded ${v.wounded}` : "";
  if (v.state === "ok") {
    return v.wounded > 0 ? `Wounded ${v.wounded}` : "";
  }
  return `${v.label}${wounded}`;
}

/** Push recovery / death events onto the combat log stream. */
export function recordRecoveryEvent(
  mem: CombatMemory,
  actor: CombatantState,
  result: RecoveryResult,
): void {
  mem.events.push({
    t: "recovery_check",
    round: mem.round,
    actor: actor.id,
    d20: result.d20,
    dc: result.dc,
    outcome: result.outcome,
    dyingBefore: result.dyingBefore,
    dyingAfter: result.dyingAfter,
    died: result.died,
  });
  if (result.died) {
    mem.events.push({
      t: "death",
      round: mem.round,
      actor: actor.id,
      reason: "failed recovery check",
    });
  }
}
