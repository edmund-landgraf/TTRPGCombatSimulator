/**
 * Smoke: exposeAffliction initial save + EOT stage tick.
 */
import { loadAfflictionCatalog, exposeAffliction, tickAfflictionsForActor } from "../src/rules/pf2e/affliction.js";
import { SeededRng } from "../src/rules/pf2e/rng.js";
import { seedClassicStudio } from "../src/companion/seedClassic.js";
import { buildEncounterFromStudio, studioState } from "../src/companion/studio.js";
import { createMemory, living } from "../src/memory/combatMemory.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function main(): void {
  const catalog = loadAfflictionCatalog(true);
  console.log(`catalog: ${catalog.length}`);
  assert(catalog.some((a) => a.id === "giant_centipede_venom"), "missing centipede venom");

  seedClassicStudio(12);
  const fixture = studioState.encounter ?? buildEncounterFromStudio(studioState);
  const mem = createMemory(fixture, 7, "smoke-afflictions");
  const victim = living(mem, "party")[0]!;
  victim.saveBonus = -20; // force fail for smoke
  mem.round = 1;

  const log: string[] = [];
  const rng = new SeededRng(99);
  exposeAffliction(mem, victim, "giant_centipede_venom", rng, log);
  console.log(log.join("\n"));
  assert(victim.afflictions.length === 1, "expected active affliction");
  assert(victim.afflictions[0]!.stage >= 1, "expected stage >= 1");

  // Force interval save now
  victim.afflictions[0]!.intervalLeft = 1;
  victim.saveBonus = 30; // force recover path
  const tickLog: string[] = [];
  tickAfflictionsForActor(mem, victim, new SeededRng(1), tickLog);
  console.log(tickLog.join("\n"));
  assert(
    victim.afflictions.length === 0 || victim.afflictions[0]!.stage < 3,
    "expected recovery or stage drop",
  );

  const events = mem.events.filter((e) => e.t === "affliction");
  assert(events.length >= 1, "expected affliction events");
  console.log("smoke-afflictions OK", events.map((e) => e.t === "affliction" && e.outcome).join(","));
}

main();
