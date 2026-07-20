import type { MapCell } from "../memory/schemas.js";

/** 12x10 classic-four map: walls border, cover on y4, open floor elsewhere. */
export function buildClassicFourCells(width = 12, height = 10): MapCell[] {
  const cells: MapCell[] = [];
  for (let y = 1; y <= height; y++) {
    for (let x = 1; x <= width; x++) {
      const border = x === 1 || y === 1 || x === width || y === height;
      if (border) {
        // border not walkable — omit from walkable set by tagging blocking
        cells.push({ x, y, tags: ["blocking"] });
        continue;
      }
      if (y === 4 && x >= 2 && x <= 11) {
        cells.push({ x, y, tags: ["floor", "cover"] });
        continue;
      }
      if (y === 7 && x >= 2 && x <= 8) {
        // Swamp band: difficult; a few acid pools as hazardous.
        const hazardous = x === 3 || x === 6;
        cells.push({
          x,
          y,
          tags: hazardous ? ["floor", "difficult", "hazardous"] : ["floor", "difficult"],
        });
        continue;
      }
      cells.push({ x, y, tags: ["floor"] });
    }
  }
  return cells;
}
