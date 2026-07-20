import { z } from "zod";

export const PositionSchema = z.object({
  x: z.number().int().positive(),
  y: z.number().int().positive(),
});
export type Position = z.infer<typeof PositionSchema>;

export const ActionHeadSchema = z.enum([
  "Strike_melee",
  "Strike_ranged",
  "Cast_cantrip",
  "Cast_spell",
  "Heal_ally",
  "Stride_close",
  "Stride_cover",
  "Step_away",
  "End_turn",
]);
export type ActionHead = z.infer<typeof ActionHeadSchema>;

export const AiProfileSchema = z.object({
  weights: z.record(z.string(), z.number()),
  featureBias: z
    .object({
      preferCover: z.number().optional(),
      selfPreservation: z.number().optional(),
      focusCaster: z.number().optional(),
    })
    .optional(),
});
export type AiProfile = z.infer<typeof AiProfileSchema>;

export const WeaponSchema = z.object({
  id: z.string(),
  kind: z.enum(["melee", "ranged"]),
  attackBonus: z.number(),
  damageDice: z.number().int().positive(),
  damageDie: z.number().int().positive(),
  damageBonus: z.number().default(0),
  rangeCells: z.number().int().positive().optional(),
  reach: z.number().int().positive().default(1),
});
export type Weapon = z.infer<typeof WeaponSchema>;

export const SpellSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** attack = spell attack roll; save = target saves; heal = restore HP */
  kind: z.enum(["attack", "save", "heal"]),
  /** 0 = cantrip (unlimited). Ranked spells consume a use. */
  rank: z.number().int().min(0).default(0),
  actions: z.number().int().min(1).max(3).default(2),
  attackBonus: z.number().optional(),
  damageDice: z.number().int().positive().optional(),
  damageDie: z.number().int().positive().optional(),
  damageBonus: z.number().default(0),
  healDice: z.number().int().positive().optional(),
  healDie: z.number().int().positive().optional(),
  healBonus: z.number().default(0),
  rangeCells: z.number().int().positive().default(6),
  saveDc: z.number().int().optional(),
  /** Simplified: all saves use this bonus on the target. */
  halfOnSave: z.boolean().default(true),
  /** Uses per combat for ranked spells; omitted/cantrip = unlimited. */
  usesPerCombat: z.number().int().positive().optional(),
  /** Teaching tag for interactive choice tips. */
  tactic: z.enum(["offense", "control", "crowd_control", "heal", "support"]).optional(),
  /** Hide this spell vs targets with saveBonus >= N (e.g. Sleep vs high Will). */
  skipIfSaveBonusGte: z.number().int().optional(),
  /** On failed save (or always if no save), apply this condition name. */
  applyCondition: z.string().optional(),
  /** Optional blast radius in cells for offense tips / multi-target scoring. */
  blastRadius: z.number().int().nonnegative().optional(),
});
export type Spell = z.infer<typeof SpellSchema>;

export const CombatantFixtureSchema = z.object({
  id: z.string(),
  name: z.string(),
  side: z.enum(["party", "enemy"]),
  role: z.string(),
  tokenChar: z.string().length(1),
  /** Creature/PC level for spell-rank gating (default 1). */
  level: z.number().int().default(1),
  maxHp: z.number().int().positive(),
  ac: z.number().int(),
  speedCells: z.number().int().positive(),
  perceptionBonus: z.number().default(0),
  /** Used for spell saves when targeted (default 3). */
  saveBonus: z.number().default(3),
  start: PositionSchema,
  weapons: z.array(WeaponSchema).min(1),
  spells: z.array(SpellSchema).default([]),
  aiProfile: AiProfileSchema,
});
export type CombatantFixture = z.infer<typeof CombatantFixtureSchema>;

export const MapCellSchema = z.object({
  x: z.number().int().positive(),
  y: z.number().int().positive(),
  tags: z.array(z.enum(["floor", "difficult", "cover", "blocking"])).default(["floor"]),
});
export type MapCell = z.infer<typeof MapCellSchema>;

export const EncounterFixtureSchema = z.object({
  id: z.string(),
  name: z.string(),
  ruleset: z.literal("pf2e"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  cells: z.array(MapCellSchema),
  combatants: z.array(CombatantFixtureSchema),
});
export type EncounterFixture = z.infer<typeof EncounterFixtureSchema>;

export const WeightDeltaSchema = z.object({
  combatantId: z.string(),
  until: z.object({ round: z.number().int().positive() }).optional(),
  delta: z.record(z.string(), z.number()),
});
export type WeightDelta = z.infer<typeof WeightDeltaSchema>;

export function cellId(pos: Position): string {
  return `x${String(pos.x).padStart(2, "0")}y${String(pos.y).padStart(2, "0")}`;
}

export function parseCellId(id: string): Position {
  const m = /^x(\d+)y(\d+)$/i.exec(id);
  if (!m) throw new Error(`Invalid cell id: ${id}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}
