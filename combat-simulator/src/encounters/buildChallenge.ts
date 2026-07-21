import type { EncounterFixture, Position } from "../memory/schemas.js";
import { buildClassicFourCells } from "../map/buildClassicMap.js";
import {
  creatureXp,
  type ThreatLevel,
  xpBudget,
} from "./pf2eBudget.js";
import { ENEMY_TEMPLATES, instantiate, PC_TEMPLATES, templateByKey } from "./templates.js";

export type ChallengeSpec = {
  partySize: 3 | 4 | 5;
  threat: ThreatLevel;
  partyLevel?: number;
  seedTag?: string;
};

const PARTY_KEYS: Record<3 | 4 | 5, string[]> = {
  3: ["fighter", "rogue", "cleric"],
  4: ["fighter", "wizard", "rogue", "cleric"],
  5: ["fighter", "wizard", "rogue", "cleric", "champion"],
};

const PARTY_STARTS: Position[] = [
  { x: 3, y: 8 },
  { x: 5, y: 8 },
  { x: 7, y: 8 },
  { x: 9, y: 8 },
  { x: 4, y: 9 },
];

const ENEMY_STARTS: Position[] = [
  { x: 3, y: 5 },
  { x: 5, y: 5 },
  { x: 7, y: 5 },
  { x: 9, y: 5 },
  { x: 4, y: 2 },
  { x: 6, y: 2 },
  { x: 8, y: 2 },
  { x: 10, y: 2 },
  { x: 3, y: 3 },
  { x: 11, y: 3 },
];

/** Trivial foes start farther back so the party usually acts first at range. */
const TRIVIAL_STARTS: Position[] = [
  { x: 4, y: 2 },
  { x: 6, y: 2 },
  { x: 8, y: 2 },
  { x: 10, y: 2 },
];

type Pack = { key: string; count: number };

/**
 * Fit a creature mix to the PF2e XP budget.
 * XP @ PL1: weak L-3=15; warrior/archer L-1=20; shaman/hob L1=40; ogre L3=120.
 */
function enemyPack(threat: ThreatLevel, budget: number): Pack[] {
  const candidates: Pack[][] = [];

  if (threat === "trivial") {
    // Always a single far-back cutpurse. Filling the XP budget with more L-3s
    // still chips PCs in V1a (no heals / poor focus fire).
    candidates.push([{ key: "goblin_weak", count: 1 }]);
  } else if (threat === "moderate") {
    for (let w = 1; w <= 5; w++) {
      for (let a = 0; a <= 3; a++) {
        candidates.push([
          { key: "goblin_warrior", count: w },
          ...(a ? [{ key: "goblin_archer", count: a }] : []),
        ]);
      }
    }
    candidates.push([{ key: "goblin_warrior", count: 2 }, { key: "goblin_shaman", count: 1 }]);
    candidates.push([{ key: "hobgoblin", count: 1 }, { key: "goblin_archer", count: 1 }]);
    candidates.push([{ key: "hobgoblin", count: 2 }]);
  } else if (threat === "hard") {
    candidates.push([
      { key: "goblin_warrior", count: 2 },
      { key: "goblin_archer", count: 2 },
      { key: "goblin_shaman", count: 1 },
    ]);
    for (let w = 2; w <= 5; w++) {
      for (let a = 1; a <= 3; a++) {
        candidates.push([
          { key: "goblin_warrior", count: w },
          { key: "goblin_archer", count: a },
          { key: "goblin_shaman", count: 1 },
        ]);
      }
    }
    candidates.push([
      { key: "hobgoblin", count: 2 },
      { key: "goblin_archer", count: 2 },
    ]);
    candidates.push([
      { key: "hobgoblin", count: 1 },
      { key: "goblin_warrior", count: 2 },
      { key: "goblin_archer", count: 2 },
    ]);
  } else {
    // extreme — include ogre packs and dense goblin+hob mixes
    candidates.push([{ key: "ogre", count: 1 }]);
    candidates.push([{ key: "ogre", count: 1 }, { key: "goblin_archer", count: 1 }]);
    candidates.push([{ key: "ogre", count: 1 }, { key: "goblin_archer", count: 2 }]);
    candidates.push([{ key: "ogre", count: 1 }, { key: "hobgoblin", count: 1 }]);
    candidates.push([
      { key: "goblin_warrior", count: 2 },
      { key: "goblin_archer", count: 2 },
      { key: "goblin_shaman", count: 1 },
      { key: "hobgoblin", count: 1 },
    ]);
    candidates.push([
      { key: "hobgoblin", count: 2 },
      { key: "goblin_shaman", count: 1 },
      { key: "goblin_archer", count: 2 },
    ]);
    candidates.push([
      { key: "goblin_warrior", count: 4 },
      { key: "goblin_archer", count: 2 },
      { key: "goblin_shaman", count: 1 },
    ]);
    candidates.push([
      { key: "ogre", count: 1 },
      { key: "goblin_warrior", count: 2 },
      { key: "goblin_archer", count: 2 },
    ]);
  }

  return nearestPack(budget, candidates);
}

