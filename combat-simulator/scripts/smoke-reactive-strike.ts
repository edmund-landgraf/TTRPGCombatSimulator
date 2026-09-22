/** Smoke: Reactive Strike on Stride (not Step); reach-2 control. */
import fs from "node:fs";
import { EncounterFixtureSchema } from "../src/memory/schemas.js";
import { buildClassicFourCells } from "../src/map/buildClassicMap.js";
import { createMemory } from "../src/memory/combatMemory.js";
import { cellId } from "../src/memory/schemas.js";
import { resolveStride } from "../src/rules/pf2e/movement.js";
import { SeededRng } from "../src/rules/pf2e/rng.js";
import { bestMeleeReach, threatenedCellsFor } from "../src/rules/pf2e/threaten.js";
import { resolveStep } from "../src/rules/pf2e/movement.js";

const raw = JSON.parse(fs.readFileSync("../examples/classic-four-vs-goblins.json", "utf8"));
raw.cells = buildClassicFourCells(12, 10);
const fixture = EncounterFixtureSchema.parse(raw);
const mem = createMemory(fixture, 99);
mem.round = 1;

for (const c of mem.combatants.values()) {
  if (c.id !== "GB1" && c.id !== "ROG") c.downed = true;
}

const gb1 = mem.combatants.get("GB1")!;
gb1.pos = { x: 3, y: 3 };
gb1.downed = false;
gb1.reactionAvailable = true;
gb1.weapons = [
  {
    id: "halberd",
    kind: "melee",
    attackBonus: 6,
    damageDice: 1,
    damageDie: 8,
    damageBonus: 2,
    reach: 2,
  },
];
gb1.heldWeaponId = "halberd";

const rog = mem.combatants.get("ROG")!;
rog.pos = { x: 3, y: 5 };
rog.actionsLeft = 3;

const reachCells = threatenedCellsFor(mem, gb1);
if (!reachCells.includes(cellId({ x: 3, y: 5 }))) {
  throw new Error("halberd reach 2 should threaten ROG at x03y05");
}
console.log(`ok: GB1 halberd threatens ${reachCells.length} cells incl. ROG`);

const rng = new SeededRng(99);
const log: string[] = [];
const ok = resolveStride(mem, rog, { x: 3, y: 7 }, mem.round, rng, log);
if (!ok) throw new Error("stride failed");

const rs = mem.events.filter(
  (e) => e.t === "attack" && e.reaction && e.actor === "GB1",
);
if (rs.length !== 1) {
  throw new Error(`expected 1 GB1 reactive strike, got ${rs.length}; log:\n${log.join("\n")}`);
}
if (gb1.reactionAvailable) {
  throw new Error("GB1 reaction should be spent");
}
console.log("ok: Stride away provoked Reactive Strike (halberd reach 2)");
console.log(log.join("\n"));

// Step away from same setup should NOT provoke.
mem.events.length = 0;
gb1.reactionAvailable = true;
rog.pos = { x: 3, y: 5 };
rog.actionsLeft = 3;
resolveStep(mem, rog, { x: 3, y: 6 }, mem.round, rng);
const rs2 = mem.events.filter((e) => e.t === "attack" && e.reaction);
if (rs2.length !== 0) {
  throw new Error(`Step should not provoke Reactive Strike, got ${rs2.length}`);
}
console.log("ok: Step does not provoke Reactive Strike");
console.log(`ok: GB1 bestMeleeReach=${bestMeleeReach(gb1)}`);
