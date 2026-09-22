/** Smoke: held weapon gates strikes; Switch_weapon costs 1 action. */
import fs from "node:fs";
import { EncounterFixtureSchema } from "../src/memory/schemas.js";
import { buildClassicFourCells } from "../src/map/buildClassicMap.js";
import { createMemory } from "../src/memory/combatMemory.js";
import { cellId } from "../src/memory/schemas.js";
import { buildPlayerChoices } from "../src/play/choices.js";
import { executeCandidate } from "../src/orch/turn.js";
import { SeededRng } from "../src/rules/pf2e/rng.js";
import { bestMeleeReach } from "../src/rules/pf2e/threaten.js";
import { instantiate, templateByKey } from "../src/encounters/templates.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const raw = JSON.parse(fs.readFileSync("../examples/classic-four-vs-goblins.json", "utf8"));
raw.cells = buildClassicFourCells(12, 10);
const fixture = EncounterFixtureSchema.parse(raw);
const mem = createMemory(fixture, 42);
mem.round = 1;

const rog = mem.combatants.get("ROG")!;
const gb1 = mem.combatants.get("GB1")!;

// Place rogue adjacent to a goblin blade.
rog.pos = { x: 3, y: 6 };
gb1.pos = { x: 4, y: 5 };
gb1.downed = false;
rog.actionsLeft = 3;
rog.map = 0;
rog.heldWeaponId = "shortsword";

assert(rog.heldWeaponId === "shortsword", "default held should be shortsword");

const visited = new Set([cellId(rog.pos)]);
const meleeMenu = buildPlayerChoices(mem, rog, visited);
const meleeStrikes = meleeMenu.filter((c) => c.candidate.head === "Strike_melee");
const rangedStrikes = meleeMenu.filter((c) => c.candidate.head === "Strike_ranged");
const switchToBow = meleeMenu.find(
  (c) => c.candidate.head === "Switch_weapon" && c.candidate.weaponId === "shortbow",
);
assert(meleeStrikes.length >= 1, "holding shortsword: expect melee strike");
assert(rangedStrikes.length === 0, "holding shortsword: no ranged strikes");
assert(!!switchToBow, "holding shortsword: expect Switch to shortbow");
console.log("ok: shortsword held → melee only + switch to bow");

// Holding bow: ranged strikes + switch to sword, no free melee.
rog.heldWeaponId = "shortbow";
const bowMenu = buildPlayerChoices(mem, rog, visited);
const bowMelee = bowMenu.filter((c) => c.candidate.head === "Strike_melee");
const bowRanged = bowMenu.filter((c) => c.candidate.head === "Strike_ranged");
const switchToSword = bowMenu.find(
  (c) => c.candidate.head === "Switch_weapon" && c.candidate.weaponId === "shortsword",
);
assert(bowMelee.length === 0, "holding shortbow: no melee strikes");
assert(bowRanged.length >= 1, "holding shortbow: expect ranged strike");
assert(!!switchToSword, "holding shortbow: expect Switch to shortsword");
console.log("ok: shortbow held → ranged only + switch to sword");

// Execute switch: costs 1 action and changes held weapon.
rog.actionsLeft = 3;
const before = rog.actionsLeft;
const ok = executeCandidate(
  mem,
  rog,
  switchToSword!.candidate,
  new SeededRng(1),
  [],
  visited,
  { strides: 0, steps: 0 },
);
assert(ok, "switch should succeed");
assert(rog.heldWeaponId === "shortsword", "after switch held shortsword");
assert(rog.actionsLeft === before - 1, "switch costs 1 action");
const afterEv = mem.events.filter((e) => e.t === "switch_weapon");
assert(afterEv.length >= 1, "expected switch_weapon event");
console.log("ok: Switch_weapon spends 1 action and updates heldWeaponId");

// Fighter template: glaive default → reach 2; longsword → reach 1.
const ftrFixture = instantiate(templateByKey("fighter"), "FTR_SMOKE", { x: 2, y: 2 });
assert(ftrFixture.defaultWeaponId === "glaive", "fighter defaultWeaponId glaive");
const ftrMem = createMemory(
  EncounterFixtureSchema.parse({
    id: "smoke-held",
    name: "smoke-held",
    ruleset: "pf2e",
    width: 8,
    height: 8,
    cells: buildClassicFourCells(8, 8),
    combatants: [ftrFixture],
  }),
  1,
);
const ftr = ftrMem.combatants.get("FTR_SMOKE")!;
assert(ftr.heldWeaponId === "glaive", "fighter starts with glaive");
assert(bestMeleeReach(ftr) === 2, "glaive reach 2");
ftr.heldWeaponId = "longsword";
assert(bestMeleeReach(ftr) === 1, "longsword reach 1");
console.log("ok: fighter held weapon controls threaten reach");

console.log("smoke-held-weapon: all checks passed");
