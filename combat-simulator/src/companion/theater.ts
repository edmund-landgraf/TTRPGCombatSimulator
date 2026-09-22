import type { Candidate } from "../ai/scorer.js";
import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import { living, occupiedKeys } from "../memory/combatMemory.js";
import { cellId, type Position } from "../memory/schemas.js";
import {
  chebyshev,
  hasCoverFromAttack,
  hasLineOfSight,
} from "../map/grid.js";
import { coverBonusFromAttack } from "../rules/pf2e/cover.js";
import { findPath } from "../map/pathfind.js";
import {
  actorThreatenedCells,
  threatenedByEnemies,
} from "../rules/pf2e/threaten.js";
import type { PlayerChoice } from "../play/choices.js";

export type TheaterChoice = {
  key: string;
  label: string;
  tip: string;
  tactic: string;
  head: string;
  targetId?: string;
  toCell?: string;
};

export type TheaterSnapshot = {
  awaitingPlayer: boolean;
  choices: TheaterChoice[];
  /** Active actor grid cell (matches combat memory, for UI cross-check). */
  actorCell: string;
  reachableCells: string[];
  /** Chebyshev cells within melee weapon reach (usually 1). */
  meleeReachCells: string[];
  /** Chebyshev cells within ranged weapon range (may include blocked LOS). */
  rangedRangeCells: string[];
  /** Cells this actor threatens (area of control; reach 2 for glaive/halberd). */
  threatenedCells: string[];
  /** Cells threatened by enemies with Reactive Strike (Stride may trigger). */
  threatenedByCells: string[];
  /** @deprecated Use meleeReachCells + rangedRangeCells — kept for older clients. */
  inRangeCells: string[];
  noLosCells: string[];
  /** Target cells with standard cover (+2) vs this actor's ranged attacks. */
  coverFromActor: string[];
  /** Target cells with lesser cover (+1) from creatures on the attack line. */
  lesserCoverFromActor: string[];
};

/** Cells the actor can reach with one Stride (speed budget), excluding occupied. */
export function computeReachableCells(
  mem: CombatMemory,
  actor: CombatantState,
): string[] {
  const blocked = occupiedKeys(mem, actor.id);
  const budget = Math.max(1, actor.speedCells || 6);
  const out: string[] = [];
  for (const key of mem.grid.walkable.keys()) {
    if (blocked.has(key)) continue;
    const m = /^x(\d+)y(\d+)$/i.exec(key);
    if (!m) continue;
    const to: Position = { x: Number(m[1]), y: Number(m[2]) };
    if (to.x === actor.pos.x && to.y === actor.pos.y) continue;
    const path = findPath(mem.grid, actor.pos, to, budget, blocked);
    if (path.ok) out.push(key);
  }
  return out;
}

function maxMeleeReach(actor: CombatantState): number {
  const held = actor.weapons.find((w) => w.id === actor.heldWeaponId);
  if (held?.kind === "melee") return held.reach ?? 1;
  return 0;
}

function maxRangedRange(actor: CombatantState): number {
  const held = actor.weapons.find((w) => w.id === actor.heldWeaponId);
  let best = 0;
  if (held?.kind === "ranged") best = held.rangeCells ?? 12;
  for (const s of actor.spells) {
    best = Math.max(best, s.rangeCells ?? 0);
  }
  return best;
}

function cellsWithinChebyshev(
  mem: CombatMemory,
  actor: CombatantState,
  range: number,
): string[] {
  if (range <= 0) return [];
  const out: string[] = [];
  for (const key of mem.grid.walkable.keys()) {
    const m = /^x(\d+)y(\d+)$/i.exec(key);
    if (!m) continue;
    const to: Position = { x: Number(m[1]), y: Number(m[2]) };
    const dist = chebyshev(actor.pos, to);
    if (dist > 0 && dist <= range) out.push(key);
  }
  return out;
}

/** Walkable cells within melee reach of the actor. */
export function computeMeleeReachCells(
  mem: CombatMemory,
  actor: CombatantState,
): string[] {
  return cellsWithinChebyshev(mem, actor, maxMeleeReach(actor));
}

