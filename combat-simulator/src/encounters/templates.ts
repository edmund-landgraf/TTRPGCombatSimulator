import {
  CombatantFixtureSchema,
  type CombatantFixture,
  type Position,
  type Spell,
  type TacticsGroupId,
} from "../memory/schemas.js";
import { defaultTacticsGroupForRole } from "../ai/tacticsGroups.js";

type Template = Omit<
  CombatantFixture,
  | "id"
  | "name"
  | "start"
  | "tokenChar"
  | "saveBonus"
  | "spells"
  | "level"
  | "tacticsGroup"
  | "tacticsSecondary"
> & {
  key: string;
  name: string;
  tokenChar: string;
  /** Creature level for XP + spell-rank gating (mapped to fixture `level` on instantiate). */
  creatureLevel: number;
  saveBonus?: number;
  /** Partial spell defs; Zod fills defaults on instantiate. */
  spells?: Array<Partial<Spell> & Pick<Spell, "id" | "name" | "kind">>;
  tacticsGroup?: TacticsGroupId;
  tacticsSecondary?: TacticsGroupId;
};

export const PC_TEMPLATES: Template[] = [
  {
    key: "fighter",
    name: "Fighter",
    tokenChar: "F",
    side: "party",
    role: "fighter",
    tacticsGroup: "frontliner",
    creatureLevel: 1,
    maxHp: 20,
    ac: 18,
    speedCells: 5,
    perceptionBonus: 3,
    weapons: [
      {
        id: "longsword",
        kind: "melee",
        attackBonus: 7,
        damageDice: 1,
        damageDie: 8,
        damageBonus: 4,
        reach: 1,
      },
    ],
    aiProfile: {
      weights: {
        Strike_melee: 1.4,
        Strike_ranged: 0.1,
        Stride_close: 1.2,
        Stride_cover: 0.3,
        Step_away: 0.2,
        Delay: 0.7,
        End_turn: 0.1,
      },
      featureBias: { selfPreservation: 0.3, focusCaster: 0.4 },
    },
  },
  {
    key: "wizard",
    name: "Wizard",
    tokenChar: "W",
    side: "party",
    role: "wizard",
    tacticsGroup: "blaster",
    creatureLevel: 1,
    maxHp: 14,
    ac: 15,
    speedCells: 5,
    perceptionBonus: 2,
    saveBonus: 4,
    weapons: [
      {
        id: "staff",
        kind: "melee",
        attackBonus: 3,
        damageDice: 1,
        damageDie: 4,
        damageBonus: 0,
        reach: 1,
      },
    ],
    spells: [
      {
        id: "produce_flame",
        name: "Produce Flame",
        kind: "attack",
        rank: 0,
        actions: 2,
        attackBonus: 7,
        damageDice: 1,
        damageDie: 4,
        damageBonus: 4,
        rangeCells: 6,
        tactic: "offense",
      },
      {
        id: "electric_arc",
        name: "Electric Arc",
        kind: "save",
        rank: 0,
        actions: 2,
        damageDice: 1,
        damageDie: 4,
        damageBonus: 4,
        rangeCells: 6,
        saveDc: 17,
        halfOnSave: true,
        tactic: "offense",
      },
      {
        id: "grease",
        name: "Grease",
        kind: "save",
        rank: 1,
        actions: 2,
        rangeCells: 6,
        saveDc: 17,
        halfOnSave: false,
        usesPerCombat: 2,
        tactic: "control",
        applyCondition: "off-guard",
      },
      {
        id: "sleep",
        name: "Sleep",
        kind: "save",
        rank: 1,
        actions: 2,
        rangeCells: 6,
        saveDc: 17,
        halfOnSave: false,
        usesPerCombat: 1,
        tactic: "crowd_control",
        applyCondition: "asleep",
        skipIfSaveBonusGte: 5,
      },
    ],
    aiProfile: {
      weights: {
        Cast_cantrip: 1.8,
        Cast_spell: 1.2,
        Strike_melee: 0.05,
        Strike_ranged: 0.2,
        Stride_close: 0.9,
        Stride_cover: 0.9,
        Step_away: 1.0,
        Delay: 0.05,
        End_turn: 0.2,
      },
      featureBias: { preferCover: 0.8, selfPreservation: 0.9 },
    },
  },
  {
    key: "rogue",
    name: "Rogue",
    tokenChar: "R",
    side: "party",
    role: "rogue",
    tacticsGroup: "flanker",
    creatureLevel: 1,
    maxHp: 16,
    ac: 17,
    speedCells: 6,
    perceptionBonus: 5,
    weapons: [
      {
        id: "shortsword",
        kind: "melee",
        attackBonus: 6,
        damageDice: 1,
        damageDie: 6,
        damageBonus: 3,
        reach: 1,
      },
      {
        id: "shortbow",
        kind: "ranged",
        attackBonus: 6,
        damageDice: 1,
        damageDie: 6,
        damageBonus: 1,
        rangeCells: 12,
        reach: 1,
      },
    ],
    aiProfile: {
      weights: {
        Strike_melee: 1.25,
        Strike_ranged: 1.15,
        Stride_close: 0.7,
        Stride_cover: 0.35,
        Step_away: 0.55,
        End_turn: 0.1,
      },
      // Stay back with casters; only close when a flank/sneak cell scores.
      featureBias: { selfPreservation: 0.55 },
    },
  },
  {
    key: "cleric",
    name: "Cleric",
    tokenChar: "C",
    side: "party",
    role: "cleric",
    tacticsGroup: "healer",
    creatureLevel: 1,
    maxHp: 18,
    ac: 17,
    speedCells: 5,
    perceptionBonus: 3,
    saveBonus: 5,
    weapons: [
      {
        id: "mace",
        kind: "melee",
        attackBonus: 6,
        damageDice: 1,
        damageDie: 8,
        damageBonus: 2,
        reach: 1,
      },
    ],
    spells: [
      {
        id: "divine_lance",
        name: "Divine Lance",
        kind: "attack",
        rank: 0,
        actions: 2,
        attackBonus: 7,
        damageDice: 1,
        damageDie: 4,
        damageBonus: 4,
        rangeCells: 6,
        tactic: "offense",
      },
      {
        id: "heal",
        name: "Heal",
        kind: "heal",
        rank: 1,
        actions: 2,
        healDice: 1,
        healDie: 8,
        healBonus: 8,
        rangeCells: 6,
        usesPerCombat: 3,
        tactic: "heal",
      },
    ],
    aiProfile: {
      weights: {
        Cast_cantrip: 1.5,
        Heal_ally: 2.0,
        Cast_spell: 0.8,
        Strike_melee: 0.25,
        Strike_ranged: 0.1,
        Stride_close: 0.5,
        Stride_cover: 0.4,
        Step_away: 0.3,
        End_turn: 0.1,
      },
      featureBias: { selfPreservation: 0.4 },
    },
  },
  {
    key: "champion",
    name: "Champion",
    tokenChar: "H",
    side: "party",
    role: "champion",
    tacticsGroup: "frontliner",
    creatureLevel: 1,
    maxHp: 22,
    ac: 19,
    speedCells: 5,
    perceptionBonus: 3,
    weapons: [
      {
        id: "warhammer",
        kind: "melee",
        attackBonus: 7,
        damageDice: 1,
        damageDie: 8,
        damageBonus: 3,
        reach: 1,
      },
    ],
    aiProfile: {
      weights: {
        Strike_melee: 1.3,
        Strike_ranged: 0.1,
        Stride_close: 1.1,
        Stride_cover: 0.4,
        Step_away: 0.2,
        End_turn: 0.1,
      },
      featureBias: { selfPreservation: 0.35, focusCaster: 0.3 },
    },
  },
];

