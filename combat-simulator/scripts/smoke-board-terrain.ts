import { createMemory } from "../src/memory/combatMemory.js";
import { buildBoard } from "../src/companion/session.js";
import { buildOpenSquareCells } from "../src/map/buildOpenSquareMap.js";
import { studioBoard, paintStudioCell, generateAsciiSquareMap } from "../src/companion/studio.js";

const cells = buildOpenSquareCells(8, true);
cells.find((c) => c.x === 4 && c.y === 4)!.tags = ["wall_h"];
cells.find((c) => c.x === 5 && c.y === 4)!.tags = ["floor", "barricade"];

const fixture = {
  id: "t",
  name: "t",
  ruleset: "pf2e",
  width: 8,
  height: 8,
  cells,
  combatants: [
    {
      id: "FTR",
      name: "F",
      side: "party",
      role: "fighter",
      tokenChar: "F",
      maxHp: 20,
      ac: 18,
      speedCells: 5,
      perceptionBonus: 5,
      start: { x: 2, y: 7 },
      weapons: [{ id: "s", name: "s", damageDice: 1, damageDie: 8 }],
    },
  ],
};

const mem = createMemory(fixture as never, 42);
if (!mem.grid.blocked?.has("x04y04")) throw new Error("wall missing from blocked map");
const board = buildBoard(mem);
const wall = board.cells.find((c) => c.x === 4 && c.y === 4)?.tags ?? [];
const bar = board.cells.find((c) => c.x === 5 && c.y === 4)?.tags ?? [];
if (!wall.includes("wall_h")) throw new Error(`wall tags: ${wall.join(",")}`);
if (!bar.includes("barricade")) throw new Error(`bar tags: ${bar.join(",")}`);

// studioBoard vs buildBoard parity after paint
import { studioState } from "../src/companion/studio.js";
generateAsciiSquareMap(studioState, 8, true);
paintStudioCell(studioState, 4, 4, "wall");
paintStudioCell(studioState, 5, 4, "barricade");
const studio = studioBoard(studioState);
const sw = studio.cells.find((c) => c.x === 4 && c.y === 4)?.tags ?? [];
const sb = studio.cells.find((c) => c.x === 5 && c.y === 4)?.tags ?? [];
if (!sw.includes("wall_h")) throw new Error(`studio wall: ${sw.join(",")}`);
if (!sb.includes("barricade")) throw new Error(`studio bar: ${sb.join(",")}`);

console.log("ok: buildBoard preserves wall_h and barricade");
