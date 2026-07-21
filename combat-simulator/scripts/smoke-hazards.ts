/**
 * Smoke: hazard catalog + Hidden Pit / Spear Launcher trigger on enter.
 */
import {
  loadHazardCatalog,
  lookupHazard,
  triggerHazardsOnEnter,
} from "../src/rules/pf2e/hazard.js";
import { SeededRng } from "../src/rules/pf2e/rng.js";
import { classicHazardPlacements } from "../src/map/buildClassicMap.js";
import { seedClassicStudio } from "../src/companion/seedClassic.js";
import { buildEncounterFromStudio, studioState } from "../src/companion/studio.js";
import { createMemory, living } from "../src/memory/combatMemory.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function main(): void {
  const catalog = loadHazardCatalog(true);
  console.log(`catalog: ${catalog.length}`);
  assert(lookupHazard("hidden_pit"), "missing hidden_pit");
  assert(lookupHazard("spear_launcher"), "missing spear_launcher");

  seedClassicStudio(12);
  const base = studioState.encounter ?? buildEncounterFromStudio(studioState);
  const fixture = {
    ...base,
    hazards: classicHazardPlacements(),
  };
  const mem = createMemory(fixture, 11, "smoke-hazards");
  // placeHazardsFromFixture already ran via createMemory
  assert(mem.activeHazards.length >= 2, `expected placed hazards, got ${mem.activeHazards.length}`);
  console.log(
    "placed:",
    mem.activeHazards.map((h) => `${h.name}@${h.cells.join(",")}`).join("; "),
  );

  const victim = living(mem, "party")[0]!;
  victim.saveBonus = -10;
  victim.ac = 10;
  // Step onto hidden pit cell
  const pit = mem.activeHazards.find((h) => h.hazardId === "hidden_pit")!;
  const [cx, cy] = (() => {
    const m = /^x(\d+)y(\d+)$/i.exec(pit.cells[0]!);
    return [Number(m![1]), Number(m![2])] as const;
  })();
  victim.pos = { x: cx, y: cy };
  const log: string[] = [];
  triggerHazardsOnEnter(mem, victim, [{ x: cx, y: cy }], new SeededRng(3), log);
  console.log(log.join("\n"));
  assert(
    mem.events.some((e) => e.t === "hazard_trigger" && e.hazard === "hidden_pit"),
    "expected hidden_pit trigger event",
  );

  // Spear launcher
  const spear = mem.activeHazards.find((h) => h.hazardId === "spear_launcher")!;
  const sm = /^x(\d+)y(\d+)$/i.exec(spear.cells[0]!)!;
  victim.pos = { x: Number(sm[1]), y: Number(sm[2]) };
  const log2: string[] = [];
  triggerHazardsOnEnter(
    mem,
    victim,
    [{ x: Number(sm[1]), y: Number(sm[2]) }],
    new SeededRng(5),
    log2,
  );
  console.log(log2.join("\n"));
  assert(spear.armed === false, "spear_launcher should disarm after once trigger");
  console.log("smoke-hazards OK");
}

main();
