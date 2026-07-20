import { z } from "zod";
import {
  AiProfileSchema,
  CombatantFixtureSchema,
  EncounterFixtureSchema,
  MapCellSchema,
  SpellSchema,
  WeaponSchema,
  type CombatantFixture,
  type EncounterFixture,
  type MapCell,
} from "../memory/schemas.js";
import { buildClassicFourCells } from "../map/buildClassicMap.js";
import { buildOpenSquareCells, clampMapSize } from "../map/buildOpenSquareMap.js";

const ImportCombatantSchema = z.object({
  id: z.string(),
  name: z.string(),
  side: z.enum(["party", "enemy"]).optional(),
  role: z.string().optional(),
  tokenChar: z.string().min(1).max(1).optional(),
  level: z.number().int().optional(),
  maxHp: z.number().int().positive(),
  ac: z.number().int(),
  speedCells: z.number().int().positive(),
  perceptionBonus: z.number().optional(),
  saveBonus: z.number().optional(),
  start: z.object({ x: z.number().int().positive(), y: z.number().int().positive() }).optional(),
  weapons: z.array(WeaponSchema).min(1),
  spells: z.array(SpellSchema).optional(),
  aiProfile: AiProfileSchema.optional(),
});

export type StudioMap = {
  width: number;
  height: number;
  cells: MapCell[];
  imageDataUrl?: string;
  imageName?: string;
  source: "classic" | "image" | "ascii" | "empty";
  borderWalls?: boolean;
};

export type StudioState = {
  pcs: CombatantFixture[];
  enemies: CombatantFixture[];
  map: StudioMap;
  encounter: EncounterFixture | null;
  lastError?: string;
};

const defaultAi = (side: "party" | "enemy"): z.infer<typeof AiProfileSchema> => ({
  weights: {
    Strike_melee: side === "party" ? 1.2 : 1.3,
    Strike_ranged: 0.8,
    Cast_cantrip: 1.0,
    Cast_spell: 0.8,
    Heal_ally: side === "party" ? 1.5 : 0.1,
    Stride_close: 1.0,
    Stride_cover: 0.5,
    Step_away: 0.4,
    End_turn: 0.1,
  },
  featureBias: { selfPreservation: 0.4 },
});

/** Higher = better front-liner (AC first, then HP). */
function toughness(c: { ac: number; maxHp: number }): number {
  return c.ac * 100 + c.maxHp;
}

function walkableBounds(map: StudioMap) {
  const border = map.borderWalls !== false && map.source !== "image"
    ? map.cells.some((c) => c.x === 1 && c.y === 1 && c.tags.includes("blocking"))
    : map.cells.some((c) => c.tags.includes("blocking") && (c.x === 1 || c.y === 1));
  const min = border ? 2 : 1;
  const maxX = border ? map.width - 1 : map.width;
  const maxY = border ? map.height - 1 : map.height;
  return { min, maxX, maxY };
}

/**
 * Classic party block: for 4 PCs → 2×2
 *   XX  ← front (tough / high AC)
 *   XX  ← back  (frail)
 * Rows are adjacent; columns are adjacent and centered on the map.
 */
function formationRanks(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [1];
  if (n === 2) return [2];
  if (n === 3) return [2, 1];
  if (n === 4) return [2, 2]; // normal 4-PC setup
  if (n === 5) return [3, 2];
  if (n === 6) return [3, 3];
  const cols = Math.min(3, n);
  const ranks: number[] = [];
  let left = n;
  while (left > 0) {
    const row = Math.min(cols, left);
    ranks.push(row);
    left -= row;
  }
  return ranks;
}

function placeBlock(
  units: CombatantFixture[],
  opts: {
    minX: number;
    maxX: number;
    /** Y of the front rank (toward the opposing side). */
    frontY: number;
    /** +1 = back ranks go south (higher y); -1 = back ranks go north (lower y). */
    backDir: 1 | -1;
    minY: number;
    maxY: number;
  },
): CombatantFixture[] {
  const ranks = formationRanks(units.length);
  const cols = Math.max(...ranks, 1);
  const width = opts.maxX - opts.minX + 1;
  const blockW = Math.min(cols, width);
  const originX = opts.minX + Math.floor((width - blockW) / 2);

  const placed: CombatantFixture[] = [];
  let idx = 0;
  for (let r = 0; r < ranks.length; r++) {
    const count = ranks[r]!;
    const y = opts.frontY + r * opts.backDir;
    if (y < opts.minY || y > opts.maxY) break;
    const rowOrigin = originX + Math.floor((blockW - count) / 2);
    for (let i = 0; i < count; i++) {
      const u = units[idx++];
      if (!u) break;
      placed.push({
        ...u,
        start: {
          x: Math.min(opts.maxX, Math.max(opts.minX, rowOrigin + i)),
          y,
        },
      });
    }
  }
  // Any leftovers (shouldn't happen) park next to the last cell
  while (idx < units.length) {
    const u = units[idx++]!;
    placed.push({
      ...u,
      start: { x: originX, y: opts.frontY },
    });
  }
  return placed;
}

