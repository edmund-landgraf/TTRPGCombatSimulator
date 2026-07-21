import type { EncounterFixture, MapCell, Position } from "../memory/schemas.js";
import {
  cellId,
  isBlockingTags,
  isCoverTags,
  tagsAreDifficult,
} from "../memory/schemas.js";

export type Grid = {
  width: number;
  height: number;
  /** key: cellId */
  walkable: Map<string, MapCell>;
  /** Non-walkable walls (preserves wall_h / wall_v vs plain blocking). */
  blocked: Map<string, MapCell>;
};

export function buildGrid(fixture: EncounterFixture): Grid {
  const walkable = new Map<string, MapCell>();
  const blocked = new Map<string, MapCell>();
  for (const c of fixture.cells) {
    if (isBlockingTags(c.tags)) blocked.set(cellId(c), c);
    else walkable.set(cellId(c), c);
  }
  return { width: fixture.width, height: fixture.height, walkable, blocked };
}

export function isWalkable(grid: Grid, pos: Position): boolean {
  return grid.walkable.has(cellId(pos));
}

/** True when the defender stands on cover / barricade terrain. */
export function hasCover(grid: Grid, pos: Position): boolean {
  return isCoverTags(grid.walkable.get(cellId(pos))?.tags ?? []);
}

/**
 * PF2e standard cover (+2 circumstance to AC) for a ranged / spell attack:
 * defender on cover/barricade, or the attack line crosses a barricade (soft cover you can shoot over).
 */
export function hasCoverFromAttack(
  grid: Grid,
  attacker: Position,
  target: Position,
): boolean {
  if (hasCover(grid, target)) return true;
  return losCrossesBarricade(grid, attacker, target);
}

/** Bresenham intermediates that include a barricade cell (does not block LOS). */
export function losCrossesBarricade(
  grid: Grid,
  from: Position,
  to: Position,
): boolean {
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
    const cell = grid.walkable.get(cellId({ x: x0, y: y0 }));
    if (cell?.tags.includes("barricade")) return true;
  }
  return false;
}

export function isDifficult(grid: Grid, pos: Position): boolean {
  const tags = grid.walkable.get(cellId(pos))?.tags ?? [];
  return tagsAreDifficult(tags);
}

export function isGrease(grid: Grid, pos: Position): boolean {
  return grid.walkable.get(cellId(pos))?.tags.includes("grease") ?? false;
}

export function isFog(grid: Grid, pos: Position): boolean {
  return grid.walkable.get(cellId(pos))?.tags.includes("fog") ?? false;
}

export function isHazardous(grid: Grid, pos: Position): boolean {
  return grid.walkable.get(cellId(pos))?.tags.includes("hazardous") ?? false;
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
