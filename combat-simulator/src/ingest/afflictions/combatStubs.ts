import type { z } from "zod";
import { AfflictionStageSchema } from "../../memory/schemas.js";

type StageInput = z.input<typeof AfflictionStageSchema>;

export type CombatAfflictionStub = {
  id: string;
  name: string;
  matchNames: string[];
  kind: "poison" | "disease" | "curse" | "other";
  level?: number;
  saveDc: number;
  virulent?: boolean;
  maxDurationRounds?: number;
  stages: StageInput[];
  allowMissingAon?: boolean;
  /** Filled at ingest when matched. */
  aonId?: number;
  aonUrl?: string;
  summary?: string;
};

/** First combat-ready affliction stubs (1-round injury poisons + sample disease/curse). */
export const COMBAT_AFFLICTION_STUBS: CombatAfflictionStub[] = [
  {
    id: "giant_centipede_venom",
    name: "Giant Centipede Venom",
    matchNames: ["Giant Centipede Venom"],
    kind: "poison",
    level: 1,
    saveDc: 17,
    maxDurationRounds: 6,
    stages: [
      {
        damageDice: 1,
        damageDie: 4,
        damageBonus: 0,
        conditions: [],
        intervalRounds: 1,
      },
      {
        damageDice: 1,
        damageDie: 4,
        damageBonus: 0,
        conditions: ["fatigued"],
        intervalRounds: 1,
      },
      {
        damageDice: 1,
        damageDie: 4,
        damageBonus: 0,
        conditions: ["clumsy", "fatigued"],
        conditionValue: 1,
        intervalRounds: 1,
      },
    ],
  },
  {
    id: "arsenic",
    name: "Arsenic",
    matchNames: ["Arsenic"],
    kind: "poison",
    level: 1,
    saveDc: 18,
    maxDurationRounds: 10,
    stages: [
      {
        damageDice: 1,
        damageDie: 6,
        conditions: [],
        intervalRounds: 1,
      },
      {
        damageDice: 1,
        damageDie: 8,
        conditions: ["sickened"],
        conditionValue: 1,
        intervalRounds: 1,
      },
      {
        damageDice: 2,
        damageDie: 6,
        conditions: ["sickened"],
        conditionValue: 2,
        intervalRounds: 1,
      },
    ],
  },
  {
    id: "black_adder_venom",
    name: "Black Adder Venom",
    matchNames: ["Black Adder Venom"],
    kind: "poison",
    level: 2,
    saveDc: 18,
    maxDurationRounds: 6,
    stages: [
      {
        damageDice: 1,
        damageDie: 8,
        conditions: [],
        intervalRounds: 1,
      },
      {
        damageDice: 1,
        damageDie: 10,
        conditions: ["drained"],
        conditionValue: 1,
        intervalRounds: 1,
      },
      {
        damageDice: 1,
        damageDie: 12,
        conditions: ["drained"],
        conditionValue: 1,
        intervalRounds: 1,
      },
    ],
  },
  {
    id: "giant_scorpion_venom",
    name: "Giant Scorpion Venom",
    matchNames: ["Giant Scorpion Venom"],
    kind: "poison",
    level: 6,
    saveDc: 22,
    maxDurationRounds: 6,
    stages: [
      {
        damageDice: 1,
        damageDie: 10,
        conditions: ["enfeebled"],
        conditionValue: 1,
        intervalRounds: 1,
      },
      {
        damageDice: 2,
        damageDie: 8,
        conditions: ["enfeebled"],
        conditionValue: 1,
        intervalRounds: 1,
      },
      {
        damageDice: 2,
        damageDie: 10,
        conditions: ["enfeebled"],
        conditionValue: 2,
        intervalRounds: 1,
      },
    ],
  },
  {
    id: "wyvern_poison",
    name: "Wyvern Poison",
    matchNames: ["Wyvern Poison"],
    kind: "poison",
    level: 5,
    saveDc: 22,
    maxDurationRounds: 6,
    stages: [
      {
        damageDice: 3,
        damageDie: 6,
        conditions: [],
        intervalRounds: 1,
      },
      {
        damageDice: 3,
        damageDie: 8,
        conditions: [],
        intervalRounds: 1,
      },
      {
        damageDice: 3,
        damageDie: 10,
        conditions: ["clumsy"],
        conditionValue: 1,
        intervalRounds: 1,
      },
    ],
  },
  {
    id: "goblin_pox",
    name: "Goblin Pox",
    matchNames: ["Goblin Pox"],
    kind: "disease",
    level: 1,
    saveDc: 14,
    // Disease intervals are normally days — combat stub uses 2 rounds for demo.
    maxDurationRounds: 10,
    stages: [
      {
        damageDice: 0,
        conditions: ["sickened"],
        conditionValue: 1,
        intervalRounds: 2,
      },
      {
        damageDice: 0,
        conditions: ["sickened"],
        conditionValue: 1,
        intervalRounds: 2,
      },
      {
        damageDice: 0,
        conditions: ["sickened"],
        conditionValue: 2,
        intervalRounds: 2,
      },
    ],
  },
  {
    id: "blightburn",
    name: "Blightburn",
    matchNames: ["Blightburn"],
    kind: "disease",
    level: 15,
    saveDc: 34,
    virulent: true,
    maxDurationRounds: 20,
    allowMissingAon: true,
    stages: [
      {
        damageDice: 2,
        damageDie: 6,
        conditions: ["drained"],
        conditionValue: 1,
        intervalRounds: 1,
      },
      {
        damageDice: 3,
        damageDie: 6,
        conditions: ["drained"],
        conditionValue: 2,
        intervalRounds: 1,
      },
      {
        damageDice: 4,
        damageDie: 6,
        conditions: ["drained"],
        conditionValue: 3,
        intervalRounds: 1,
      },
    ],
  },
];
