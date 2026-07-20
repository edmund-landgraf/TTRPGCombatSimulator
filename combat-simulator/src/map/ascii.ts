import type { Position } from "../memory/schemas.js";
import { cellId, terrainGlyphFor } from "../memory/schemas.js";
import type { Grid } from "./grid.js";

export type Token = { id: string; tokenChar: string; pos: Position; downed?: boolean };

export function renderAscii(
  grid: Grid,
  tokens: Token[],
  title?: string,
): string {
  const byCell = new Map<string, string>();
  for (const t of tokens) {
    if (t.downed) continue;
    const key = cellId(t.pos);
    const existing = byCell.get(key);
    byCell.set(key, existing ? `${existing}/${t.tokenChar}` : t.tokenChar);
  }

  const lines: string[] = [];
  if (title) lines.push(title);

  const header = ["    "];
  for (let x = 1; x <= grid.width; x++) {
    header.push(`x${String(x).padStart(2, "0")}`);
  }
  lines.push(header.join(" "));

  for (let y = 1; y <= grid.height; y++) {
    const row: string[] = [`y${String(y).padStart(2, "0")}`];
    for (let x = 1; x <= grid.width; x++) {
      const pos = { x, y };
      const key = cellId(pos);
      if (!grid.walkable.has(key)) {
        const wall = grid.blocked?.get(key);
        if (wall?.tags.includes("wall_h")) row.push(" ─ ");
        else if (wall?.tags.includes("wall_v")) row.push(" │ ");
        else row.push(" # ");
      } else {
        const tok = byCell.get(key);
        if (tok) {
          row.push(tok.length === 1 ? ` ${tok} ` : tok.slice(0, 3).padStart(3, " "));
        } else {
          const cell = grid.walkable.get(key)!;
          if (cell.tags.includes("grease")) {
            const g = terrainGlyphFor("grease");
            row.push(` ${g} `);
          } else if (cell.tags.includes("barricade")) row.push(" B ");
          else if (cell.tags.includes("cover")) row.push(" = ");
          else if (cell.tags.includes("hazardous")) row.push(" ! ");
          else if (cell.tags.includes("difficult")) row.push(" ~ ");
          else row.push(" . ");
        }
      }
    }
    lines.push(row.join(""));
  }
  return lines.join("\n");
}
