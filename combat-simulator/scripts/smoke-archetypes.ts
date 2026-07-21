/**
 * Smoke: archetype catalog + champion_dedication / archer buildProfile overlays.
 */
import {
  loadArchetypeCatalog,
  lookupArchetype,
  resolveArchetypesForActor,
} from "../src/ai/archetypeLookup.js";
import { resolveBuildProfile } from "../src/ai/buildProfile.js";
import type { CombatantState } from "../src/memory/combatMemory.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function stubActor(archetypes: string[]): CombatantState {
  return {
    id: "smoke",
    name: "Smoke",
    side: "party",
    role: "fighter",
    tokenChar: "S",
    level: 4,
    classId: "",
    archetypes,
    capabilities: [],
    maxHp: 40,
    hp: 40,
    ac: 20,
    speedCells: 5,
    perceptionBonus: 8,
    saveBonus: 8,
    pos: { x: 3, y: 3 },
    weapons: [],
    spells: [],
    spellUses: new Map(),
    aiProfile: { weights: {} },
    tacticsGroup: "frontliner",
    conditions: [],
    afflictions: [],
    downed: false,
    actionsLeft: 3,
    reactionAvailable: true,
    map: 0,
    shieldHardness: 0,
    shieldHp: 0,
    isShieldRaised: false,
  };
}

function main(): void {
  const catalog = loadArchetypeCatalog(true);
  console.log(`catalog: ${catalog.length}`);
  assert(lookupArchetype("champion_dedication"), "missing champion_dedication");
  assert(lookupArchetype("Champion"), "Champion name lookup failed");
  assert(lookupArchetype("archer"), "missing archer");
  assert(lookupArchetype("Archer"), "Archer name lookup failed");

  const resolved = resolveArchetypesForActor(["Champion", "Archer"]);
  assert(resolved.tags.includes("champion_dedication"), `tags=${resolved.tags}`);
  assert(resolved.tags.includes("archer"), `tags=${resolved.tags}`);
  assert(
    resolved.grantCapabilities.includes("reactive_strike"),
    `grants=${resolved.grantCapabilities}`,
  );

  const profile = resolveBuildProfile(stubActor(["Champion", "Archer"]));
  console.log("tags:", profile.archetypes.join(", "));
  console.log("caps:", profile.capabilities.join(", "));
  console.log(
    "overlays:",
    profile.overlays.map((o) => o.id).join(", "),
  );
  assert(profile.archetypes.includes("champion_dedication"));
  assert(profile.archetypes.includes("archer"));
  assert(profile.capabilities.includes("reactive_strike"));
  assert(
    profile.overlays.some(
      (o) => o.id === "champion_dedication" || o.id === "archer",
    ),
    "expected champion or archer overlay",
  );

  console.log("smoke-archetypes OK");
}

main();
