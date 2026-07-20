import type { EncounterFixture, MapCell, Position } from "../memory/schemas.js";
import { cellId } from "../memory/schemas.js";

export type Grid = {
  width: number;
  height: number;
  /** key: cellId */
  walkable: Map<string, MapCell>;
};

export function buildGrid(fixture: EncounterFixture): Grid {
  const walkable = new Map<string, MapCell>();
  for (const c of fixture.cells) {
    if (c.tags.includes("blocking")) continue;
    walkable.set(cellId(c), c);
  }
  return { width: fixture.width, height: fixture.height, walkable };
}

export function isWalkable(grid: Grid, pos: Position): boolean {
  return grid.walkable.has(cellId(pos));
}

export function hasCover(grid: Grid, pos: Position): boolean {
  return grid.walkable.get(cellId(pos))?.tags.includes("cover") ?? false;
}

export function isDifficult(grid: Grid, pos: Position): boolean {
  return grid.walkable.get(cellId(pos))?.tags.includes("difficult") ?? false;
}

export function chebyshev(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Bresenham LOS; blocked if any intermediate cell is non-walkable (wall). */
export function hasLineOfSight(grid: Grid, from: Position, to: Position): boolean {
  let x0 = from.x;
  let y0 = from.y;
  const x1 = to.x;
  const y1 = to.y;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (!(x0 === x1 && y0 === y1)) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
    if (x0 === x1 && y0 === y1) break;
    if (!isWalkable(grid, { x: x0, y: y0 })) return false;
  }
  return true;
}
