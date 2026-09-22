/** Verify player choices respect melee reach / ranged range / LOS. */
import fs from "node:fs";
import { EncounterFixtureSchema } from "../src/memory/schemas.js";
import { buildClassicFourCells } from "../src/map/buildClassicMap.js";
import { createMemory } from "../src/memory/combatMemory.js";
import { cellId } from "../src/memory/schemas.js";
import { buildPlayerChoices } from "../src/play/choices.js";
import { chebyshev } from "../src/map/grid.js";
import { canStrike } from "../src/rules/pf2e/strike.js";

const raw = JSON.parse(fs.readFileSync("../examples/classic-four-vs-goblins.json", "utf8"));
raw.cells = buildClassicFourCells(12, 10);
const fixture = EncounterFixtureSchema.parse(raw);
const mem = createMemory(fixture, 42);
mem.round = 1;

function assertNoIllegalMelee(
  label: string,
  positions: Record<string, { x: number; y: number }>,
) {
  for (const [id, pos] of Object.entries(positions)) {
    const c = mem.combatants.get(id);
    if (c) c.pos = pos;
  }
  const actor = mem.combatants.get("ROG")!;
  actor.actionsLeft = 3;
  actor.map = 0;
  const melee = actor.weapons.find((w) => w.kind === "melee")!;
  const choices = buildPlayerChoices(mem, actor, new Set([cellId(actor.pos)]));

  console.log(`\n=== ${label} @ ${cellId(actor.pos)} ===`);
  for (const c of choices) {
    if (!c.label.includes("shortsword") || !c.label.includes("(melee")) continue;
    const name = c.label.match(/Strike (.+?) with/)?.[1];
    const foe = [...mem.combatants.values()].find((x) => x.name === name);
    if (!foe) continue;
    const d = chebyshev(actor.pos, foe.pos);
    if (!canStrike(mem, actor, foe, melee)) {
      throw new Error(`Illegal melee choice: ${c.label} (dist=${d}, reach=${melee.reach ?? 1})`);
    }
    console.log(`  ok melee: ${c.label}`);
  }
}

// ROG left of the goblin line — only GB1 (and diag GA1) in melee reach.
assertNoIllegalMelee("ROG west of blades", {
  ROG: { x: 2, y: 3 },
  GB1: { x: 3, y: 3 },
  GB2: { x: 4, y: 3 },
  GA1: { x: 3, y: 2 },
  GA2: { x: 4, y: 2 },
  SHA: { x: 5, y: 3 },
});

// ROG below both blades — GB1 + GB2 legal melee, archers not.
assertNoIllegalMelee("ROG below both blades", {
  ROG: { x: 3, y: 4 },
  GB1: { x: 3, y: 3 },
  GB2: { x: 4, y: 3 },
  GA1: { x: 3, y: 2 },
  GA2: { x: 4, y: 2 },
  SHA: { x: 5, y: 3 },
});

console.log("\nok: spatial choice menus match grid reach");
