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
  "Delay",
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

/** Built-in NWN-style tactics group — exactly one per combatant. */
export const TacticsGroupIdSchema = z.enum([
  "frontliner",
  "archer",
  "flanker",
  "buff_debuff",
  "battlefield_control",
  "blaster",
  "healer",
]);
export type TacticsGroupId = z.infer<typeof TacticsGroupIdSchema>;

export const WeaponSchema = z.object({
  id: z.string(),
  kind: z.enum(["melee", "ranged"]),
  attackBonus: z.number(),
  damageDice: z.number().int().positive(),
  damageDie: z.number().int().positive(),
  damageBonus: z.number().default(0),
  rangeCells: z.number().int().positive().optional(),
  reach: z.number().int().positive().default(1),
  /** Agile trait → MAP −4 / −8 instead of −5 / −10. */
  agile: z.boolean().optional(),
  /** On a hit, expose the target to this affliction catalog id (injury poison, etc.). */
  afflictionId: z.string().optional(),
});
export type Weapon = z.infer<typeof WeaponSchema>;

/** One stage of a PF2e affliction (lossy combat stub). */
export const AfflictionStageSchema = z.object({
  /** Immediate damage when entering this stage. */
  damageDice: z.number().int().nonnegative().default(0),
  damageDie: z.number().int().positive().optional(),
  damageBonus: z.number().default(0),
  /** Condition names applied while at this stage (e.g. "clumsy", "off-guard"). */
  conditions: z.array(z.string()).default([]),
  /** Condition value when applicable (clumsy 1 → 1). */
  conditionValue: z.number().int().positive().optional(),
  /** Interval before the next save, in rounds (combat-scoped). */
  intervalRounds: z.number().int().positive().default(1),
});
export type AfflictionStage = z.infer<typeof AfflictionStageSchema>;

/**
 * Combat-ready affliction definition (poison / disease / curse).
 * Full PF2e onset/day-long diseases are out of scope; prefer 1-round poisons.
 */
export const AfflictionSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["poison", "disease", "curse", "other"]).default("poison"),
  level: z.number().int().nonnegative().optional(),
  saveDc: z.number().int().positive(),
  /** Virulent: need two consecutive successes to reduce stage by 1. */
  virulent: z.boolean().default(false),
  /** Max rounds the affliction can last; omit = until recovered. */
  maxDurationRounds: z.number().int().positive().optional(),
  stages: z.array(AfflictionStageSchema).min(1),
  aonId: z.number().int().optional(),
  aonUrl: z.string().optional(),
  summary: z.string().optional(),
});
export type Affliction = z.infer<typeof AfflictionSchema>;

/** Terrain tags on a map cell.
 * - wall_h / wall_v: oriented solid walls (block move + LOS); brush toggles H ↔ V
 * - barricade: soft cover marker "B" (walkable, shoot-over; PF2e standard cover)
 * - grease: spell-created slick (glyph G); counts as difficult for pathing
 * - fog: mist / Fog Cloud (glyph F); creatures in fog are concealed (DC 5 flat check)
 */
export const MapTerrainTagSchema = z.enum([
  "floor",
  "difficult",
  "cover",
  "blocking",
  "hazardous",
  "wall_h",
  "wall_v",
  "barricade",
  "grease",
  "fog",
]);
export type MapTerrainTag = z.infer<typeof MapTerrainTagSchema>;

/** Default ASCII/UI glyph for spell-created terrain. */
export function terrainGlyphFor(tag: string): string {
  if (tag === "grease") return "G";
  if (tag === "fog") return "F";
  if (tag === "barricade") return "B";
  if (tag === "hazardous") return "!";
  if (tag === "difficult") return "~";
  return "?";
}

/** Fog / mist terrain — grants concealed (not a −2 attack penalty). */
export function isFogTags(tags: readonly string[]): boolean {
  return tags.includes("fog");
}

/** Tags that cost +1 movement like difficult terrain. */
export function isDifficultTag(tag: string): boolean {
  return tag === "difficult" || tag === "grease";
}

export function tagsAreDifficult(tags: readonly string[]): boolean {
  return tags.some((t) => isDifficultTag(t));
}

export const MapCellSchema = z.object({
  x: z.number().int().positive(),
  y: z.number().int().positive(),
  tags: z.array(MapTerrainTagSchema).default(["floor"]),
});
export type MapCell = z.infer<typeof MapCellSchema>;

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
  /** On failed save, expose the target to this affliction catalog id. */
  applyAffliction: z.string().optional(),
  /**
   * Burst radius in cells (Chebyshev) for spherical AoE — e.g. Fireball radius 2.
   * Affects all valid creatures in range; used for multi-target scoring.
   */
  blastRadius: z.number().int().nonnegative().optional(),
  /**
   * Axis-aligned square AoE size in cells (2 = 10 ft × 10 ft / 2×2).
   * Grease uses this with leaveTerrain: "grease".
   */
  areaSquareCells: z.number().int().positive().optional(),
  /**
   * Terrain tag painted onto every walkable AoE cell when cast
   * (e.g. "grease" → map shows G and counts as difficult).
   */
  leaveTerrain: MapTerrainTagSchema.optional(),
  /** Optional map glyph override for leaveTerrain (default: grease→G). */
  terrainGlyph: z.string().min(1).max(1).optional(),
  /**
   * How many rounds painted terrain lasts (inclusive of cast round).
   * Default when leaveTerrain is set: 10 (≈1 minute). Omit / 0 = until combat end.
   */
  terrainDurationRounds: z.number().int().nonnegative().optional(),
});
export type Spell = z.infer<typeof SpellSchema>;

