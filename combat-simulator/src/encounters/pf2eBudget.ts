/**
 * Pathfinder 2e encounter XP budgets (Core Rulebook / GM Core).
 * "hard" maps to PF2e Severe.
 */
export type ThreatLevel = "trivial" | "moderate" | "hard" | "extreme";

/** XP budget for a party of 4. */
export const BUDGET_PARTY_OF_4: Record<ThreatLevel, number> = {
  trivial: 40,
  moderate: 80,
  hard: 120, // Severe
  extreme: 160,
};

/** XP for a creature relative to party level (level delta = creatureLevel - partyLevel). */
export function xpForLevelDelta(delta: number): number {
  const table: Record<number, number> = {
    [-4]: 10,
    [-3]: 15,
    [-2]: 20,
    [-1]: 30,
    [0]: 40,
    [1]: 60,
    [2]: 80,
    [3]: 120,
    [4]: 160,
  };
  if (delta in table) return table[delta]!;
  if (delta < -4) return 10;
  if (delta > 4) return 160;
  return 40;
}

export function creatureXp(partyLevel: number, creatureLevel: number): number {
  return xpForLevelDelta(creatureLevel - partyLevel);
}

/**
 * Official adjustment: for each PC above/below 4, add/subtract XP equal to
 * a creature of the PCs' level (40 XP at typical party levels).
 */
export function xpBudget(threat: ThreatLevel, partySize: number, partyLevel = 1): number {
  const base = BUDGET_PARTY_OF_4[threat];
  const perPc = xpForLevelDelta(0); // creature at party level
  return Math.max(10, base + (partySize - 4) * perPc);
}

export const THREAT_EXPECTATION: Record<
  ThreatLevel,
  { label: string; expectInjuries: boolean; expectDeaths: boolean; note: string }
> = {
  trivial: {
    label: "Trivial",
    expectInjuries: false,
    expectDeaths: false,
    note: "Should be a curb-stomp; ideally no PC damage.",
  },
  moderate: {
    label: "Moderate",
    expectInjuries: true,
    expectDeaths: false,
    note: "Typical fight; damage OK, PC deaths rare.",
  },
  hard: {
    label: "Hard (Severe)",
    expectInjuries: true,
    expectDeaths: false,
    note: "Tough; injuries expected, deaths uncommon.",
  },
  extreme: {
    label: "Extreme",
    expectInjuries: true,
    expectDeaths: true,
    note: "Deadly; some PC deaths expected.",
  },
};
