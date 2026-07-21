/**
 * PF2e concealment from fog / mist.
 *
 * Not a −2 to hit: when a creature is concealed, the attacker must succeed at a
 * DC 5 flat check before rolling the attack / effect. Fail → no effect (actions spent).
 *
 * Fog Cloud model: creatures in fog are concealed, and creatures outside fog are
 * concealed to those inside — so either end of the attack in fog triggers the check.
 * Area effects skip the flat check.
 */
import type { CombatantState, CombatMemory } from "../../memory/combatMemory.js";
import { isFogTags } from "../../memory/schemas.js";
import { cellId } from "../../memory/schemas.js";
import type { SeededRng } from "./rng.js";

export const CONCEALED_FLAT_DC = 5;

/** Chance a DC 5 flat check succeeds (d20 ≥ 5). */
export const CONCEALED_HIT_FACTOR = 16 / 20;

export function cellHasFog(mem: CombatMemory, pos: { x: number; y: number }): boolean {
  const tags = mem.grid.walkable.get(cellId(pos))?.tags ?? [];
  return isFogTags(tags);
}

export function actorInFog(mem: CombatMemory, actor: CombatantState): boolean {
  return cellHasFog(mem, actor.pos);
}

/**
 * True when fog makes the target concealed from the attacker
 * (attacker in fog, target in fog, or both — Fog Cloud mutual concealment).
 */
export function fogConcealsTarget(
  mem: CombatMemory,
  attacker: CombatantState,
  target: CombatantState,
): boolean {
  return actorInFog(mem, attacker) || actorInFog(mem, target);
}

export type ConcealedFlatResult = {
  required: boolean;
  d20: number;
  dc: number;
  passed: boolean;
};

/** Roll the concealment flat check when fog applies; otherwise pass through. */
export function rollConcealedFlat(
  mem: CombatMemory,
  attacker: CombatantState,
  target: CombatantState,
  rng: SeededRng,
): ConcealedFlatResult {
  if (!fogConcealsTarget(mem, attacker, target)) {
    return { required: false, d20: 0, dc: CONCEALED_FLAT_DC, passed: true };
  }
  const d20 = rng.d20();
  return {
    required: true,
    d20,
    dc: CONCEALED_FLAT_DC,
    passed: d20 >= CONCEALED_FLAT_DC,
  };
}
