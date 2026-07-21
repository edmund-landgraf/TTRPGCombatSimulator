/**
 * Area-of-effect cell selection and terrain painting for spells (Grease, Fireball, …).
 */
import type {
  ActiveTerrainEffect,
  CombatantState,
  CombatMemory,
} from "../memory/combatMemory.js";
import { living } from "../memory/combatMemory.js";
import type { MapTerrainTag, Position, Spell } from "../memory/schemas.js";
import {
  cellId,
  DEFAULT_TERRAIN_DURATION_ROUNDS,
  terrainGlyphFor,
} from "../memory/schemas.js";
import type { Grid } from "./grid.js";
import { chebyshev, isWalkable } from "./grid.js";

let terrainEffectSeq = 0;

export function nextTerrainEffectId(): string {
  terrainEffectSeq += 1;
  return `terr_${terrainEffectSeq}`;
}

/** Resolve duration in rounds (0 = permanent). */
export function resolveTerrainDurationRounds(spell: Spell): number {
  if (!spell.leaveTerrain) return 0;
  if (spell.terrainDurationRounds != null) return spell.terrainDurationRounds;
  return DEFAULT_TERRAIN_DURATION_ROUNDS;
}

export function remainingTerrainRounds(
  effect: ActiveTerrainEffect,
  currentRound: number,
): number | null {
  if (effect.durationRounds <= 0 || effect.expiresAtEndOfRound <= 0) return null;
  return Math.max(0, effect.expiresAtEndOfRound - currentRound + 1);
}

/** Collect walkable cells of an axis-aligned square with NW corner at (ox, oy). */
export function squareCellsFromOrigin(
  grid: Grid,
  origin: Position,
  sizeCells: number,
): Position[] {
  const out: Position[] = [];
  for (let dy = 0; dy < sizeCells; dy++) {
    for (let dx = 0; dx < sizeCells; dx++) {
      const p = { x: origin.x + dx, y: origin.y + dy };
      if (isWalkable(grid, p)) out.push(p);
    }
  }
  return out;
}

/**
 * Place a size×size square that includes `anchor`.
 * Prefers the placement covering the most walkable cells, then most living creatures.
 */
export function placeSquareAoe(
  mem: CombatMemory,
  anchor: Position,
  sizeCells: number,
): Position[] {
  if (sizeCells <= 1) {
    return isWalkable(mem.grid, anchor) ? [anchor] : [];
  }
  const candidates: { cells: Position[]; score: number }[] = [];
  for (let ox = anchor.x - sizeCells + 1; ox <= anchor.x; ox++) {
    for (let oy = anchor.y - sizeCells + 1; oy <= anchor.y; oy++) {
      const origin = { x: ox, y: oy };
      const cells = squareCellsFromOrigin(mem.grid, origin, sizeCells);
      if (!cells.some((c) => c.x === anchor.x && c.y === anchor.y)) continue;
      if (cells.length === 0) continue;
      const creatures = countCreaturesInCells(mem, cells);
      // Prefer full squares, then denser creature packing (control value).
      const score = cells.length * 10 + creatures;
      candidates.push({ cells, score });
    }
  }
  if (candidates.length === 0) {
    return isWalkable(mem.grid, anchor) ? [anchor] : [];
  }
  candidates.sort((a, b) => b.score - a.score || b.cells.length - a.cells.length);
  return candidates[0]!.cells;
}

/** Chebyshev burst (includes center). */
export function placeBurstAoe(
  grid: Grid,
  center: Position,
  radiusCells: number,
): Position[] {
  const out: Position[] = [];
  for (const cell of grid.walkable.values()) {
    const p = { x: cell.x, y: cell.y };
    if (chebyshev(center, p) <= radiusCells) out.push(p);
  }
  return out;
}

export function aoeCellsForSpell(
  mem: CombatMemory,
  spell: Spell,
  anchor: Position,
): Position[] {
  if (spell.areaSquareCells != null && spell.areaSquareCells > 0) {
    return placeSquareAoe(mem, anchor, spell.areaSquareCells);
  }
  if (spell.blastRadius != null && spell.blastRadius >= 0) {
    return placeBurstAoe(mem.grid, anchor, spell.blastRadius);
  }
  return isWalkable(mem.grid, anchor) ? [anchor] : [];
}

export function spellHasAoe(spell: Spell): boolean {
  return (
    (spell.areaSquareCells != null && spell.areaSquareCells > 0) ||
    (spell.blastRadius != null && spell.blastRadius > 0)
  );
}

function countCreaturesInCells(mem: CombatMemory, cells: Position[]): number {
  const keys = new Set(cells.map(cellId));
  let n = 0;
  for (const c of mem.combatants.values()) {
    if (c.downed || c.hp <= 0) continue;
    if (keys.has(cellId(c.pos))) n++;
  }
  return n;
}