/**
 * Party south, enemies north — tight blocks (4 PCs = 2×2 XX/XX).
 * Party: high AC/tough in front (toward foes), frail in back.
 */
export function autoPlaceSides(
  pcs: CombatantFixture[],
  enemies: CombatantFixture[],
  map: StudioMap,
): { pcs: CombatantFixture[]; enemies: CombatantFixture[] } {
  const { min, maxX, maxY } = walkableBounds(map);
  const depth = maxY - min + 1;
  const twoRanks = depth >= 5;

  const partySorted = [...pcs].sort((a, b) => toughness(b) - toughness(a));
  const enemySorted = [...enemies].sort((a, b) => toughness(b) - toughness(a));

  const placedPcs = placeBlock(partySorted, {
    minX: min,
    maxX,
    minY: min,
    maxY,
    // Front toward enemies (north): one row in from the south edge when 2 ranks fit
    frontY: twoRanks && partySorted.length > 1 ? maxY - 1 : maxY,
    backDir: 1,
  });

  const placedEnemies = placeBlock(enemySorted, {
    minX: min,
    maxX,
    minY: min,
    maxY,
    // Front toward party (south)
    frontY: twoRanks && enemySorted.length > 1 ? min + 1 : min,
    backDir: -1,
  });

  return { pcs: placedPcs, enemies: placedEnemies };
}

export function createStudioState(): StudioState {
  const width = 12;
  const height = 10;
  return {
    pcs: [],
    enemies: [],
    map: {
      width,
      height,
      cells: buildClassicFourCells(width, height),
      source: "classic",
      borderWalls: true,
    },
    encounter: null,
  };
}

export const studioState = createStudioState();

function normalizeImportPayload(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.combatants)) return o.combatants;
    if (Array.isArray(o.pcs)) return o.pcs;
    if (Array.isArray(o.enemies)) return o.enemies;
    if (o.id && o.name) return [raw];
  }
  throw new Error("Expected a combatant object, an array, or { combatants: [...] }");
}

export function importCombatantsJson(
  raw: unknown,
  side: "party" | "enemy",
  map: StudioMap,
): CombatantFixture[] {
  const list = normalizeImportPayload(raw);
  const out: CombatantFixture[] = [];

  for (let i = 0; i < list.length; i++) {
    const parsed = ImportCombatantSchema.parse(list[i]);
    const token =
      parsed.tokenChar ??
      (side === "party" ? (parsed.name[0] ?? "P").toUpperCase() : (parsed.name[0] ?? "E").toLowerCase());
    const fixture = CombatantFixtureSchema.parse({
      ...parsed,
      side,
      role: parsed.role ?? parsed.name.toLowerCase(),
      tokenChar: token.slice(0, 1),
      level: parsed.level ?? 1,
      perceptionBonus: parsed.perceptionBonus ?? 2,
      saveBonus: parsed.saveBonus ?? 3,
      // Placeholder; autoPlaceSides overwrites after import into studio.
      start: parsed.start ?? { x: 2, y: side === "party" ? map.height - 1 : 2 },
      spells: parsed.spells ?? [],
      aiProfile: parsed.aiProfile ?? defaultAi(side),
    });
    out.push(fixture);
  }
  return out;
}

/** Re-seat both sides using formation rules on the current map. */
export function applyAutoPlacement(state: StudioState): void {
  if (state.pcs.length === 0 && state.enemies.length === 0) return;
  const placed = autoPlaceSides(state.pcs, state.enemies, state.map);
  state.pcs = placed.pcs;
  state.enemies = placed.enemies;
}