/** Walkable cells within ranged / spell range (Chebyshev; LOS shown separately). */
export function computeRangedRangeCells(
  mem: CombatMemory,
  actor: CombatantState,
): string[] {
  return cellsWithinChebyshev(mem, actor, maxRangedRange(actor));
}

/** Walkable cells with no LOS from actor; cover overlays for ranged targets. */
export function computeLosCover(
  mem: CombatMemory,
  actor: CombatantState,
): { noLosCells: string[]; coverFromActor: string[]; lesserCoverFromActor: string[] } {
  const noLosCells: string[] = [];
  const coverFromActor: string[] = [];
  const lesserCoverFromActor: string[] = [];
  const side = actor.side === "party" ? "enemy" : "party";
  for (const foe of living(mem, side)) {
    if (!hasLineOfSight(mem.grid, actor.pos, foe.pos)) {
      noLosCells.push(cellId(foe.pos));
      continue;
    }
    const bonus = coverBonusFromAttack(mem, actor, foe, { ranged: true }).acBonus;
    const key = cellId(foe.pos);
    if (bonus >= 2) coverFromActor.push(key);
    else if (bonus === 1) lesserCoverFromActor.push(key);
  }
  for (const key of mem.grid.walkable.keys()) {
    const m = /^x(\d+)y(\d+)$/i.exec(key);
    if (!m) continue;
    const to: Position = { x: Number(m[1]), y: Number(m[2]) };
    if (to.x === actor.pos.x && to.y === actor.pos.y) continue;
    if (!hasLineOfSight(mem.grid, actor.pos, to)) {
      if (!noLosCells.includes(key)) noLosCells.push(key);
    } else if (hasCoverFromAttack(mem.grid, actor.pos, to)) {
      if (!coverFromActor.includes(key)) coverFromActor.push(key);
    }
  }
  return { noLosCells, coverFromActor, lesserCoverFromActor };
}

export function choiceToTheater(c: PlayerChoice): TheaterChoice {
  const cand = c.candidate;
  const base: TheaterChoice = {
    key: c.key,
    label: c.label,
    tip: c.tip,
    tactic: c.tactic,
    head: cand.head,
  };
  if (
    cand.head === "Strike_melee" ||
    cand.head === "Strike_ranged" ||
    cand.head === "Cast_cantrip" ||
    cand.head === "Cast_spell" ||
    cand.head === "Heal_ally"
  ) {
    base.targetId = cand.targetId;
  }
  if (
    cand.head === "Stride_close" ||
    cand.head === "Stride_cover" ||
    cand.head === "Step_away"
  ) {
    base.toCell = cellId(cand.to);
  }
  return base;
}

export function buildTheaterSnapshot(
  mem: CombatMemory,
  actor: CombatantState,
  opts?: {
    awaitingPlayer?: boolean;
    choices?: PlayerChoice[];
  },
): TheaterSnapshot {
  const { noLosCells, coverFromActor, lesserCoverFromActor } = computeLosCover(mem, actor);
  const meleeReachCells = computeMeleeReachCells(mem, actor);
  const rangedRangeCells = computeRangedRangeCells(mem, actor);
  const threatenedCells = actorThreatenedCells(mem, actor);
  const threatenedByCells = threatenedByEnemies(mem, actor);
  const inRangeCells = [...new Set([...meleeReachCells, ...rangedRangeCells])];
  return {
    awaitingPlayer: !!opts?.awaitingPlayer,
    choices: (opts?.choices ?? []).map(choiceToTheater),
    actorCell: cellId(actor.pos),
    reachableCells: computeReachableCells(mem, actor),
    meleeReachCells,
    rangedRangeCells,
    threatenedCells,
    threatenedByCells,
    inRangeCells,
    noLosCells,
    coverFromActor,
    lesserCoverFromActor,
  };
}

/** Highlight cells for a wire choice (destination or target token cell). */
export function highlightCellsForChoice(
  mem: CombatMemory,
  choice: TheaterChoice,
): string[] {
  if (choice.toCell) return [choice.toCell];
  if (choice.targetId) {
    const t = mem.combatants.get(choice.targetId);
    if (t) return [cellId(t.pos)];
  }
  return [];
}
