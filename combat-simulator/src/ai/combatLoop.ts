import type { CombatantState, Condition } from "../memory/combatMemory.js";
import { hasCover, hasLineOfSight } from "../map/grid.js";
import { chebyshev } from "../map/grid.js";
import type { CombatMemory } from "../memory/combatMemory.js";
import { living } from "../memory/combatMemory.js";
import { groupFlags } from "./tacticsGroups.js";

/** Grandmaster Combat Loop Core — v1.0.0 */
export const COMBAT_LOOP_VERSION = "1.0.0";

export const COMBAT_LOOP_SEQUENCE = [
  "status_assessment",
  "spatiotemporal_positioning",
  "tactical_target_selection",
  "action_packet_execution",
  "end_of_turn_mitigation",
  "off_turn_reaction_precompute",
] as const;

export type CombatLoopPhase = (typeof COMBAT_LOOP_SEQUENCE)[number];

const PERSISTENT_NAMES = new Set([
  "persistent_damage",
  "persistent",
  "burning",
  "bleeding",
  "bleed",
  "acid",
  "fire",
]);

function condValue(c: Condition): number {
  return c.value ?? 1;
}

export function findCondition(
  actor: CombatantState,
  names: string | string[],
): Condition | undefined {
  const set = new Set((Array.isArray(names) ? names : [names]).map((n) => n.toLowerCase()));
  return actor.conditions.find((c) => set.has(c.name.toLowerCase()) || set.has(c.id.toLowerCase()));
}

/** Persistent damage threat: HP <= 2× tick (critical failure state). */
export function persistentThreat(
  actor: CombatantState,
): { condition: Condition; tick: number } | null {
  for (const c of actor.conditions) {
    const n = c.name.toLowerCase();
    if (!PERSISTENT_NAMES.has(n) && !n.includes("persistent")) continue;
    const tick = Math.max(1, condValue(c));
    if (actor.hp <= tick * 2) return { condition: c, tick };
  }
  return null;
}

/** Frightened/Sickened ≥ 2 — do not burn MAP-0 attacks or ranked slots. */
export function heavyStatusPenalty(actor: CombatantState): Condition | undefined {
  for (const name of ["frightened", "sickened"]) {
    const c = findCondition(actor, name);
    if (c && condValue(c) >= 2) return c;
  }
  return undefined;
}

export type ClassPacket = "fighter" | "bard" | "monk" | "wizard" | "other";

/** Legacy class-packet label for tactics skills; prefers build-profile mapping. */
export function classPacketOf(actor: CombatantState): ClassPacket {
  // Lazy import avoided — mirror buildProfile.legacyClassPacket mapping.
  const r = actor.role.toLowerCase();
  const g = actor.tacticsGroup;
  const classId = (actor.classId || "").toLowerCase();
  if (classId === "monk" || r.includes("monk")) return "monk";
  if (classId === "bard" || r.includes("bard") || g === "buff_debuff") return "bard";
  if (
    classId === "wizard" ||
    classId === "monster_caster" ||
    classId === "monster_controller" ||
    r.includes("wizard") ||
    r.includes("sorcerer") ||
    r.includes("mage") ||
    g === "blaster" ||
    g === "battlefield_control"
  ) {
    return "wizard";
  }
  // Rogue / flanker → monk skirmish legacy packet for existing skills.
  if (classId === "rogue" || classId === "monster_skirmisher" || r.includes("rogue") || g === "flanker") {
    return "monk";
  }
  if (
    classId === "fighter" ||
    classId === "champion" ||
    classId === "cleric" ||
    classId === "barbarian" ||
    classId === "monster_brute" ||
    r.includes("fighter") ||
    r.includes("champion") ||
    r.includes("blade") ||
    r.includes("soldier") ||
    r.includes("warrior") ||
    r.includes("cleric") ||
    g === "frontliner" ||
    g === "healer"
  ) {
    return "fighter";
  }
  if (g === "archer" || classId === "ranger_archer") return "other";
  return "other";
}

