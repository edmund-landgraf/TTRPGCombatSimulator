import { z } from "zod";
import {
  AiProfileSchema,
  CombatantFixtureSchema,
  EncounterFixtureSchema,
  MapCellSchema,
  SpellSchema,
  TacticsGroupIdSchema,
  WeaponSchema,
  type CombatantFixture,
  type EncounterFixture,
  type MapCell,
  type TacticsGroupId,
} from "../memory/schemas.js";
import { defaultTacticsGroupForRole, listTacticsGroups } from "../ai/tacticsGroups.js";
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
  tacticsGroup: TacticsGroupIdSchema.optional(),
  tacticsSecondary: TacticsGroupIdSchema.optional(),
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
    Delay: 0.35,
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
 * Party on the south edge, enemies on the north edge (opposite ends of the square).
 * Tight blocks (4 PCs = 2×2 XX/XX): tough front toward midfield, frail in back.
 */
export function autoPlaceSides(
  pcs: CombatantFixture[],
  enemies: CombatantFixture[],
  map: StudioMap,
): { pcs: CombatantFixture[]; enemies: CombatantFixture[] } {
  const { min, maxX, maxY } = walkableBounds(map);
  const depth = maxY - min + 1;
  const twoRanks = depth >= 6;

  const partySorted = [...pcs].sort((a, b) => toughness(b) - toughness(a));
  const enemySorted = [...enemies].sort((a, b) => toughness(b) - toughness(a));

  // Keep a clear midfield: party hugs south wall, enemies hug north wall.
  const placedPcs = placeBlock(partySorted, {
    minX: min,
    maxX,
    minY: min,
    maxY,
    // Front rank one step north of the south wall; back rank on the wall
    frontY: twoRanks && partySorted.length > 1 ? maxY - 1 : maxY,
    backDir: 1,
  });

  const placedEnemies = placeBlock(enemySorted, {
    minX: min,
    maxX,
    minY: min,
    maxY,
    // Front rank one step south of the north wall; back rank on the wall
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
    const role = parsed.role ?? parsed.name.toLowerCase();
    const fixture = CombatantFixtureSchema.parse({
      ...parsed,
      side,
      role,
      tokenChar: token.slice(0, 1),
      level: parsed.level ?? 1,
      perceptionBonus: parsed.perceptionBonus ?? 2,
      saveBonus: parsed.saveBonus ?? 3,
      // Placeholder; autoPlaceSides overwrites after import into studio.
      start: parsed.start ?? { x: 2, y: side === "party" ? map.height - 1 : 2 },
      spells: parsed.spells ?? [],
      aiProfile: parsed.aiProfile ?? defaultAi(side),
      tacticsGroup: parsed.tacticsGroup ?? defaultTacticsGroupForRole(role),
      tacticsSecondary: parsed.tacticsSecondary,
    });
    out.push(fixture);
  }
  return out;
}

/** Assign primary / optional secondary tactics groups to a studio PC/enemy. */
export function setStudioTacticsGroup(
  state: StudioState,
  id: string,
  tacticsGroup: TacticsGroupId,
  tacticsSecondary?: TacticsGroupId | null,
): void {
  const unit =
    state.pcs.find((c) => c.id === id) ?? state.enemies.find((c) => c.id === id);
  if (!unit) throw new Error(`Unknown combatant ${id}`);
  unit.tacticsGroup = tacticsGroup;
  if (tacticsSecondary === null || tacticsSecondary === undefined) {
    delete unit.tacticsSecondary;
  } else if (tacticsSecondary === tacticsGroup) {
    delete unit.tacticsSecondary;
  } else {
    unit.tacticsSecondary = tacticsSecondary;
  }
  if (state.encounter) {
    const ec = state.encounter.combatants.find((c) => c.id === id);
    if (ec) {
      ec.tacticsGroup = unit.tacticsGroup;
      if (unit.tacticsSecondary) ec.tacticsSecondary = unit.tacticsSecondary;
      else delete ec.tacticsSecondary;
    }
  }
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

function isWalkableCell(state: StudioState, x: number, y: number): boolean {
  const cell = state.map.cells.find((c) => c.x === x && c.y === y);
  if (!cell) return false;
  return !cell.tags.includes("blocking");
}

/** Move a studio token before combat (Setup / deploy). Rejects walls & occupied cells. */
export function moveStudioToken(
  state: StudioState,
  id: string,
  x: number,
  y: number,
): void {
  const unit =
    state.pcs.find((c) => c.id === id) ?? state.enemies.find((c) => c.id === id);
  if (!unit) throw new Error(`Unknown combatant ${id}`);
  if (!isWalkableCell(state, x, y)) throw new Error(`Cell x${x}y${y} is not walkable`);
  const occupied = [...state.pcs, ...state.enemies].some(
    (c) => c.id !== id && c.start.x === x && c.start.y === y,
  );
  if (occupied) throw new Error(`Cell x${x}y${y} is occupied`);
  unit.start = { x, y };
  // Keep built encounter starts in sync if present.
  if (state.encounter) {
    const ec = state.encounter.combatants.find((c) => c.id === id);
    if (ec) ec.start = { x, y };
  }
}

/** Board snapshot for Setup preview / legend (same shape as combat board). */
export function studioBoard(state: StudioState): {
  width: number;
  height: number;
  cells: { x: number; y: number; tags: string[] }[];
  tokens: {
    id: string;
    name: string;
    side: "party" | "enemy";
    tokenChar: string;
    x: number;
    y: number;
    downed: boolean;
  }[];
} {
  const { width, height, cells } = state.map;
  const by = new Map(cells.map((c) => [`${c.x},${c.y}`, c]));
  const outCells: { x: number; y: number; tags: string[] }[] = [];
  for (let y = 1; y <= height; y++) {
    for (let x = 1; x <= width; x++) {
      const cell = by.get(`${x},${y}`);
      outCells.push({ x, y, tags: cell ? [...cell.tags] : ["blocking"] });
    }
  }
  const tokens = [...state.pcs, ...state.enemies].map((c) => ({
    id: c.id,
    name: c.name,
    side: c.side,
    tokenChar: c.tokenChar,
    x: c.start.x,
    y: c.start.y,
    downed: false,
  }));
  return { width, height, cells: outCells, tokens };
}

export function buildEncounterFromStudio(state: StudioState): EncounterFixture {
  if (state.pcs.length === 0) throw new Error("Import at least one PC JSON");
  if (state.enemies.length === 0) throw new Error("Import at least one enemy JSON");

  // Do not re-auto-place — preserves Setup / deploy token moves.
  const clamp = (c: CombatantFixture): CombatantFixture => {
    let { x, y } = c.start;
    x = Math.min(state.map.width, Math.max(1, x));
    y = Math.min(state.map.height, Math.max(1, y));
    if (!isWalkableCell(state, x, y)) {
      throw new Error(`${c.id} start x${x}y${y} is not walkable — move the token`);
    }
    return { ...c, start: { x, y } };
  };

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
  const unitRow = (c: CombatantFixture) => ({
    id: c.id,
    name: c.name,
    hp: c.maxHp,
    ac: c.ac,
    start: c.start,
    tokenChar: c.tokenChar,
    side: c.side,
    role: c.role,
    tacticsGroup: c.tacticsGroup ?? defaultTacticsGroupForRole(c.role),
    tacticsSecondary: c.tacticsSecondary ?? null,
  });
  return {
    pcs: state.pcs.map(unitRow),
    enemies: state.enemies.map(unitRow),
    tacticsGroups: listTacticsGroups(),
    map: {
      width: state.map.width,
      height: state.map.height,
      source: state.map.source,
      imageName: state.map.imageName,
      hasImage: !!state.map.imageDataUrl,
      cellCount: state.map.cells.length,
      borderWalls: state.map.borderWalls !== false,
    },
    board: studioBoard(state),
    asciiPreview: formatStudioAscii(state),
    encounterReady: state.pcs.length > 0 && state.enemies.length > 0,
    encounter: state.encounter
      ? { id: state.encounter.id, name: state.encounter.name, combatants: state.encounter.combatants.length }
      : null,
    lastError: state.lastError,
  };
}
