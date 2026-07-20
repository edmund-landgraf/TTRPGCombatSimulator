/** Smoke: studio + live combat token moves (deploy / waiting). */
import fs from "node:fs";
import { EncounterFixtureSchema } from "../src/memory/schemas.js";
import { buildClassicFourCells } from "../src/map/buildClassicMap.js";
import {
  moveStudioToken,
  studioBoard,
  studioState,
} from "../src/companion/studio.js";
import { seedClassicStudio } from "../src/companion/seedClassic.js";
import { companionSession } from "../src/companion/session.js";
import { createMemory } from "../src/memory/combatMemory.js";
import { rollInitiative } from "../src/rules/pf2e/initiative.js";
import { SeededRng } from "../src/rules/pf2e/rng.js";

// --- Setup free placement ---
seedClassicStudio(12);
const board0 = studioBoard(studioState);
const ftr = board0.tokens.find((t) => t.id === "FTR");
if (!ftr) throw new Error("sample missing FTR");
const occ = new Set(board0.tokens.map((t) => `${t.x},${t.y}`));
const free = board0.cells.find(
  (c) =>
    !c.tags.includes("blocking") &&
    !occ.has(`${c.x},${c.y}`) &&
    !(c.x === ftr.x && c.y === ftr.y),
);
if (!free) throw new Error("no free cell for studio move");
moveStudioToken(studioState, "FTR", free.x, free.y);
const after = studioState.pcs.find((c) => c.id === "FTR");
if (!after || after.start.x !== free.x || after.start.y !== free.y) {
  throw new Error("studio move did not update start");
}
console.log("ok: studio move-token");

// --- Live deploy move ---
const raw = JSON.parse(fs.readFileSync("../examples/classic-four-vs-goblins.json", "utf8"));
raw.cells = buildClassicFourCells(12, 10);
const fixture = EncounterFixtureSchema.parse(raw);
const mem = createMemory(fixture, 42);
rollInitiative(mem, new SeededRng(42));
companionSession.reset();
companionSession.publishFromMemory(mem, { phase: "deploy" });
companionSession.waitingForAdvance = true;
companionSession.context = {
  ...companionSession.context!,
  waitingForAdvance: true,
  phase: "deploy",
  canMoveTokens: true,
};
const actor = mem.combatants.get("FTR")!;
function freeCellNear(excludeId: string) {
  const blocked = new Set(
    [...mem.combatants.values()]
      .filter((c) => c.id !== excludeId && !c.downed)
      .map((c) => `${c.pos.x},${c.pos.y}`),
  );
  for (const cell of mem.grid.walkable.values()) {
    const key = `${cell.x},${cell.y}`;
    if (!blocked.has(key) && !(cell.x === actor.pos.x && cell.y === actor.pos.y)) {
      return { x: cell.x, y: cell.y };
    }
  }
  throw new Error("no free walkable cell");
}
const liveDest = freeCellNear("FTR");
companionSession.moveLiveToken("FTR", liveDest.x, liveDest.y);
if (actor.pos.x !== liveDest.x || actor.pos.y !== liveDest.y) {
  throw new Error("deploy move failed");
}
if (!companionSession.context?.canMoveTokens) {
  throw new Error("deploy should keep canMoveTokens");
}
console.log("ok: combat deploy move-token");

// --- Between-round waiting move ---
companionSession.publishFromMemory(mem, { phase: "waiting" });
companionSession.waitingForAdvance = true;
companionSession.context = {
  ...companionSession.context!,
  waitingForAdvance: true,
  phase: "waiting",
  canMoveTokens: true,
};
const waitDest = freeCellNear("FTR");
companionSession.moveLiveToken("FTR", waitDest.x, waitDest.y);
if (actor.pos.x !== waitDest.x || actor.pos.y !== waitDest.y) {
  throw new Error("waiting move failed");
}
console.log("ok: combat waiting move-token");
console.log("all token-drag smoke checks passed");
