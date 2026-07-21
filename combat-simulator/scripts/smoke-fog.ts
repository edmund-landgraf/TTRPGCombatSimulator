/**
 * Smoke: fog terrain → concealed DC 5 flat check (not −2 to hit).
 */
import { createMemory, living } from "../src/memory/combatMemory.js";
import { cellId } from "../src/memory/schemas.js";
import { paintTerrain } from "../src/map/aoe.js";
import { fogConcealsTarget } from "../src/rules/pf2e/concealment.js";
import { resolveStrike, estimatePHit } from "../src/rules/pf2e/strike.js";
import { SeededRng } from "../src/rules/pf2e/rng.js";
import { seedClassicStudio } from "../src/companion/seedClassic.js";
import { buildEncounterFromStudio, studioState } from "../src/companion/studio.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function placeAdjacent(attackerPos: { x: number; y: number }, targetPos: { x: number; y: number }, walkable: Set<string>) {
  const candidates = [
    { x: targetPos.x, y: targetPos.y + 1 },
    { x: targetPos.x, y: targetPos.y - 1 },
    { x: targetPos.x + 1, y: targetPos.y },
    { x: targetPos.x - 1, y: targetPos.y },
  ];
  for (const p of candidates) {
    if (walkable.has(cellId(p))) {
      attackerPos.x = p.x;
      attackerPos.y = p.y;
      return;
    }
  }
  throw new Error("no adjacent walkable cell");
}

function main(): void {
  seedClassicStudio(12);
  const fixture = studioState.encounter ?? buildEncounterFromStudio(studioState);
  const mem = createMemory(fixture, 42, "smoke-fog");
  const atk = living(mem, "party")[0]!;
  const tgt = living(mem, "enemy")[0]!;
  const walkable = new Set(mem.grid.walkable.keys());
  placeAdjacent(atk.pos, tgt.pos, walkable);

  const weapon = atk.weapons[0];
  assert(weapon, "attacker needs a weapon");

  const pNoFog = estimatePHit(mem, atk, tgt, weapon);
  paintTerrain(mem.grid, [tgt.pos], "fog");
  assert(fogConcealsTarget(mem, atk, tgt), "expected fog concealment");
  const pFog = estimatePHit(mem, atk, tgt, weapon);
  assert(pFog < pNoFog - 0.05, `fog should lower pHit (${pFog} vs ${pNoFog})`);

  let sawMiss = false;
  for (let seed = 1; seed < 80; seed++) {
    const m = createMemory(fixture, seed, "smoke-fog-roll");
    const a = living(m, "party")[0]!;
    const t = living(m, "enemy")[0]!;
    paintTerrain(m.grid, [t.pos], "fog");
    placeAdjacent(a.pos, t.pos, new Set(m.grid.walkable.keys()));
    const w = a.weapons[0]!;
    a.actionsLeft = 3;
    a.map = 0;
    resolveStrike(m, a, t, w, new SeededRng(seed), 1);
    const ev = [...m.events].reverse().find((e) => e.t === "attack");
    if (ev && ev.t === "attack" && ev.concealedFlat && !ev.concealedFlat.passed) {
      sawMiss = true;
      console.log(
        `concealed miss @ seed ${seed}: flat ${ev.concealedFlat.d20} vs DC ${ev.concealedFlat.dc}`,
      );
      break;
    }
  }
  assert(sawMiss, "expected at least one concealed flat-check miss");
  console.log(`pHit clear≈${pNoFog.toFixed(2)} fog≈${pFog.toFixed(2)}`);
  console.log("smoke-fog OK");
}

main();
