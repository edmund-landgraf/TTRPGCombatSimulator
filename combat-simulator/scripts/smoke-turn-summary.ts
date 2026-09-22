/** Smoke: initiative turn summary + frozen enemy display board. */
import fs from "node:fs";
import { EncounterFixtureSchema } from "../src/memory/schemas.js";
import { buildClassicFourCells } from "../src/map/buildClassicMap.js";
import { createMemory } from "../src/memory/combatMemory.js";
import { resolveStride } from "../src/rules/pf2e/movement.js";
import { companionSession, buildBoard } from "../src/companion/session.js";
import {
  buildDisplayBoard,
  parseTurnSummary,
  snapshotEnemyPositions,
} from "../src/companion/turnSummary.js";

const raw = JSON.parse(fs.readFileSync("../examples/classic-four-vs-goblins.json", "utf8"));
raw.cells = buildClassicFourCells(12, 10);
const fixture = EncounterFixtureSchema.parse(raw);
const mem = createMemory(fixture, 42);

const sampleLog = `--- GA2 (Goblin Archer 2) ---
  GM-BUDGET A1: "Stride / Strike" → Stride_close
  Stride x06y02 → x08y06
  Strike WIZ with shortbow: d20 14+5=19 vs AC 15 HIT; 1d6+1 → hp 9
  Strike WIZ with shortbow: d20 8+5=13 vs AC 15 MISS
`;

const summary = parseTurnSummary(sampleLog, mem);
if (!summary || summary.actorId !== "GA2" || summary.side !== "enemy") {
  throw new Error(`unexpected summary: ${JSON.stringify(summary)}`);
}
if (!summary.actions[0]?.text.startsWith("Stride")) {
  throw new Error("first action should be Stride");
}
console.log("ok: parseTurnSummary");

const archer = mem.combatants.get("GA1");
if (!archer) throw new Error("missing GA1");
companionSession.reset();
companionSession.liveMemory = mem;
companionSession.beginEnemyTurnDisplay(mem);
const frozen = snapshotEnemyPositions(mem);
resolveStride(mem, archer, { x: archer.pos.x + 2, y: archer.pos.y + 3 }, 1);
const live = buildBoard(mem);
const display = buildDisplayBoard(live, frozen);
const liveTok = live.tokens.find((t) => t.id === "GA1")!;
const dispTok = display.tokens.find((t) => t.id === "GA1")!;
const froz = frozen.get("GA1")!;
if (dispTok.x !== froz.x || dispTok.y !== froz.y) {
  throw new Error("display board should keep frozen enemy position");
}
if (liveTok.x === dispTok.x && liveTok.y === dispTok.y) {
  throw new Error("live board should differ after stride");
}
console.log("ok: buildDisplayBoard freezes enemies");

companionSession.setLastTurnSummaryFromLog(sampleLog, mem);
companionSession.setTurnCursor({ justActedId: "GA2", activeActorId: null, nextActorId: "GA1" });
companionSession.publishFromMemory(mem, { phase: "waiting", pauseKind: "turn" });
const ctx = companionSession.context;
if (!ctx?.enemyDisplayFrozen) throw new Error("expected enemyDisplayFrozen");
if (!ctx.lastTurnSummary || ctx.lastTurnSummary.actions.length !== 3) {
  throw new Error("expected lastTurnSummary on context");
}
const boardTok = ctx.board.tokens.find((t) => t.id === "GA1")!;
if (boardTok.x !== froz.x) throw new Error("context board should use frozen positions");
companionSession.waitingForAdvance = true;
companionSession.advance();
if (companionSession.context?.enemyDisplayFrozen) {
  throw new Error("advance should unfreeze display");
}
console.log("ok: companion session enemy display freeze/advance");