function packXp(pack: Pack[], partyLevel: number): number {
  let xp = 0;
  for (const p of pack) {
    if (p.count <= 0) continue;
    const t = templateByKey(p.key);
    xp += creatureXp(partyLevel, t.creatureLevel) * p.count;
  }
  return xp;
}

function nearestPack(budget: number, options: Pack[][]): Pack[] {
  let best = options[0]!;
  let bestScore = Infinity;
  for (const opt of options) {
    const cleaned = opt.filter((p) => p.count > 0);
    if (cleaned.length === 0) continue;
    const xp = packXp(cleaned, 1);
    const diff = Math.abs(xp - budget);
    // Strongly prefer not going over budget; slight preference for filling it.
    const over = Math.max(0, xp - budget);
    const under = Math.max(0, budget - xp);
    const score = diff + over * 2 + under * 0.25;
    if (score < bestScore) {
      bestScore = score;
      best = cleaned;
    }
  }
  return best;
}

export type BuiltChallenge = {
  fixture: EncounterFixture;
  threat: ThreatLevel;
  partySize: number;
  partyLevel: number;
  budgetXp: number;
  actualXp: number;
  enemyKeys: string[];
};

export function buildChallenge(spec: ChallengeSpec): BuiltChallenge {
  const partyLevel = spec.partyLevel ?? 1;
  const budget = xpBudget(spec.threat, spec.partySize, partyLevel);
  const pack = enemyPack(spec.threat, budget);
  const actualXp = packXp(pack, partyLevel);

  const partyKeys = PARTY_KEYS[spec.partySize];
  const combatants = [];

  for (let i = 0; i < partyKeys.length; i++) {
    const key = partyKeys[i]!;
    const tmpl = PC_TEMPLATES.find((t) => t.key === key)!;
    const idMap: Record<string, string> = {
      fighter: "FTR",
      wizard: "WIZ",
      rogue: "ROG",
      cleric: "CLR",
      champion: "CHP",
    };
    combatants.push(instantiate(tmpl, idMap[key]!, PARTY_STARTS[i]!));
  }

  const enemyKeys: string[] = [];
  let ei = 0;
  const counts: Record<string, number> = {};
  const starts = spec.threat === "trivial" ? TRIVIAL_STARTS : ENEMY_STARTS;
  for (const p of pack) {
    for (let n = 0; n < p.count; n++) {
      counts[p.key] = (counts[p.key] ?? 0) + 1;
      const tmpl = ENEMY_TEMPLATES.find((t) => t.key === p.key)!;
      const idx = counts[p.key]!;
      const id = `${tmpl.tokenChar.toUpperCase()}${idx}`;
      const start = starts[ei % starts.length]!;
      ei++;
      enemyKeys.push(p.key);
      combatants.push(
        instantiate(tmpl, id, start, tmpl.key.includes("goblin") || tmpl.key === "hobgoblin" ? String(idx) : undefined),
      );
    }
  }

  // Deduplicate overlapping starts by nudging
  const used = new Set<string>();
  for (const c of combatants) {
    let { x, y } = c.start;
    let guard = 0;
    while (used.has(`${x},${y}`) && guard++ < 20) {
      x = Math.min(11, x + 1);
      if (x >= 11) {
        x = 2;
        y = Math.max(2, y - 1);
      }
    }
    c.start = { x, y };
    used.add(`${x},${y}`);
  }

  const id = `pl${partyLevel}-p${spec.partySize}-${spec.threat}`;
  const fixture: EncounterFixture = {
    id,
    name: `PL${partyLevel} party×${spec.partySize} vs ${spec.threat} (${actualXp}/${budget} XP)`,
    ruleset: "pf2e",
    width: 12,
    height: 10,
    cells: buildClassicFourCells(12, 10),
    combatants,
    hazards: [],
  };

  return {
    fixture,
    threat: spec.threat,
    partySize: spec.partySize,
    partyLevel,
    budgetXp: budget,
    actualXp,
    enemyKeys,
  };
}
