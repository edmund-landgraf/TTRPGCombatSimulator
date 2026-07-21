import type { Candidate } from "../ai/scorer.js";
import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import { occupiedKeys } from "../memory/combatMemory.js";
import { cellId, type Position } from "../memory/schemas.js";
import {
  chebyshev,
  hasCoverFromAttack,
  hasLineOfSight,
} from "../map/grid.js";
import { findPath } from "../map/pathfind.js";
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
  reachableCells: string[];
  inRangeCells: string[];
  noLosCells: string[];
  coverFromActor: string[];
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

/** Best weapon/spell reach for map feedback (melee reach or ranged/spell range). */
export function bestAttackRangeCells(actor: CombatantState): number {
  let best = 1;
  for (const w of actor.weapons) {
    if (w.kind === "ranged") best = Math.max(best, w.rangeCells ?? 12);
    else best = Math.max(best, w.reach ?? 1);
  }
  for (const s of actor.spells) {
    best = Math.max(best, s.rangeCells ?? 0);
  }
  return best;
}

/** Walkable cells within attack range of the actor (Chebyshev). */
export function computeInRangeCells(
  mem: CombatMemory,
  actor: CombatantState,
): string[] {
  const range = bestAttackRangeCells(actor);
  const out: string[] = [];
  for (const key of mem.grid.walkable.keys()) {
    const m = /^x(\d+)y(\d+)$/i.exec(key);
    if (!m) continue;
    const to: Position = { x: Number(m[1]), y: Number(m[2]) };
    if (chebyshev(actor.pos, to) <= range && chebyshev(actor.pos, to) > 0) {
      out.push(key);
    }
  }
  return out;
}

/** Walkable cells with no LOS from actor; cells that grant cover vs attacks from actor. */
export function computeLosCover(
  mem: CombatMemory,
  actor: CombatantState,
): { noLosCells: string[]; coverFromActor: string[] } {
  const noLosCells: string[] = [];
  const coverFromActor: string[] = [];
  for (const key of mem.grid.walkable.keys()) {
    const m = /^x(\d+)y(\d+)$/i.exec(key);
    if (!m) continue;
    const to: Position = { x: Number(m[1]), y: Number(m[2]) };
    if (to.x === actor.pos.x && to.y === actor.pos.y) continue;
    if (!hasLineOfSight(mem.grid, actor.pos, to)) {
      noLosCells.push(key);
    } else if (hasCoverFromAttack(mem.grid, actor.pos, to)) {
      coverFromActor.push(key);
    }
  }
  return { noLosCells, coverFromActor };
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
  const { noLosCells, coverFromActor } = computeLosCover(mem, actor);
  return {
    awaitingPlayer: !!opts?.awaitingPlayer,
    choices: (opts?.choices ?? []).map(choiceToTheater),
    reachableCells: computeReachableCells(mem, actor),
    inRangeCells: computeInRangeCells(mem, actor),
    noLosCells,
    coverFromActor,
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
