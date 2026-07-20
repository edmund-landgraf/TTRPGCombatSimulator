import type {
  AiProfile,
  EncounterFixture,
  Position,
  Spell,
  TacticsGroupId,
  Weapon,
  WeightDelta,
} from "./schemas.js";
import { cellId } from "./schemas.js";
import type { Grid } from "../map/grid.js";
import { buildGrid } from "../map/grid.js";
import type { DecisionNode } from "../ai/decisionLog.js";
import type { CombatStateSnapshot } from "../ai/combatStateParser.js";
import type { GrandmasterTurnPlan } from "../ai/grandmasterLoop.js";
import { resolveTacticsGroup } from "../ai/tacticsGroups.js";

export type Condition = { id: string; name: string; value?: number };

export type CombatantState = {
  id: string;
  name: string;
  side: "party" | "enemy";
  role: string;
  tokenChar: string;
  /** Creature/PC level (spell rank gate). */
  level: number;
  /** Class / creature id for packet composition. */
  classId: string;
  /** Dedication / monster-family archetype tags. */
  archetypes: string[];
  /** Combat capability tags (feats / class features). */
  capabilities: string[];
  maxHp: number;
  hp: number;
  ac: number;
  speedCells: number;
  perceptionBonus: number;
  saveBonus: number;
  pos: Position;
  weapons: Weapon[];
  spells: Spell[];
  /** Ranked spell id → times used this combat. */
  spellUses: Map<string, number>;
  aiProfile: AiProfile;
  /** Primary tactics group driving AI playstyle. */
  tacticsGroup: TacticsGroupId;
  /** Optional secondary group blended under the primary. */
  tacticsSecondary?: TacticsGroupId;
  conditions: Condition[];
  downed: boolean;
  actionsLeft: number;
  reactionAvailable: boolean;
  /** Attack-trait actions taken this turn (drives MAP). */
  map: number;
  shieldHardness: number;
  shieldHp: number;
  /** Raised this turn (AC +2 circumstance; cleared on EOT decay). */
  isShieldRaised: boolean;
};

export type CombatEvent =
  | {
      t: "initiative";
      order: { id: string; total: number }[];
    }
  | {
      t: "move";
      round: number;
      actor: string;
      from: string;
      to: string;
      kind: "Stride" | "Step";
    }
  | {
      t: "hazard";
      round: number;
      actor: string;
      cell: string;
      dmg: number;
      hpAfter: number;
    }
  | {
      /** Spell (or effect) painted lasting terrain onto the grid (e.g. Grease → G). */
      t: "terrain";
      round: number;
      actor: string;
      spell: string;
      spellName: string;
      tag: string;
      glyph: string;
      cells: string[];
      /** Rounds the effect lasts (0 = until combat end). */
      durationRounds: number;
      /** Last round the terrain remains (inclusive); 0 if permanent. */
      expiresAtEndOfRound: number;
      effectId: string;
    }
  | {
      /** Timed terrain effect expired and was cleared from the grid. */
      t: "terrain_expire";
      round: number;
      spell: string;
      spellName: string;
      tag: string;
      glyph: string;
      cells: string[];
      effectId: string;
    }
  | {
      t: "attack";
      round: number;
      actor: string;
      target: string;
      weapon: string;
      weaponName: string;
      d20: number;
      mod: number;
      total: number;
      ac: number;
      hit: boolean;
      crit: boolean;
      damageExpr: string;
      diceRolls: number[];
      damageBonus: number;
      dmg: number;
      hpAfter: number;
      map: number;
    }
  | {
      t: "spell";
      round: number;
      actor: string;
      target: string;
      spell: string;
      spellName: string;
      kind: "attack" | "save" | "heal";
      d20?: number;
      mod?: number;
      total?: number;
      ac?: number;
      hit?: boolean;
      crit?: boolean;
      saveRoll?: number;
      saveBonus?: number;
      saveTotal?: number;
      saveDc?: number;
      saved?: boolean;
      damageExpr?: string;
      diceRolls?: number[];
      damageBonus?: number;
      dmg: number;
      healAmt?: number;
      hpAfter: number;
      actionsSpent: number;
      map: number;
      appliedCondition?: string;
    }
  | {
      t: "reject";
      round: number;
      actor: string;
      reason: string;
    }
  | {
      t: "end_turn";
      round: number;
      actor: string;
    }
  | {
      t: "recovery_check";
      round: number;
      actor: string;
      d20: number;
      dc: number;
      outcome: "crit_success" | "success" | "failure" | "crit_failure";
      dyingBefore: number;
      dyingAfter: number;
      died: boolean;
    }
  | {
      t: "death";
      round: number;
      actor: string;
      reason: string;
    }
  | {
      t: "delay";
      round: number;
      actor: string;
      originalIndex: number;
    }
  | {
      t: "delay_return";
      round: number;
      actor: string;
      after: string;
    }
  | {
      t: "delay_forfeit";
      round: number;
      actor: string;
    }
  | {
      t: "round_end";
      round: number;
    }
  | {
      t: "combat_end";
      reason: string;
      winner: "party" | "enemy" | "draw";
    };