/** Default duration for spell-created terrain when unspecified (PF2e Grease ≈ 1 min). */
export const DEFAULT_TERRAIN_DURATION_ROUNDS = 10;

export const CombatantFixtureSchema = z.object({
  id: z.string(),
  name: z.string(),
  side: z.enum(["party", "enemy"]),
  role: z.string(),
  tokenChar: z.string().length(1),
  /** Creature/PC level for spell-rank gating (default 1). */
  level: z.number().int().default(1),
  /** Class / creature id for packet composition (derived from role if omitted). */
  classId: z.string().optional(),
  /** Dedication / monster-family archetype tags. */
  archetypes: z.array(z.string()).default([]),
  /** Combat capability tags (feats / class features) for overlays + deeper search. */
  capabilities: z.array(z.string()).default([]),
  maxHp: z.number().int().positive(),
  ac: z.number().int(),
  speedCells: z.number().int().positive(),
  perceptionBonus: z.number().default(0),
  /** Used for spell saves when targeted (default 3). */
  saveBonus: z.number().default(3),
  /** Shield Block hardness (0 = no shield). */
  shieldHardness: z.number().int().nonnegative().default(0),
  /** Shield HP / Hit Points for Shield Block. */
  shieldHp: z.number().int().nonnegative().default(0),
  start: PositionSchema,
  weapons: z.array(WeaponSchema).min(1),
  spells: z.array(SpellSchema).default([]),
  aiProfile: AiProfileSchema,
  /** Primary built-in tactics group (archer, frontliner, buff/debuff, …). */
  tacticsGroup: TacticsGroupIdSchema.optional(),
  /** Optional secondary group blended under the primary (e.g. frontliner + battlefield_control). */
  tacticsSecondary: TacticsGroupIdSchema.optional(),
});
export type CombatantFixture = z.infer<typeof CombatantFixtureSchema>;

/** Solid geometry: full walls and oriented wall segments. */
export function isBlockingTags(tags: readonly string[]): boolean {
  return (
    tags.includes("blocking") || tags.includes("wall_h") || tags.includes("wall_v")
  );
}

/** Soft/standard cover terrain you can occupy (cover rail or barricade). */
export function isCoverTags(tags: readonly string[]): boolean {
  return tags.includes("cover") || tags.includes("barricade");
}

/**
 * Combat-ready PF2e hazard stub (trap / haunt / environmental).
 * Full disable skills & complex hazard initiative are simplified.
 */
export const HazardSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.number().int().default(0),
  complexity: z.enum(["simple", "complex"]).default("simple"),
  hazardType: z.enum(["trap", "haunt", "environmental", "other"]).default("trap"),
  stealthDc: z.number().int().nonnegative().optional(),
  disableDc: z.number().int().nonnegative().optional(),
  disableSkill: z.string().optional(),
  /** When the hazard attempts its effect. */
  trigger: z
    .enum(["enter_square", "end_turn_in", "manual"])
    .default("enter_square"),
  /** Attack roll vs AC (e.g. Spear Launcher); omit for save-only / auto. */
  attackBonus: z.number().int().optional(),
  saveDc: z.number().int().optional(),
  halfOnSave: z.boolean().default(true),
  damageDice: z.number().int().nonnegative().default(0),
  damageDie: z.number().int().positive().optional(),
  damageBonus: z.number().default(0),
  applyCondition: z.string().optional(),
  applyAffliction: z.string().optional(),
  /** Simple traps: disarm after one trigger until reset. */
  once: z.boolean().default(true),
  /** Paint these terrain tags on the hazard's cells when placed. */
  paintTags: z.array(MapTerrainTagSchema).default([]),
  aonId: z.number().int().optional(),
  aonUrl: z.string().optional(),
  summary: z.string().optional(),
});
export type Hazard = z.infer<typeof HazardSchema>;

/**
 * Combat-ready archetype dedication stub.
 * Full feat trees are not modeled — only overlay / capability biases.
 */
export const ArchetypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["multiclass", "other"]).default("other"),
  dedicationLevel: z.number().int().default(2),
  /** Existing feat-archetype-overlays.json key, if any. */
  overlayId: z.string().optional(),
  grantCapabilities: z.array(z.string()).default([]),
  preferPacketIds: z.array(z.string()).default([]),
  scoreHints: z.record(z.number()).default({}),
  roleHint: z.string().optional(),
  aonId: z.number().int().optional(),
  aonUrl: z.string().optional(),
  summary: z.string().optional(),
});
export type Archetype = z.infer<typeof ArchetypeSchema>;

/** Place a catalog hazard onto one or more map cells. */
export const HazardPlacementSchema = z.object({
  hazardId: z.string(),
  cells: z.array(PositionSchema).min(1),
  /** Instance starts disabled (already found/disarmed). */
  disabled: z.boolean().default(false),
});
export type HazardPlacement = z.infer<typeof HazardPlacementSchema>;

export const EncounterFixtureSchema = z.object({
  id: z.string(),
  name: z.string(),
  ruleset: z.literal("pf2e"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  cells: z.array(MapCellSchema),
  combatants: z.array(CombatantFixtureSchema),
  /** Catalog hazards placed on the map (traps, pits, runes, …). */
  hazards: z.array(HazardPlacementSchema).default([]),
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