/** Living combatants whose position is inside the AoE cells. */
export function combatantsInAoe(
  mem: CombatMemory,
  cells: Position[],
  opts?: { side?: "party" | "enemy"; excludeId?: string },
): CombatantState[] {
  const keys = new Set(cells.map(cellId));
  const pool = opts?.side ? living(mem, opts.side) : [...mem.combatants.values()].filter(
    (c) => !c.downed && c.hp > 0,
  );
  return pool.filter((c) => {
    if (opts?.excludeId && c.id === opts.excludeId) return false;
    return keys.has(cellId(c.pos));
  });
}

/** Paint a terrain tag onto walkable cells (idempotent). Returns cells newly tagged. */
export function paintTerrain(
  grid: Grid,
  cells: Position[],
  tag: MapTerrainTag,
): Position[] {
  const painted: Position[] = [];
  for (const p of cells) {
    const key = cellId(p);
    const cell = grid.walkable.get(key);
    if (!cell) continue;
    if (cell.tags.includes(tag)) {
      // Still count as covered by this effect even if tag already present.
      painted.push(p);
      continue;
    }
    // Drop bare "floor" when adding a real surface tag.
    const next: MapTerrainTag[] = cell.tags.filter((t) => t !== "floor");
    next.push(tag);
    cell.tags = next;
    painted.push(p);
  }
  return painted;
}

/** Remove tag from cells that no other active effect still claims. */
export function clearTerrainTag(
  mem: CombatMemory,
  tag: string,
  cells: string[],
  exceptEffectId?: string,
): string[] {
  const stillClaimed = new Set<string>();
  for (const e of mem.activeTerrain) {
    if (exceptEffectId && e.id === exceptEffectId) continue;
    if (e.tag !== tag) continue;
    for (const c of e.cells) stillClaimed.add(c);
  }
  const cleared: string[] = [];
  for (const key of cells) {
    if (stillClaimed.has(key)) continue;
    const cell = mem.grid.walkable.get(key);
    if (!cell || !cell.tags.includes(tag as MapTerrainTag)) continue;
    cell.tags = cell.tags.filter((t) => t !== tag);
    if (cell.tags.length === 0) cell.tags = ["floor"];
    cleared.push(key);
  }
  return cleared;
}

/**
 * Register a timed terrain patch on the memory + grid.
 * Returns the effect (and which cells were painted).
 */
export function applyTimedTerrain(
  mem: CombatMemory,
  opts: {
    spell: Spell;
    casterId: string;
    cells: Position[];
    round: number;
  },
): ActiveTerrainEffect | null {
  const tag = opts.spell.leaveTerrain;
  if (!tag || opts.cells.length === 0) return null;
  const painted = paintTerrain(mem.grid, opts.cells, tag);
  if (painted.length === 0) return null;
  const durationRounds = resolveTerrainDurationRounds(opts.spell);
  const expiresAtEndOfRound =
    durationRounds > 0 ? opts.round + durationRounds - 1 : 0;
  const effect: ActiveTerrainEffect = {
    id: nextTerrainEffectId(),
    spellId: opts.spell.id,
    spellName: opts.spell.name,
    tag,
    glyph: opts.spell.terrainGlyph ?? terrainGlyphFor(tag),
    cells: painted.map(cellId),
    createdRound: opts.round,
    durationRounds,
    expiresAtEndOfRound,
    casterId: opts.casterId,
  };
  mem.activeTerrain.push(effect);
  return effect;
}

/**
 * At round end: expire terrain whose last active round is this round (or earlier).
 * Returns expire log lines.
 */
export function tickTerrainDurations(mem: CombatMemory): string[] {
  const lines: string[] = [];
  const keep: ActiveTerrainEffect[] = [];
  for (const effect of mem.activeTerrain) {
    const permanent = effect.durationRounds <= 0 || effect.expiresAtEndOfRound <= 0;
    if (permanent || mem.round < effect.expiresAtEndOfRound) {
      keep.push(effect);
      continue;
    }
    // Expire at end of expiresAtEndOfRound.
    const cleared = clearTerrainTag(mem, effect.tag, effect.cells, effect.id);
    mem.events.push({
      t: "terrain_expire",
      round: mem.round,
      spell: effect.spellId,
      spellName: effect.spellName,
      tag: effect.tag,
      glyph: effect.glyph,
      cells: effect.cells,
      effectId: effect.id,
    });
    lines.push(
      `  EXPIRE ${effect.spellName} ${effect.glyph} (${effect.tag}) after ${effect.durationRounds} round(s): ${effect.cells.join(" ")}` +
        (cleared.length < effect.cells.length ? " (some cells still claimed)" : ""),
    );
    lines.push(`  Narrative note: ${narrativeTerrainDissipates(effect)}`);
  }
  mem.activeTerrain = keep;
  return lines;
}

