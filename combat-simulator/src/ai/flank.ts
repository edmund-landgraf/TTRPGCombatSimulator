import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import { living, occupiedKeys } from "../memory/combatMemory.js";
import { cellId, type Position } from "../memory/schemas.js";
import { chebyshev } from "../map/grid.js";
import { findPath } from "../map/pathfind.js";

/** Rough opposite-side check (PF2 flank simplified to opposing hemispheres). */
export function oppositeSides(a: Position, foe: Position, b: Position): boolean {
  const ax = a.x - foe.x;
  const ay = a.y - foe.y;
  const bx = b.x - foe.x;
  const by = b.y - foe.y;
  return ax * bx + ay * by < 0;
}

export function isAdjacent(a: Position, b: Position, reach = 1): boolean {
  return chebyshev(a, b) <= reach;
}

/** Actor + an ally both adjacent to foe on opposite sides. */
export function isFlanking(
  mem: CombatMemory,
  actor: CombatantState,
  foe: CombatantState,
  reach = 1,
): boolean {
  if (!isAdjacent(actor.pos, foe.pos, reach)) return false;
  for (const ally of living(mem, actor.side)) {
    if (ally.id === actor.id) continue;
    if (!isAdjacent(ally.pos, foe.pos, reach)) continue;
    if (oppositeSides(actor.pos, foe.pos, ally.pos)) return true;
  }
  return false;
}

export function isRangedPrimary(actor: CombatantState): boolean {
  const melee = actor.weapons.some((w) => w.kind === "melee");
  const ranged = actor.weapons.some((w) => w.kind === "ranged");
  const caster = actor.spells.some((s) => s.kind === "attack" || s.kind === "save");
  return ranged && !melee && !caster;
}

export function isRogueLike(actor: CombatantState): boolean {
  return actor.role.toLowerCase().includes("rogue");
}

export function isCasterBackline(actor: CombatantState): boolean {
  const role = actor.role.toLowerCase();
  if (role.includes("shaman") || role.includes("wizard") || role.includes("sorcerer")) {
    return true;
  }
  return actor.spells.some((s) => s.kind === "attack" || s.kind === "save");
}

/**
 * Best cell within Speed that would put actor adjacent to a foe already
 * engaged by an ally, on the opposite side (sneak/flank approach).
 */
export function flankApproachPos(
  mem: CombatMemory,
  actor: CombatantState,
  reach = 1,
): { to: Position; foe: CombatantState } | null {
  const foes = living(mem, actor.side === "party" ? "enemy" : "party");
  const allies = living(mem, actor.side).filter((a) => a.id !== actor.id);
  const blocked = occupiedKeys(mem, actor.id);
  let best: { to: Position; foe: CombatantState; score: number } | null = null;

  for (const foe of foes) {
    const engagers = allies.filter((a) => isAdjacent(a.pos, foe.pos, reach));
    if (engagers.length === 0) continue;
    for (const cell of mem.grid.walkable.values()) {
      const p = { x: cell.x, y: cell.y };
      if (!isAdjacent(p, foe.pos, reach)) continue;
      if (blocked.has(cellId(p))) continue;
      if (!engagers.some((a) => oppositeSides(p, foe.pos, a.pos))) continue;
      const path = findPath(mem.grid, actor.pos, p, actor.speedCells, blocked);
      if (!path.ok || path.cost <= 0) continue;
      const score = 20 - path.cost + (foe.maxHp - foe.hp) * 0.05;
      if (!best || score > best.score) best = { to: p, foe, score };
    }
  }
  return best ? { to: best.to, foe: best.foe } : null;
}

/** True if destination would put actor in melee of any living foe. */
export function endsInMelee(
  mem: CombatMemory,
  actor: CombatantState,
  to: Position,
  reach = 1,
): boolean {
  const foes = living(mem, actor.side === "party" ? "enemy" : "party");
  return foes.some((f) => isAdjacent(to, f.pos, reach));
}