export function isBruteRole(role: string): boolean {
  const r = role.toLowerCase();
  return (
    r.includes("blade") ||
    r.includes("brute") ||
    r.includes("fighter") ||
    r.includes("soldier") ||
    r.includes("warrior") ||
    r.includes("barbarian") ||
    r.includes("ogre") ||
    r.includes("troll")
  );
}

export function isCasterSquishRole(role: string): boolean {
  const r = role.toLowerCase();
  return (
    r.includes("wizard") ||
    r.includes("shaman") ||
    r.includes("sorcerer") ||
    r.includes("mage") ||
    r.includes("archer") ||
    r.includes("priest")
  );
}

export function isMindlessRole(role: string): boolean {
  const r = role.toLowerCase();
  return (
    r.includes("animal") ||
    r.includes("mindless") ||
    r.includes("zombie") ||
    r.includes("skeleton") ||
    r.includes("berserker") ||
    r.includes("beast")
  );
}

/** Among living foes, lowest saveBonus (wizard save-arbitrage proxy). */
export function weakestSaveFoe(
  mem: CombatMemory,
  actor: CombatantState,
): CombatantState | undefined {
  return living(mem, actor.side === "party" ? "enemy" : "party")
    .slice()
    .sort((a, b) => a.saveBonus - b.saveBonus || a.hp - b.hp)[0];
}

/** Lowest AC living foe (squishy / attack-roll focus). */
export function lowestAcFoe(
  mem: CombatMemory,
  actor: CombatantState,
): CombatantState | undefined {
  return living(mem, actor.side === "party" ? "enemy" : "party")
    .slice()
    .sort((a, b) => a.ac - b.ac || a.hp - b.hp)[0];
}

/** Ranged foe has LOS to actor (EoT take-cover cue). */
export function threatenedByRangedLos(
  mem: CombatMemory,
  actor: CombatantState,
): boolean {
  const foes = living(mem, actor.side === "party" ? "enemy" : "party");
  return foes.some((f) => {
    const ranged = f.weapons.some((w) => w.kind === "ranged");
    const caster = f.spells.some((s) => s.kind === "attack" || s.kind === "save");
    if (!ranged && !caster) return false;
    return hasLineOfSight(mem.grid, f.pos, actor.pos);
  });
}

export function alreadyHasCover(mem: CombatMemory, actor: CombatantState): boolean {
  return hasCover(mem.grid, actor.pos);
}

/** Pre-compute reaction intent for logging / future reaction engine. */
export type ReactionPlan = {
  reactiveStrike: boolean;
  shieldBlock: boolean;
  note: string;
};

export function precomputeReactions(actor: CombatantState): ReactionPlan {
  const packet = classPacketOf(actor);
  const flags = groupFlags(actor);
  const caps = new Set(actor.capabilities ?? []);
  const archetypes = new Set(actor.archetypes ?? []);
  const hasChampionDedication =
    archetypes.has("champion_dedication") ||
    archetypes.has("Champion") ||
    [...archetypes].some((t) => t.toLowerCase() === "champion");
  const hasReactive =
    caps.has("reactive_strike") ||
    hasChampionDedication ||
    (flags.preferMelee && !flags.keepDistance && packet === "fighter");
  const reactiveStrike = actor.reactionAvailable && hasReactive;
  const shieldBlock =
    actor.reactionAvailable &&
    (caps.has("shield_block") ||
      (packet === "fighter" && (actor.shieldHardness ?? 0) > 0) ||
      packet === "fighter");
  const parts: string[] = [];
  if (reactiveStrike) parts.push("Reactive Strike armed (planned)");
  if (shieldBlock) parts.push("Shield Block intent (planned)");
  if (parts.length === 0) parts.push("no reaction pre-armed");
  return { reactiveStrike, shieldBlock, note: parts.join("; ") };
}

export function nearFinishTarget(foe: CombatantState): boolean {
  return foe.hp <= 6 || foe.hp / foe.maxHp <= 0.25;
}

export function dist(a: CombatantState, b: CombatantState): number {
  return chebyshev(a.pos, b.pos);
}