/** Actor removed from initiative via Delay until they return or forfeit. */
export type DelayedEntry = {
  round: number;
  originalIndex: number;
};

/** Spell-created terrain with a tracked duration (e.g. Grease). */
export type ActiveTerrainEffect = {
  id: string;
  spellId: string;
  spellName: string;
  tag: string;
  glyph: string;
  cells: string[];
  createdRound: number;
  /** 0 = permanent for the encounter. */
  durationRounds: number;
  /** Inclusive last round; 0 if permanent. */
  expiresAtEndOfRound: number;
  casterId: string;
};

export type CombatMemory = {
  encounterId: string;
  name: string;
  ruleset: "pf2e";
  seed: number;
  round: number;
  grid: Grid;
  combatants: Map<string, CombatantState>;
  initiative: string[];
  initIndex: number;
  /** Currently Delayed combatants (not in initiative until return). */
  delayed: Map<string, DelayedEntry>;
  /** Timed AoE terrain patches still on the map. */
  activeTerrain: ActiveTerrainEffect[];
  events: CombatEvent[];
  /** Dual-commander decision tree (party-commander / enemy-commander). */
  decisionLog: DecisionNode[];
  /** Per-turn Grandmaster Combat Loop plans (Steps 1–6 + 3-action budgets). */
  grandmasterPlans: GrandmasterTurnPlan[];
  /** Active plan for the combatant currently taking a turn (AI guidance). */
  activeGrandmasterPlan?: GrandmasterTurnPlan;
  /** Latest Real-Time Combat State Parser snapshot for the active actor. */
  activeCombatState?: CombatStateSnapshot;
  weightDeltas: WeightDelta[];
  notes: string;
  hpAtRoundStart: Map<string, number>;
};

export function createMemory(
  fixture: EncounterFixture,
  seed: number,
  notes = "",
): CombatMemory {
  const grid = buildGrid(fixture);
  const combatants = new Map<string, CombatantState>();
  for (const c of fixture.combatants) {
    combatants.set(c.id, {
      id: c.id,
      name: c.name,
      side: c.side,
      role: c.role,
      tokenChar: c.tokenChar,
      level: c.level ?? 1,
      classId: c.classId ?? c.role.toLowerCase().replace(/\s+/g, "_"),
      archetypes: c.archetypes ?? [],
      capabilities: c.capabilities ?? [],
      maxHp: c.maxHp,
      hp: c.maxHp,
      ac: c.ac,
      speedCells: c.speedCells,
      perceptionBonus: c.perceptionBonus,
      saveBonus: c.saveBonus ?? 3,
      pos: { ...c.start },
      weapons: c.weapons,
      spells: c.spells ?? [],
      spellUses: new Map(),
      aiProfile: c.aiProfile,
      tacticsGroup: resolveTacticsGroup(c.tacticsGroup, c.role),
      tacticsSecondary: c.tacticsSecondary,
      conditions: [],
      downed: false,
      actionsLeft: 3,
      reactionAvailable: true,
      map: 0,
      shieldHardness: c.shieldHardness ?? 0,
      shieldHp: c.shieldHp ?? 0,
      isShieldRaised: false,
    });
  }
  return {
    encounterId: fixture.id,
    name: fixture.name,
    ruleset: "pf2e",
    seed,
    round: 0,
    grid,
    combatants,
    initiative: [],
    initIndex: 0,
    delayed: new Map(),
    activeTerrain: [],
    events: [],
    decisionLog: [],
    grandmasterPlans: [],
    weightDeltas: [],
    notes,
    hpAtRoundStart: new Map(),
  };
}

export function living(mem: CombatMemory, side?: "party" | "enemy"): CombatantState[] {
  return [...mem.combatants.values()].filter(
    (c) => !c.downed && (side ? c.side === side : true),
  );
}

export function occupiedKeys(mem: CombatMemory, exceptId?: string): Set<string> {
  const s = new Set<string>();
  for (const c of mem.combatants.values()) {
    if (c.downed) continue;
    if (exceptId && c.id === exceptId) continue;
    s.add(cellId(c.pos));
  }
  return s;
}

export function snapshotHp(mem: CombatMemory): void {
  mem.hpAtRoundStart.clear();
  for (const c of mem.combatants.values()) {
    mem.hpAtRoundStart.set(c.id, c.hp);
  }
}
