/** Smoke: board payload tracks Stride/Step positions and companion round snapshots. */
import fs from "node:fs";
import { EncounterFixtureSchema, cellId } from "../src/memory/schemas.js";
import { buildClassicFourCells } from "../src/map/buildClassicMap.js";
import { createMemory } from "../src/memory/combatMemory.js";
import { resolveStride, resolveStep } from "../src/rules/pf2e/movement.js";
import { runEncounter } from "../src/orch/loop.js";
import { companionSession, buildBoard } from "../src/companion/session.js";

const raw = JSON.parse(fs.readFileSync("../examples/classic-four-vs-goblins.json", "utf8"));
raw.cells = buildClassicFourCells(12, 10);
const fixture = EncounterFixtureSchema.parse(raw);

{
  const mem = createMemory(fixture, 7);
  const actor = mem.combatants.get("FTR");
  if (!actor) throw new Error("missing FTR");
  const start = { ...actor.pos };
  const dest = { x: Math.min(fixture.width, start.x + 2), y: start.y };
  if (!resolveStride(mem, actor, dest, 1)) {
    throw new Error("Stride should succeed on open classic map");
  }
  const board = buildBoard(mem);
  if (board.width !== fixture.width || board.height !== fixture.height) {
    throw new Error("board size mismatch");
  }
  if (!board.cells.some((c) => c.tags.includes("blocking"))) {
    throw new Error("expected blocking cells on classic map");
  }
  const tok = board.tokens.find((t) => t.id === "FTR");
  if (!tok || tok.x !== actor.pos.x || tok.y !== actor.pos.y) {
    throw new Error("token pos mismatch after Stride");
  }
  if (
    !resolveStep(mem, actor, {
      x: actor.pos.x,
      y: Math.min(fixture.height, actor.pos.y + 1),
    }, 1)
  ) {
    throw new Error("Step should succeed");
  }
  const board2 = buildBoard(mem);
  const tok2 = board2.tokens.find((t) => t.id === "FTR");
  if (!tok2 || cellId({ x: tok2.x, y: tok2.y }) !== cellId(actor.pos)) {
    throw new Error("token pos mismatch after Step");
  }
  console.log("ok: Stride/Step update board tokens");
}

companionSession.reset();
const result = await runEncounter(fixture, {
  seed: 42,
  maxRounds: 3,
  save: false,
  companion: companionSession,
});
const ctx = companionSession.context;
if (!ctx?.board?.width) throw new Error("context missing board");
if (!ctx.rounds.length) throw new Error("expected round snapshots");

const last = ctx.rounds[ctx.rounds.length - 1]!;
for (const t of last.board.tokens) {
  const c = result.mem.combatants.get(t.id);
  if (!c) throw new Error(`unknown token ${t.id}`);
  if (c.pos.x !== t.x || c.pos.y !== t.y) {
    throw new Error(
      `final board token ${t.id} at ${t.x},${t.y} but mem at ${c.pos.x},${c.pos.y}`,
    );
  }
  if (t.tokenChar !== c.tokenChar) throw new Error(`tokenChar mismatch ${t.id}`);
}

const moves = result.mem.events.filter((e) => e.t === "move");
if (!moves.length) throw new Error("expected move events from Stride/Step");
for (const m of moves) {
  if (m.kind !== "Stride" && m.kind !== "Step") {
    throw new Error(`unexpected move kind ${m.kind}`);
  }
}
if (!ctx.mapText || ctx.mapText.length < 20) {
  throw new Error("mapText ASCII missing");
}

console.log(
  `ok: companion board matches mem after ${ctx.rounds.length} rounds; ${moves.length} moves`,
);
console.log(
  "tokens:",
  last.board.tokens.map((t) => `${t.tokenChar}@${t.x},${t.y}`).join(" "),
);
