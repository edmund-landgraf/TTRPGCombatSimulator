import type { MapCell } from "../memory/schemas.js";

/** Max square edge length (cells). Larger boards get unwieldy in ASCII with 5 ft spacing. */
export const MAX_MAP_SIZE = 24;

/** Open square floor grid; optional blocking border. Size is both width and height. */
export function buildOpenSquareCells(size: number, borderWalls = true): MapCell[] {
  const n = clampMapSize(size);
  const cells: MapCell[] = [];
  for (let y = 1; y <= n; y++) {
    for (let x = 1; x <= n; x++) {
      const border = borderWalls && (x === 1 || y === 1 || x === n || y === n);
      cells.push({ x, y, tags: border ? ["blocking"] : ["floor"] });
    }
  }
  return cells;
}

export function clampMapSize(size: number): number {
  return Math.max(4, Math.min(MAX_MAP_SIZE, Math.floor(size)));
}
