import type { CombatantState, CombatMemory } from "../../memory/combatMemory.js";
import { cellId, type Position, type Weapon } from "../../memory/schemas.js";
import { chebyshev } from "../../map/grid.js";
import { heldMeleeReach, heldWeapon } from "./heldWeapon.js";

/** Melee reach of the currently held weapon (0 if holding ranged / unarmed). */
export function bestMeleeReach(actor: CombatantState): number {
  return heldMeleeReach(actor);
}

/** Held melee weapon, if any. */
export function bestMeleeWeapon(actor: CombatantState): Weapon | undefined {
  const w = heldWeapon(actor);
  return w?.kind === "melee" ? w : undefined;
}

/** Held melee weapon that can legally strike `foe` from `actor`'s current cell. */
export function meleeWeaponForTarget(
  actor: CombatantState,
  foe: CombatantState,
): Weapon | undefined {
  const w = bestMeleeWeapon(actor);
  if (!w) return undefined;
  if (chebyshev(actor.pos, foe.pos) > (w.reach ?? 1)) return undefined;
  return w;
}

export function threatensCell(
  reactor: CombatantState,
  cell: Position,
  reach = bestMeleeReach(reactor),
): boolean {
  return chebyshev(reactor.pos, cell) <= reach;
}

/** All walkable cells within the actor's melee reach (area of control). */
export function threatenedCellsFor(
  mem: CombatMemory,
  reactor: CombatantState,
): string[] {
  const reach = bestMeleeReach(reactor);
  const out: string[] = [];
  for (const key of mem.grid.walkable.keys()) {
    const m = /^x(\d+)y(\d+)$/i.exec(key);
    if (!m) continue;
    const p: Position = { x: Number(m[1]), y: Number(m[2]) };
    if (threatensCell(reactor, p, reach)) out.push(key);
  }
  return out;
}

/** Reactive Strike / Attack of Opportunity — capability gate (not every PC). */
export function hasReactiveStrikeCapability(actor: CombatantState): boolean {
  if (actor.capabilities.includes("reactive_strike")) return true;
  if (actor.capabilities.includes("champion_dedication")) return true;
  const r = actor.role.toLowerCase();
  return (
    r.includes("fighter") ||
    r.includes("blade") ||
    r.includes("soldier") ||
    r.includes("warrior") ||
    r.includes("brute")
  );
}

export function canThreatenReactiveStrike(
  mem: CombatMemory,
  reactor: CombatantState,
  mover: CombatantState,
  leftCell: Position,
): boolean {
  if (reactor.id === mover.id || reactor.side === mover.side) return false;
  if (reactor.downed || mover.downed) return false;
  if (!reactor.reactionAvailable) return false;
  if (!hasReactiveStrikeCapability(reactor)) return false;
  if (!bestMeleeWeapon(reactor)) return false;
  return threatensCell(reactor, leftCell);
}

/** Reactors (initiative order) that would trigger when `mover` leaves `leftCell`. */
export function reactiveStrikersOnLeave(
  mem: CombatMemory,
  mover: CombatantState,
  leftCell: Position,
): CombatantState[] {
  const order = new Map(mem.initiative.map((id, i) => [id, i]));
  return [...mem.combatants.values()]
    .filter((c) => canThreatenReactiveStrike(mem, c, mover, leftCell))
    .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
}

/** Union of enemy threatened cells (where a Stride may draw Reactive Strike). */
export function threatenedByEnemies(
  mem: CombatMemory,
  actor: CombatantState,
): string[] {
  const foes = [...mem.combatants.values()].filter(
    (c) => c.side !== actor.side && !c.downed && hasReactiveStrikeCapability(c),
  );
  const out = new Set<string>();
  for (const foe of foes) {
    for (const key of threatenedCellsFor(mem, foe)) out.add(key);
  }
  return [...out];
}

/** True if any square along `path` (excluding start) is currently threatened by a ready reactor. */
export function strideCrossesThreat(
  mem: CombatMemory,
  mover: CombatantState,
  path: Position[],
): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    const left = path[i]!;
    if (reactiveStrikersOnLeave(mem, mover, left).length > 0) return true;
  }
  return false;
}

export function actorThreatenedCells(
  mem: CombatMemory,
  actor: CombatantState,
): string[] {
  return threatenedCellsFor(mem, actor);
}

export function cellKey(p: Position): string {
  return cellId(p);
}
