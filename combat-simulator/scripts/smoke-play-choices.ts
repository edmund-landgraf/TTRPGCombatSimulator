/** Non-interactive smoke: build choice menus for each PC at encounter start. */
import fs from "node:fs";
import { EncounterFixtureSchema } from "../src/memory/schemas.js";
import { buildClassicFourCells } from "../src/map/buildClassicMap.js";
import { createMemory } from "../src/memory/combatMemory.js";
import { cellId } from "../src/memory/schemas.js";
import { buildPlayerChoices } from "../src/play/choices.js";

const raw = JSON.parse(fs.readFileSync("../examples/classic-four-vs-goblins.json", "utf8"));
raw.cells = buildClassicFourCells(12, 10);
const fixture = EncounterFixtureSchema.parse(raw);
const mem = createMemory(fixture, 42);
mem.round = 1;

for (const id of ["FTR", "WIZ", "ROG", "CLR"]) {
  const actor = mem.combatants.get(id)!;
  actor.actionsLeft = 3;
  actor.map = 0;
  const choices = buildPlayerChoices(mem, actor, new Set([cellId(actor.pos)]));
  console.log(`\n=== ${actor.name} (${choices.length} choices) ===`);
  for (const c of choices) {
    console.log(`[${c.key}] ${c.label}`);
    console.log(`     ${c.tip}`);
  }
  const sleep = choices.filter((c) => c.label.includes("Sleep"));
  const fire = choices.filter((c) => c.label.includes("Fireball"));
  const grease = choices.filter((c) => c.label.includes("Grease"));
  if (id === "WIZ") {
    console.log(
      `  (wizard: sleep opts=${sleep.length}, grease=${grease.length}, fireball=${fire.length})`,
    );
    if (fire.length > 0) {
      throw new Error("L1 wizard must not offer Fireball (rank 3)");
    }
    if (sleep.length !== 1) {
      throw new Error(`Sleep should appear once as an area spell, got ${sleep.length}`);
    }
    if (grease.length !== 1) {
      throw new Error(`Grease should appear once as an area spell, got ${grease.length}`);
    }
    if (sleep[0]!.label.includes(" at ")) {
      throw new Error(`Sleep label must not name a single foe: ${sleep[0]!.label}`);
    }
  }
  if (id === "ROG") {
    const retreat = choices.find((c) => c.key === "3");
    if (!retreat || !retreat.label.startsWith("Retreat")) {
      throw new Error(`Rogue slot 3 must be Retreat, got ${retreat?.label ?? "none"}`);
    }
  }
}
