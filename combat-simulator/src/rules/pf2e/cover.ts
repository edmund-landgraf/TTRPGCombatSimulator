import type { CombatMemory, CombatantState } from "../../memory/combatMemory.js";
import { living } from "../../memory/combatMemory.js";
import {
  attackLineIntermediateCells,
  hasCover,
  type Grid,
} from "../../map/grid.js";
import { cellId, isCoverTags, type Position, type SizeCategory } from "../../memory/schemas.js";

export type CoverLevel = "none" | "lesser" | "standard";

export type CoverFromAttack = {
  level: CoverLevel;
  acBonus: 0 | 1 | 2;
  /** Debug labels, e.g. creature:FTR:lesser */
  sources: string[];
};

const SIZE_RANK: Record<SizeCategory, number> = {
  tiny: 0,
  small: 1,
  medium: 2,
  large: 3,
  huge: 4,
  gargantuan: 5,
};

export function sizeRank(cat: SizeCategory): number {
  return SIZE_RANK[cat] ?? 2;
}

function creatureAt(
  mem: CombatMemory,
  pos: Position,
  exclude: Set<string>,
): CombatantState | undefined {
  for (const c of living(mem)) {
    if (exclude.has(c.id)) continue;
    if (c.pos.x === pos.x && c.pos.y === pos.y) return c;
  }
  return undefined;
}

function terrainCoverOnLine(grid: Grid, from: Position, to: Position): boolean {
  for (const p of attackLineIntermediateCells(from, to)) {
    const cell = grid.walkable.get(cellId(p));
    if (cell && isCoverTags(cell.tags)) return true;
  }
  return false;
}

/** True when an ally's space lies on the attack line (any cover from that ally). */
export function allyOnRangedAttackLine(
  mem: CombatMemory,
  attacker: CombatantState,
  target: CombatantState,
): CombatantState | undefined {
  const exclude = new Set([attacker.id, target.id]);
  for (const p of attackLineIntermediateCells(attacker.pos, target.pos)) {
    const inter = creatureAt(mem, p, exclude);
    if (inter && inter.side === attacker.side) return inter;
  }
  return undefined;
}

/**
 * PF2e cover for a ranged (or spell attack) line center → center.
 * Melee: only defender-on-terrain / line terrain (no creature-on-line).
 */
export function coverBonusFromAttack(
  mem: CombatMemory,
  attacker: CombatantState,
  target: CombatantState,
  opts?: { ranged?: boolean },
): CoverFromAttack {
  const ranged = opts?.ranged !== false;
  const sources: string[] = [];
  let acBonus: 0 | 1 | 2 = 0;

  if (hasCover(mem.grid, target.pos)) {
    sources.push("terrain:defender");
    acBonus = 2;
  }

  if (terrainCoverOnLine(mem.grid, attacker.pos, target.pos)) {
    if (!sources.includes("terrain:line")) sources.push("terrain:line");
    acBonus = 2;
  }

  if (ranged) {
    const exclude = new Set([attacker.id, target.id]);
    for (const p of attackLineIntermediateCells(attacker.pos, target.pos)) {
      const inter = creatureAt(mem, p, exclude);
      if (!inter) continue;
      const aRank = sizeRank(attacker.sizeCategory);
      const tRank = sizeRank(target.sizeCategory);
      const iRank = sizeRank(inter.sizeCategory);
      const standardFromSize = iRank - aRank >= 2 && iRank - tRank >= 2;
      if (standardFromSize) {
        sources.push(`creature:${inter.id}:standard`);
        acBonus = 2;
      } else {
        sources.push(`creature:${inter.id}:lesser`);
        if (acBonus < 2) acBonus = 1;
      }
    }
  }

  const level: CoverLevel =
    acBonus >= 2 ? "standard" : acBonus === 1 ? "lesser" : "none";
  return { level, acBonus, sources };
}

/** Score multiplier for candidate ranking from cover AC bonus. */
export function coverScoreMultiplier(acBonus: 0 | 1 | 2): number {
  if (acBonus >= 2) return 0.85;
  if (acBonus === 1) return 0.92;
  return 1;
}