/** Square open ASCII map; size sets both width and height. Re-places combatants. */
export function generateAsciiSquareMap(
  state: StudioState,
  size: number,
  borderWalls = true,
): StudioMap {
  const n = clampMapSize(size);
  const map: StudioMap = {
    width: n,
    height: n,
    cells: buildOpenSquareCells(n, borderWalls),
    source: "ascii",
    borderWalls,
  };
  state.map = map;
  applyAutoPlacement(state);
  state.encounter = null;
  return map;
}

/**
 * ASCII preview with tokens. Cells are spaced (`X X X`) so each square reads as ~5 ft.
 */
export function formatStudioAscii(state: StudioState): string {
  const { width, height, cells } = state.map;
  const by = new Map(cells.map((c) => [`${c.x},${c.y}`, c]));
  const tokens = new Map<string, string>();
  for (const c of [...state.pcs, ...state.enemies]) {
    tokens.set(`${c.start.x},${c.start.y}`, c.tokenChar);
  }
  const lines: string[] = [];
  for (let y = 1; y <= height; y++) {
    const row: string[] = [];
    for (let x = 1; x <= width; x++) {
      const tok = tokens.get(`${x},${y}`);
      if (tok) {
        row.push(tok);
        continue;
      }
      const cell = by.get(`${x},${y}`);
      const tags = cell?.tags ?? ["floor"];
      if (tags.includes("blocking")) row.push("#");
      else if (tags.includes("cover")) row.push("^");
      else if (tags.includes("difficult")) row.push("~");
      else row.push(".");
    }
    lines.push(row.join(" "));
  }
  return lines.join("\n");
}

export function setMapFromImageGrid(
  state: StudioState,
  input: {
    width: number;
    height: number;
    cells: unknown;
    imageDataUrl?: string;
    imageName?: string;
  },
): StudioMap {
  const width = clampMapSize(input.width);
  const height = clampMapSize(input.height);
  const cells = z.array(MapCellSchema).parse(input.cells);
  if (cells.length === 0) throw new Error("Map has no cells");
  const map: StudioMap = {
    width,
    height,
    cells,
    imageDataUrl: input.imageDataUrl,
    imageName: input.imageName,
    source: "image",
    borderWalls: true,
  };
  state.map = map;
  applyAutoPlacement(state);
  state.encounter = null;
  return map;
}

export function buildEncounterFromStudio(state: StudioState): EncounterFixture {
  if (state.pcs.length === 0) throw new Error("Import at least one PC JSON");
  if (state.enemies.length === 0) throw new Error("Import at least one enemy JSON");

  applyAutoPlacement(state);

  const clamp = (c: CombatantFixture): CombatantFixture => ({
    ...c,
    start: {
      x: Math.min(state.map.width - 1, Math.max(1, c.start.x)),
      y: Math.min(state.map.height - 1, Math.max(1, c.start.y)),
    },
  });

  const combatants = [...state.pcs.map(clamp), ...state.enemies.map(clamp)];
  const ids = new Set<string>();
  for (const c of combatants) {
    if (ids.has(c.id)) throw new Error(`Duplicate combatant id: ${c.id}`);
    ids.add(c.id);
  }

  return EncounterFixtureSchema.parse({
    id: "studio-custom",
    name: `Custom (${state.pcs.length} PCs vs ${state.enemies.length} enemies)`,
    ruleset: "pf2e",
    width: state.map.width,
    height: state.map.height,
    cells: state.map.cells,
    combatants,
  });
}

export function studioSummary(state: StudioState) {
  return {
    pcs: state.pcs.map((c) => ({ id: c.id, name: c.name, hp: c.maxHp, ac: c.ac, start: c.start })),
    enemies: state.enemies.map((c) => ({
      id: c.id,
      name: c.name,
      hp: c.maxHp,
      ac: c.ac,
      start: c.start,
    })),
    map: {
      width: state.map.width,
      height: state.map.height,
      source: state.map.source,
      imageName: state.map.imageName,
      hasImage: !!state.map.imageDataUrl,
      cellCount: state.map.cells.length,
      borderWalls: state.map.borderWalls !== false,
    },
    asciiPreview: formatStudioAscii(state),
    encounterReady: state.pcs.length > 0 && state.enemies.length > 0,
    encounter: state.encounter
      ? { id: state.encounter.id, name: state.encounter.name, combatants: state.encounter.combatants.length }
      : null,
    lastError: state.lastError,
  };
}
