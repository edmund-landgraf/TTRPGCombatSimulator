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
  map: number;
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
  events: CombatEvent[];
  /** Dual-commander decision tree (party-commander / enemy-commander). */
  decisionLog: DecisionNode[];
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
    events: [],
    decisionLog: [],
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
