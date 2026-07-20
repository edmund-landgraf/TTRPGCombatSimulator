import type { CombatantState, CombatMemory } from "../../memory/combatMemory.js";
import { living } from "../../memory/combatMemory.js";
import { chebyshev } from "../../map/grid.js";
import { canCastSpell } from "./spell.js";

/**
 * PF2e Delay (Player Core / free action, trigger: your turn begins).
 * You wait for the right moment — removed from initiative until you return
 * after another creature’s turn ends (permanently changes your initiative).
 * No reactions while Delayed. If you never return for a full round, the
 * Delayed turn is lost and initiative stays at the original slot.
 * @see https://2e.aonprd.com/Actions.aspx?ID=2294
 */

export function isCaster(actor: CombatantState): boolean {
  return actor.spells.some((s) => s.kind === "attack" || s.kind === "save" || s.kind === "heal");
}

export function isMeleePrimary(actor: CombatantState): boolean {
  const melee = actor.weapons.some((w) => w.kind === "melee");
  const ranged = actor.weapons.some((w) => w.kind === "ranged");
  const offensiveCaster = actor.spells.some((s) => s.kind === "attack" || s.kind === "save");
  return melee && !ranged && !offensiveCaster;
}

export function canCastOffensivelyNow(mem: CombatMemory, actor: CombatantState): boolean {
  const foes = living(mem, actor.side === "party" ? "enemy" : "party");
  for (const spell of actor.spells) {
    if (spell.kind === "heal") continue;
    for (const foe of foes) {
      if (canCastSpell(mem, actor, foe, spell)) return true;
    }
  }
  return false;
}

export function nearestFoeDist(mem: CombatMemory, actor: CombatantState): number {
  const foes = living(mem, actor.side === "party" ? "enemy" : "party");
  let best = Infinity;
  for (const f of foes) best = Math.min(best, chebyshev(actor.pos, f.pos));
  return best;
}

/** Commit Delay at turn start: leave initiative, no reactions until return. */
export function applyDelay(mem: CombatMemory, actor: CombatantState, log: string[]): void {
  const originalIndex = mem.initiative.indexOf(actor.id);
  mem.delayed.set(actor.id, {
    round: mem.round,
    originalIndex: originalIndex < 0 ? mem.initiative.length : originalIndex,
  });
  mem.initiative = mem.initiative.filter((id) => id !== actor.id);
  actor.reactionAvailable = false;
  actor.actionsLeft = 0;
  log.push(`--- ${actor.id} (${actor.name}) ---`);
  log.push("  Delay (removed from initiative until a later turn ends)");
  mem.events.push({
    t: "delay",
    round: mem.round,
    actor: actor.id,
    originalIndex: originalIndex < 0 ? 0 : originalIndex,
  });
}

/** Return after `afterId`'s turn: splice into initiative and restore reactions. */
export function returnFromDelay(
  mem: CombatMemory,
  actorId: string,
  afterId: string,
  log: string[],
): boolean {
  const entry = mem.delayed.get(actorId);
  const actor = mem.combatants.get(actorId);
  if (!entry || !actor || actor.downed) return false;

  mem.delayed.delete(actorId);
  mem.initiative = mem.initiative.filter((id) => id !== actorId);
  const afterIdx = mem.initiative.indexOf(afterId);
  const insertAt = afterIdx >= 0 ? afterIdx + 1 : mem.initiative.length;
  mem.initiative.splice(insertAt, 0, actorId);
  actor.reactionAvailable = true;

  log.push(`  ${actor.id} returns from Delay (after ${afterId})`);
  mem.events.push({
    t: "delay_return",
    round: mem.round,
    actor: actorId,
    after: afterId,
  });
  return true;
}

/** End of round: Delayed actors who never returned lose the turn; restore init slot. */
export function forfeitExpiredDelays(mem: CombatMemory, log: string[]): void {
  for (const [id, entry] of [...mem.delayed.entries()]) {
    if (entry.round !== mem.round) continue;
    const actor = mem.combatants.get(id);
    mem.delayed.delete(id);
    if (!actor) continue;
    // Initiative unchanged from original slot (re-insert at originalIndex).
    mem.initiative = mem.initiative.filter((x) => x !== id);
    const at = Math.min(entry.originalIndex, mem.initiative.length);
    mem.initiative.splice(at, 0, id);
    actor.reactionAvailable = true;
    log.push(`  ${actor.id} Delay expires — turn lost; initiative restored`);
    mem.events.push({ t: "delay_forfeit", round: mem.round, actor: id });
  }
}

/**
 * AI: Delay when waiting is better than acting now.
 * Casters who can already cast do not Delay (especially round 1 — open with magic).
 */
export function wantDelay(mem: CombatMemory, actor: CombatantState): boolean {
  if (mem.delayed.has(actor.id)) return false;
  if (actor.downed) return false;
  // Already Delayed this round (and returned) — take the turn, don't loop Delay.
  if (
    mem.events.some(
      (e) => e.t === "delay" && e.actor === actor.id && e.round === mem.round,
    )
  ) {
    return false;
  }

  // Never Delay out of a legal cast — wizards should open with spells.
  if (canCastOffensivelyNow(mem, actor)) return false;
  const heal = actor.spells.find((s) => s.kind === "heal");
  if (heal) {
    for (const a of living(mem, actor.side)) {
      if (a.hp / a.maxHp < 0.35 && canCastSpell(mem, actor, a, heal)) return false;
    }
  }

  const weight = actor.aiProfile.weights["Delay"] ?? 0.35;
  if (weight < 0.15) return false;

  const dist = nearestFoeDist(mem, actor);
  if (!Number.isFinite(dist)) return false;

  // Melee who cannot reach this turn: wait for allies to soften / pull.
  if (isMeleePrimary(actor) && dist > actor.speedCells) {
    const alliesLater = living(mem, actor.side).some(
      (a) => a.id !== actor.id && mem.initiative.includes(a.id),
    );
    if (alliesLater && mem.round <= 2) return true;
  }

  // Soft Delay: early round, out of all offense, ally still to act.
  const hasRanged = actor.weapons.some((w) => w.kind === "ranged");
  if (!hasRanged && !isCaster(actor) && dist > actor.speedCells && mem.round === 1) {
    return living(mem, actor.side).some((a) => a.id !== actor.id && mem.initiative.includes(a.id));
  }

  return false;
}

/**
 * AI: return from Delay after a useful ally turn, or before the round would forfeit.
 */
export function wantReturnAfter(
  mem: CombatMemory,
  delayedId: string,
  justActedId: string,
  turnsRemainingInRound: number,
): boolean {
  const actor = mem.combatants.get(delayedId);
  const just = mem.combatants.get(justActedId);
  if (!actor || !mem.delayed.has(delayedId)) return false;
  if (actor.downed) return false;

  // Must return before round ends or the turn is lost.
  if (turnsRemainingInRound <= 0) return true;

  if (just && just.side === actor.side && just.id !== actor.id) {
    // After an ally acted: return if we can cast/strike or close meaningfully.
    if (canCastOffensivelyNow(mem, actor)) return true;
    if (isMeleePrimary(actor) && nearestFoeDist(mem, actor) <= actor.speedCells + 1) return true;
    // Ally finished — classic “act after the setup” return.
    if (mem.round <= 2) return true;
  }

  return false;
}
