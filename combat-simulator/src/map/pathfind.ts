import type { Position } from "../memory/schemas.js";
import { cellId } from "../memory/schemas.js";
import { type Grid, isDifficult, isWalkable } from "./grid.js";

const NEIGHBORS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export type PathResult =
  | { ok: true; path: Position[]; cost: number }
  | { ok: false; reason: string };

/**
 * BFS pathfinding with PF2e-ish diagonal costing:
 * orthogonal = 1 (or 2 if difficult), diagonal = 1.5 rounded via every-other = 2 for odd diagonals in path.
 * Simplified: each step costs 1, +1 if difficult destination; diagonal steps cost +1 every other diagonal.
 */
export function findPath(
  grid: Grid,
  from: Position,
  to: Position,
  maxCost: number,
  blocked: Set<string>,
): PathResult {
  if (!isWalkable(grid, to)) {
    return { ok: false, reason: `destination not walkable (${cellId(to)})` };
  }
  // Occupied destinations are allowed (path toward a foe). Callers must not
  // step onto the occupied goal — use the penultimate cell for approach.
  if (cellId(from) === cellId(to)) {
    return { ok: true, path: [from], cost: 0 };
  }

  type Node = { pos: Position; cost: number; diagCount: number; prev?: string };
  const startKey = cellId(from);
  const goalKey = cellId(to);
  const best = new Map<string, number>();
  best.set(startKey, 0);
  const came = new Map<string, string>();
  const queue: Node[] = [{ pos: from, cost: 0, diagCount: 0 }];

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift()!;
    const curKey = cellId(cur.pos);
    if (cur.cost > (best.get(curKey) ?? Infinity)) continue;
    if (curKey === goalKey) {
      const path: Position[] = [cur.pos];
      let k: string | undefined = curKey;
      while (came.has(k)) {
        k = came.get(k)!;
        const m = /^x(\d+)y(\d+)$/i.exec(k);
        if (!m) break;
        path.push({ x: Number(m[1]), y: Number(m[2]) });
      }
      path.reverse();
      return { ok: true, path, cost: cur.cost };
    }

    for (const [dx, dy] of NEIGHBORS) {
      const next: Position = { x: cur.pos.x + dx, y: cur.pos.y + dy };
      if (!isWalkable(grid, next)) continue;
      const nk = cellId(next);
      if (blocked.has(nk) && nk !== goalKey) continue;

      const diagonal = dx !== 0 && dy !== 0;
      let stepCost = 1;
      if (diagonal) {
        const nextDiag = cur.diagCount + 1;
        if (nextDiag % 2 === 0) stepCost = 2;
      }
      if (isDifficult(grid, next)) stepCost += 1;

      const newCost = cur.cost + stepCost;
      if (newCost > maxCost) continue;
      if (newCost >= (best.get(nk) ?? Infinity)) continue;

      best.set(nk, newCost);
      came.set(nk, curKey);
      queue.push({
        pos: next,
        cost: newCost,
        diagCount: diagonal ? cur.diagCount + 1 : cur.diagCount,
      });
    }
  }

  return { ok: false, reason: `no path within ${maxCost} cells to ${goalKey}` };
}

/** Furthest cell along path within budget (excluding start). */
export function moveAlongPath(path: Position[], budget: number): Position {
  if (path.length <= 1) return path[0]!;
  // path[0] is start; approximate by taking up to `budget` steps
  const idx = Math.min(budget, path.length - 1);
  return path[idx]!;
}