export const ENEMY_TEMPLATES: Template[] = [
  {
    key: "goblin_weak",
    name: "Goblin Cutpurse",
    tokenChar: "g",
    side: "enemy",
    role: "minion",
    tacticsGroup: "frontliner",
    creatureLevel: -3,
    maxHp: 4,
    ac: 13,
    speedCells: 5,
    perceptionBonus: 0,
    weapons: [
      {
        id: "dogslicer",
        kind: "melee",
        attackBonus: 2,
        damageDice: 1,
        damageDie: 4,
        damageBonus: 0,
        reach: 1,
      },
    ],
    aiProfile: {
      weights: {
        Strike_melee: 0.9,
        Strike_ranged: 0.1,
        Stride_close: 0.7,
        Stride_cover: 0.2,
        Step_away: 0.4,
        End_turn: 0.3,
      },
    },
  },
  {
    key: "goblin_warrior",
    name: "Goblin Warrior",
    tokenChar: "b",
    side: "enemy",
    role: "blade",
    tacticsGroup: "frontliner",
    creatureLevel: -1,
    maxHp: 12,
    ac: 16,
    speedCells: 5,
    perceptionBonus: 2,
    saveBonus: 3,
    weapons: [
      {
        id: "dogslicer",
        kind: "melee",
        attackBonus: 5,
        damageDice: 1,
        damageDie: 6,
        damageBonus: 2,
        reach: 1,
      },
    ],
    aiProfile: {
      weights: {
        Strike_melee: 1.3,
        Strike_ranged: 0.1,
        Stride_close: 1.0,
        Stride_cover: 0.2,
        Step_away: 0.2,
        End_turn: 0.1,
      },
    },
  },
  {
    key: "goblin_archer",
    name: "Goblin Archer",
    tokenChar: "a",
    side: "enemy",
    role: "archer",
    tacticsGroup: "archer",
    creatureLevel: -1,
    maxHp: 10,
    ac: 15,
    speedCells: 5,
    perceptionBonus: 3,
    weapons: [
      {
        id: "shortbow",
        kind: "ranged",
        attackBonus: 5,
        damageDice: 1,
        damageDie: 6,
        damageBonus: 1,
        rangeCells: 12,
        reach: 1,
      },
    ],
    aiProfile: {
      weights: {
        Strike_melee: 0.15,
        Strike_ranged: 1.65,
        Stride_close: 0.15,
        Stride_cover: 0.35,
        Step_away: 1.1,
        End_turn: 0.1,
      },
      // Shoot from the back line — do not advance into the scrum.
      featureBias: { preferCover: 0.25, focusCaster: 0.6, selfPreservation: 0.7 },
    },
  },
  {
    key: "goblin_shaman",
    name: "Goblin Shaman",
    tokenChar: "S",
    side: "enemy",
    role: "shaman",
    tacticsGroup: "blaster",
    creatureLevel: 1,
    maxHp: 15,
    ac: 15,
    speedCells: 5,
    perceptionBonus: 2,
    saveBonus: 4,
    weapons: [
      {
        id: "spear",
        kind: "melee",
        attackBonus: 4,
        damageDice: 1,
        damageDie: 6,
        damageBonus: 1,
        reach: 1,
      },
    ],
    spells: [
      {
        id: "produce_flame",
        name: "Produce Flame",
        kind: "attack",
        rank: 0,
        actions: 2,
        attackBonus: 6,
        damageDice: 1,
        damageDie: 4,
        damageBonus: 3,
        rangeCells: 6,
      },
    ],
    aiProfile: {
      weights: {
        Cast_cantrip: 1.6,
        Strike_melee: 0.25,
        Strike_ranged: 0.2,
        Stride_close: 0.15,
        Stride_cover: 0.55,
        Step_away: 1.15,
        End_turn: 0.2,
      },
      // Stay visible on the back line casting — don't vanish into the melee pile.
      featureBias: { preferCover: 0.45, selfPreservation: 0.9, focusCaster: 0.5 },
    },
  },
  {
    key: "hobgoblin",
    name: "Hobgoblin Soldier",
    tokenChar: "B",
    side: "enemy",
    role: "soldier",
    tacticsGroup: "frontliner",
    creatureLevel: 1,
    maxHp: 20,
    ac: 17,
    speedCells: 5,
    perceptionBonus: 3,
    saveBonus: 5,
    weapons: [
      {
        id: "longsword",
        kind: "melee",
        attackBonus: 7,
        damageDice: 1,
        damageDie: 8,
        damageBonus: 3,
        reach: 1,
      },
    ],
    aiProfile: {
      weights: {
        Strike_melee: 1.4,
        Strike_ranged: 0.1,
        Stride_close: 1.1,
        Stride_cover: 0.3,
        Step_away: 0.2,
        End_turn: 0.1,
      },
      featureBias: { focusCaster: 0.5 },
    },
  },
  {
    key: "ogre",
    name: "Ogre",
    tokenChar: "O",
    side: "enemy",
    role: "brute",
    tacticsGroup: "frontliner",
    creatureLevel: 3,
    maxHp: 50,
    ac: 17,
    speedCells: 5,
    perceptionBonus: 2,
    saveBonus: 7,
    weapons: [
      {
        id: "greatclub",
        kind: "melee",
        attackBonus: 12,
        damageDice: 2,
        damageDie: 10,
        damageBonus: 5,
        reach: 2,
      },
    ],
    aiProfile: {
      weights: {
        Strike_melee: 1.6,
        Strike_ranged: 0.0,
        Stride_close: 1.2,
        Stride_cover: 0.1,
        Step_away: 0.1,
        End_turn: 0.05,
      },
      featureBias: { focusCaster: 0.7 },
    },
  },
];

export function instantiate(
  template: Template,
  id: string,
  start: Position,
  nameSuffix?: string,
): CombatantFixture {
  const { key: _k, creatureLevel, ...rest } = template;
  return CombatantFixtureSchema.parse({
    ...rest,
    id,
    name: nameSuffix ? `${template.name} ${nameSuffix}` : template.name,
    start,
    tokenChar: template.tokenChar,
    level: creatureLevel,
    spells: rest.spells ?? [],
    saveBonus: rest.saveBonus ?? 3,
    tacticsGroup: rest.tacticsGroup ?? defaultTacticsGroupForRole(template.role),
  });
}

export function templateByKey(key: string): Template {
  const t = [...PC_TEMPLATES, ...ENEMY_TEMPLATES].find((x) => x.key === key);
  if (!t) throw new Error(`Unknown template: ${key}`);
  return t;
}