/** Friendly GM-handout line when lasting terrain ends. */
export function narrativeTerrainDissipates(effect: {
  spellName: string;
  tag: string;
  glyph: string;
}): string {
  const name = effect.spellName;
  if (effect.tag === "grease" || /grease/i.test(name)) {
    return `${name} dissipates at the final round of the spell — the slick of ${effect.glyph} fades from the battlefield.`;
  }
  if (effect.tag === "fog" || /fog/i.test(name)) {
    return `${name} dissipates — the ${effect.glyph} mist thins and sight returns.`;
  }
  return `${name} (${effect.glyph}) dissipates at the final round of the spell and leaves the map.`;
}

/** Friendly note that terrain will end at the close of this round. */
export function narrativeTerrainFinalRound(effect: {
  spellName: string;
  tag: string;
  glyph: string;
  expiresAtEndOfRound: number;
}): string {
  const name = effect.spellName;
  if (effect.tag === "grease" || /grease/i.test(name)) {
    return `${name} will dissipate at the end of this round (r${effect.expiresAtEndOfRound}) as the spell ends.`;
  }
  if (effect.tag === "fog" || /fog/i.test(name)) {
    return `${name} will clear at the end of this round (r${effect.expiresAtEndOfRound}) as the mist fades.`;
  }
  return `${name} (${effect.glyph}) will dissipate at the end of this round (r${effect.expiresAtEndOfRound}) as the spell ends.`;
}

/** When terrain is first painted. */
export function narrativeTerrainCreated(effect: ActiveTerrainEffect): string {
  if (effect.durationRounds <= 0) {
    return `${effect.spellName} marks the map with ${effect.glyph} until combat ends.`;
  }
  if (effect.tag === "grease" || /grease/i.test(effect.spellName)) {
    return `${effect.spellName} coats the area in ${effect.glyph}; it will dissipate at the end of round ${effect.expiresAtEndOfRound}.`;
  }
  if (effect.tag === "fog" || /fog/i.test(effect.spellName)) {
    return `${effect.spellName} fills the area with ${effect.glyph} (concealed); clears at end of round ${effect.expiresAtEndOfRound}.`;
  }
  return `${effect.spellName} (${effect.glyph}) lasts through round ${effect.expiresAtEndOfRound}, then dissipates.`;
}

export function formatActiveTerrainStatus(mem: CombatMemory): string[] {
  if (!mem.activeTerrain.length) return [];
  const lines = ["Terrain effects:"];
  for (const e of mem.activeTerrain) {
    const rem = remainingTerrainRounds(e, mem.round);
    const dur =
      rem == null
        ? "until combat end"
        : rem <= 1
          ? "expires end of this round"
          : `${rem} round(s) left (through r${e.expiresAtEndOfRound})`;
    lines.push(
      `  ${e.glyph} ${e.spellName} (${e.tag}) @ ${e.cells.join(", ")} — ${dur}`,
    );
    if (rem != null && rem <= 1) {
      lines.push(`  Narrative note: ${narrativeTerrainFinalRound(e)}`);
    }
  }
  return lines;
}

/** Narrative notes for the round summary / LLM narrator (create, final round, expire). */
export function formatTerrainNarrativeNotes(mem: CombatMemory): string[] {
  const notes: string[] = [];
  const roundEvents = mem.events.filter(
    (e) => "round" in e && e.round === mem.round,
  );
  for (const e of roundEvents) {
    if (e.t === "terrain") {
      notes.push(
        narrativeTerrainCreated({
          id: e.effectId,
          spellId: e.spell,
          spellName: e.spellName,
          tag: e.tag,
          glyph: e.glyph,
          cells: e.cells,
          createdRound: e.round,
          durationRounds: e.durationRounds,
          expiresAtEndOfRound: e.expiresAtEndOfRound,
          casterId: e.actor,
        }),
      );
    }
    if (e.t === "terrain_expire") {
      notes.push(narrativeTerrainDissipates(e));
    }
  }
  for (const e of mem.activeTerrain) {
    const rem = remainingTerrainRounds(e, mem.round);
    if (rem != null && rem <= 1) {
      // Avoid duplicating if we also expired this same round (already cleared).
      notes.push(narrativeTerrainFinalRound(e));
    }
  }
  if (!notes.length) return [];
  return ["Narrative notes:", ...notes.map((n) => `- ${n}`)];
}

export function formatCellsCompact(cells: Position[]): string {
  return cells.map(cellId).join(",");
}
