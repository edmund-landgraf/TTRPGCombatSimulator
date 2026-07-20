import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import { living, occupiedKeys } from "../memory/combatMemory.js";
import { cellId, type Position } from "../memory/schemas.js";
import { chebyshev, isDifficult, isHazardous, isWalkable, type Grid } from "../map/grid.js";
import { findPath } from "../map/pathfind.js";
import { isAdjacent, oppositeSides } from "./flank.js";
import { groupFlags } from "./tacticsGroups.js";

/** Static damage per hazardous cell entered (acid pool / wall of fire stand-in). */
export const HAZARD_DAMAGE_PER_CELL = 5;

const ORTHO: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** True when two+ foes pin the actor on opposite sides (actor is off-guard). */
export function isFlankedBy(
  mem: CombatMemory,
  actor: CombatantState,
  reach = 1,
  at: Position = actor.pos,
): boolean {
  const foes = living(mem, actor.side === "party" ? "enemy" : "party").filter((f) =>
    isAdjacent(f.pos, at, reach),
  );
  if (foes.length < 2) return false;
  for (let i = 0; i < foes.length; i++) {
    for (let j = i + 1; j < foes.length; j++) {
      if (oppositeSides(foes[i]!.pos, at, foes[j]!.pos)) return true;
    }
  }
  return false;
}

export function wouldBeFlankedAt(
  mem: CombatMemory,
  actor: CombatantState,
  at: Position,
  reach = 1,
): boolean {
  return isFlankedBy(mem, actor, reach, at);
}

/** Adjacent solid geometry (wall / map edge / blocking). */
export function isAgainstWall(grid: Grid, pos: Position): boolean {
  return ORTHO.some(([dx, dy]) => !isWalkable(grid, { x: pos.x + dx, y: pos.y + dy }));
}

/** Corridor / doorway: walkable with walls on both sides of one axis. */
export function isChokepointCell(grid: Grid, pos: Position): boolean {
  if (!isWalkable(grid, pos)) return false;
  const left = !isWalkable(grid, { x: pos.x - 1, y: pos.y });
  const right = !isWalkable(grid, { x: pos.x + 1, y: pos.y });
  const up = !isWalkable(grid, { x: pos.x, y: pos.y - 1 });
  const down = !isWalkable(grid, { x: pos.x, y: pos.y + 1 });
  const verticalCorridor = left && right && (!up || !down);
  const horizontalCorridor = up && down && (!left || !right);
  return verticalCorridor || horizontalCorridor;
}

export function pathCells(
  mem: CombatMemory,
  from: Position,
  to: Position,
  budget: number,
  actorId: string,
): Position[] | null {
  const blocked = occupiedKeys(mem, actorId);
  const path = findPath(mem.grid, from, to, budget, blocked);
  if (!path.ok) return null;
  return path.path;
}

/** Sum of hazard damage for entering cells along a path (excludes start). */
export function hazardDamageAlongPath(grid: Grid, path: Position[]): number {
  let dmg = 0;
  for (let i = 1; i < path.length; i++) {
    if (isHazardous(grid, path[i]!)) dmg += HAZARD_DAMAGE_PER_CELL;
  }
  return dmg;
}

export function pathCrossesDifficult(grid: Grid, path: Position[]): boolean {
  return path.slice(1).some((p) => isDifficult(grid, p));
}

/** True if one Stride (speedCells) can put actor adjacent to foe. */
export function canReachAdjacentInOneStride(
  mem: CombatMemory,
  actor: CombatantState,
  foe: CombatantState,
  reach = 1,
): boolean {
  const blocked = occupiedKeys(mem, actor.id);
  for (const cell of mem.grid.walkable.values()) {
    const p = { x: cell.x, y: cell.y };
    if (!isAdjacent(p, foe.pos, reach)) continue;
    if (blocked.has(cellId(p))) continue;
    const path = findPath(mem.grid, actor.pos, p, actor.speedCells, blocked);
    if (path.ok) return true;
  }
  return false;
}

/**
 * Best Step (cost ≤ 1) that breaks an active flank, preferring safe/non-hazard cells.
 */
export function breakFlankStepPos(
  mem: CombatMemory,
  actor: CombatantState,
): Position | null {
  if (!isFlankedBy(mem, actor)) return null;
  const blocked = occupiedKeys(mem, actor.id);
  let best: Position | null = null;
  let bestScore = -Infinity;
  for (const cell of mem.grid.walkable.values()) {
    const p = { x: cell.x, y: cell.y };
    if (blocked.has(cellId(p))) continue;
    const path = findPath(mem.grid, actor.pos, p, 1, blocked);
    if (!path.ok || path.cost > 1) continue;
    if (wouldBeFlankedAt(mem, actor, p)) continue;
    let score = 10;
    if (isHazardous(mem.grid, p)) score -= 20;
    if (isAgainstWall(mem.grid, p)) score += 3;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/** Step toward a wall/corner to deny future flanks while threatened by 2+ foes. */
export function wallAnchorStepPos(
  mem: CombatMemory,
  actor: CombatantState,
): Position | null {
  if (isAgainstWall(mem.grid, actor.pos)) return null;
  const adjFoes = living(mem, actor.side === "party" ? "enemy" : "party").filter((f) =>
    isAdjacent(f.pos, actor.pos, 1),
  );
  if (adjFoes.length < 2) return null;
  const blocked = occupiedKeys(mem, actor.id);
  let best: Position | null = null;
  let bestScore = -Infinity;
  for (const cell of mem.grid.walkable.values()) {
    const p = { x: cell.x, y: cell.y };
    if (blocked.has(cellId(p))) continue;
    const path = findPath(mem.grid, actor.pos, p, 1, blocked);
    if (!path.ok || path.cost > 1) continue;
    if (!isAgainstWall(mem.grid, p)) continue;
    if (isHazardous(mem.grid, p)) continue;
    if (wouldBeFlankedAt(mem, actor, p)) continue;
    const score = 5 + (isChokepointCell(mem.grid, p) ? 2 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

export function nearestFoe(mem: CombatMemory, actor: CombatantState): CombatantState | undefined {
  const foes = living(mem, actor.side === "party" ? "enemy" : "party");
  let best: CombatantState | undefined;
  let bestD = Infinity;
  for (const f of foes) {
    const d = chebyshev(actor.pos, f.pos);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

export function frontlinerAllyHoldingChoke(
  mem: CombatMemory,
  actor: CombatantState,
): CombatantState | undefined {
  return living(mem, actor.side)
    .filter((a) => a.id !== actor.id)
    .filter((a) => {
      const f = groupFlags(a);
      return f.preferMelee && !f.keepDistance && isChokepointCell(mem.grid, a.pos);
    })
    .sort((a, b) => chebyshev(actor.pos, a.pos) - chebyshev(actor.pos, b.pos))[0];
}

/** Destination is "immediate kill" if it reaches a nearly-dead foe in melee. */
export function strideIsImmediateKill(
  mem: CombatMemory,
  actor: CombatantState,
  to: Position,
): boolean {
  const soft = living(mem, actor.side === "party" ? "enemy" : "party").find(
    (f) => (f.hp / f.maxHp <= 0.35 || f.hp <= 6) && isAdjacent(to, f.pos, 1),
  );
  return !!soft && actor.weapons.some((w) => w.kind === "melee");
}
