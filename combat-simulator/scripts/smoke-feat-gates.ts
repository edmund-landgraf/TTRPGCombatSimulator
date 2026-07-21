/**
 * Smoke: shouldAttemptFeat gates for sneak_attack / reactive_strike / flurry.
 */
import {
  composePackets,
  gatherBattlefieldHints,
  resolveBuildProfile,
} from "../src/ai/buildProfile.js";
import { loadFeatCatalog, shouldAttemptFeat } from "../src/ai/featLookup.js";
import { runGrandmasterLoop } from "../src/ai/grandmasterLoop.js";
import { seedClassicStudio } from "../src/companion/seedClassic.js";
import { buildEncounterFromStudio, studioState } from "../src/companion/studio.js";
import { createMemory, living, type CombatantState } from "../src/memory/combatMemory.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function main(): void {
  const catalog = loadFeatCatalog(true);
  console.log(`catalog entries: ${catalog.length}`);
  assert(catalog.length >= 20, `catalog too small: ${catalog.length}`);

  seedClassicStudio(12);
  const fixture = studioState.encounter ?? buildEncounterFromStudio(studioState);
  const mem = createMemory(fixture, 42, "smoke-feat-gates");

  const rogue = living(mem, "party").find(
    (c) => /rogue/i.test(c.role) || /rogue/i.test(c.classId),
  );
  const fighter = living(mem, "party").find(
    (c) => /fighter/i.test(c.role) || /fighter/i.test(c.classId),
  );
  assert(rogue, "rogue not in classic seed");
  assert(fighter, "fighter not in classic seed");

  const rogueProfile = resolveBuildProfile(rogue);
  assert(
    rogueProfile.capabilities.includes("sneak_attack"),
    `rogue missing sneak_attack: ${rogueProfile.capabilities.join(",")}`,
  );

  const rHints = gatherBattlefieldHints(mem, rogue);
  rHints.alreadyFlanking = false;
  rHints.hasFlankPath = true;
  const sneakSkip = shouldAttemptFeat(mem, rogue, "sneak_attack", {
    hints: rHints,
    capabilities: rogueProfile.capabilities,
  });
  assert(!sneakSkip.attempt, `expected sneak skip, got ${JSON.stringify(sneakSkip)}`);
  assert(
    /Off-Guard|flank/i.test(sneakSkip.reason),
    `unexpected sneak reason: ${sneakSkip.reason}`,
  );
  console.log("sneak_attack (no OG):", sneakSkip.attempt, sneakSkip.reason);

  rHints.alreadyFlanking = true;
  const sneakTry = shouldAttemptFeat(mem, rogue, "sneak_attack", {
    hints: rHints,
    capabilities: rogueProfile.capabilities,
  });
  assert(sneakTry.attempt, `expected sneak try, got ${JSON.stringify(sneakTry)}`);
  console.log("sneak_attack (flanking):", sneakTry.attempt, sneakTry.reason);

  const fighterProfile = resolveBuildProfile(fighter);
  const fHints = gatherBattlefieldHints(mem, fighter);
  const reactive = shouldAttemptFeat(mem, fighter, "reactive_strike", {
    hints: fHints,
    capabilities: fighterProfile.capabilities,
  });
  console.log("reactive_strike:", reactive.attempt, reactive.reason);
  assert(reactive.featId === "reactive_strike", "reactive id");

  const monk = {
    ...fighter,
    id: "monk_smoke",
    name: "Monk Smoke",
    role: "monk",
    classId: "monk",
    capabilities: ["flurry_of_blows"],
    archetypes: [],
    pos: { ...fighter.pos },
  } as CombatantState;
  mem.combatants.set(monk.id, monk);
  const flurry = shouldAttemptFeat(mem, monk, "flurry_of_blows", {
    hints: gatherBattlefieldHints(mem, monk),
    capabilities: ["flurry_of_blows"],
  });
  console.log("flurry_of_blows:", flurry.attempt, flurry.reason);

  const composed = composePackets(mem, rogue, rogueProfile, rHints);
  assert(composed.length > 0, "composed packets empty");
  const breakdown = composed[0]!.scoreBreakdown.join(" ");
  assert(
    /feat(Try|Skip):sneak_attack/.test(breakdown) ||
      composed[0]!.featAttempts.some((f) => f.featId === "sneak_attack"),
    `sneak_attack missing from packet scoring: ${breakdown}`,
  );

  const plan = runGrandmasterLoop(mem, rogue);
  const feats = plan.packetSelection?.featAttempts ?? [];
  console.log(
    "GM featAttempts:",
    feats.map((f) => `${f.id}:${f.attempt ? "try" : "skip"}(${f.reason})`).join(" | ") ||
      "(none)",
  );
  assert(
    feats.some((f) => f.id === "sneak_attack"),
    "expected sneak_attack in GM featAttempts",
  );

  console.log("smoke-feat-gates OK");
}

main();
