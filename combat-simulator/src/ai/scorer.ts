import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import { living } from "../memory/combatMemory.js";
import type { ActionHead, Position, Spell, Weapon } from "../memory/schemas.js";
import { cellId } from "../memory/schemas.js";
import { chebyshev, hasCover } from "../map/grid.js";
import { findApproachWithinBudget, findPath } from "../map/pathfind.js";
import { occupiedKeys } from "../memory/combatMemory.js";
import { estimatePHit } from "../rules/pf2e/strike.js";
import { canCastSpell, estimateSpellScore } from "../rules/pf2e/spell.js";
import { endsInMelee, flankApproachPos, isFlanking } from "./flank.js";
import { groupFlags, tacticsGroupOf } from "./tacticsGroups.js";

export type Candidate =
  | { head: "End_turn"; score: number }
  | { head: "Strike_melee" | "Strike_ranged"; score: number; targetId: string; weapon: Weapon }
  | {
      head: "Cast_cantrip" | "Cast_spell" | "Heal_ally";
      score: number;
      targetId: string;
      spell: Spell;
    }
  | { head: "Stride_close" | "Stride_cover" | "Step_away"; score: number; to: Position };

function activeDeltas(mem: CombatMemory, combatantId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of mem.weightDeltas) {
    if (d.combatantId !== combatantId) continue;
    if (d.until && mem.round > d.until.round) continue;
    for (const [k, v] of Object.entries(d.delta)) {
      out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

function nearestEnemy(mem: CombatMemory, actor: CombatantState): CombatantState | undefined {
  const foes = living(mem, actor.side === "party" ? "enemy" : "party");
  let best: CombatantState | undefined;
  let bestD = Infinity;
  for (const f of foes) {
    const d = chebyshev(actor.pos, f.pos);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

function pickWeapon(actor: CombatantState, kind: "melee" | "ranged"): Weapon | undefined {
  return actor.weapons.find((w) => w.kind === kind);
}

/** Toward a foe: furthest cell within one Speed along a (possibly longer) path. */
function towardPos(mem: CombatMemory, actor: CombatantState, foe: CombatantState): Position | null {
  const blocked = occupiedKeys(mem, actor.id);
  const approach = findApproachWithinBudget(
    mem.grid,
    actor.pos,
    foe.pos,
    actor.speedCells,
    blocked,
  );
  if (!approach.ok) return null;
  const dest = approach.path[approach.path.length - 1]!;
  if (cellId(dest) === cellId(actor.pos)) return null;
  return dest;
}

function awayPos(mem: CombatMemory, actor: CombatantState, foe: CombatantState): Position | null {
  const blocked = occupiedKeys(mem, actor.id);
  let best: Position | null = null;
  let bestScore = -Infinity;
  for (const cell of mem.grid.walkable.values()) {
    const p = { x: cell.x, y: cell.y };
    if (blocked.has(cellId(p))) continue;
    const path = findPath(mem.grid, actor.pos, p, 1, blocked);
    if (!path.ok || path.cost > 1) continue;
    const dist = chebyshev(p, foe.pos);
    if (dist > bestScore) {
      bestScore = dist;
      best = p;
    }
  }
  return best;
}

function coverPos(
  mem: CombatMemory,
  actor: CombatantState,
  toward?: CombatantState,
): Position | null {
  const blocked = occupiedKeys(mem, actor.id);
  let best: Position | null = null;
  let bestScore = -Infinity;
  for (const cell of mem.grid.walkable.values()) {
    if (!cell.tags.includes("cover")) continue;
    const p = { x: cell.x, y: cell.y };
    if (cellId(p) === cellId(actor.pos)) continue;
    if (blocked.has(cellId(p))) continue;
    const path = findPath(mem.grid, actor.pos, p, actor.speedCells, blocked);
    if (!path.ok || path.cost <= 0) continue;
    let score = 10 - path.cost;
    if (toward) {
      const closer = chebyshev(actor.pos, toward.pos) - chebyshev(p, toward.pos);
      score += closer * 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

export function rankCandidates(
  mem: CombatMemory,
  actor: CombatantState,
  visited: Set<string> = new Set(),
): Candidate[] {
  const deltas = activeDeltas(mem, actor.id);
  const group = tacticsGroupOf(actor);
  const flags = group.flags;
  const w = actor.aiProfile.weights;
  const weight = (head: ActionHead) =>
    ((w[head] ?? 0) + (deltas[head] ?? 0)) * (group.weightMult[head] ?? 1);

  const preferCover =
    (actor.aiProfile.featureBias?.preferCover ?? 0) + (group.featureBias.preferCover ?? 0);
  const preserve =
    (actor.aiProfile.featureBias?.selfPreservation ?? 0) +
    (group.featureBias.selfPreservation ?? 0);
  const focusCaster =
    (actor.aiProfile.featureBias?.focusCaster ?? 0) + (group.featureBias.focusCaster ?? 0);

  const candidates: Candidate[] = [{ head: "End_turn", score: flags.aggressive ? 0.02 : 0.08 }];

  const foes = living(mem, actor.side === "party" ? "enemy" : "party");
  const allies = [...mem.combatants.values()].filter((c) => c.side === actor.side);
  const nearest = nearestEnemy(mem, actor);
  const meleeWeapon = pickWeapon(actor, "melee");
  const inMelee =
    !!meleeWeapon &&
    foes.some((f) => chebyshev(actor.pos, f.pos) <= (meleeWeapon.reach ?? 1));
  const keepRange = flags.keepDistance || flags.preferRanged;

  // Spells first so casters prefer them over weapon Strikes
  for (const spell of actor.spells) {
    if (spell.kind === "heal") {
      for (const ally of allies) {
        if (!canCastSpell(mem, actor, ally, spell)) continue;
        const missing = ally.maxHp - ally.hp;
        if (missing < 4) continue;
        let score = weight("Heal_ally") * Math.min(2, missing / 8) + estimateSpellScore(mem, actor, ally, spell);
        if (ally.hp / ally.maxHp < 0.4) score += flags.healAllies ? 3.2 : 2;
        if (ally.id === actor.id) score -= 0.3;
        candidates.push({ head: "Heal_ally", score, targetId: ally.id, spell });
      }
      continue;
    }
    const head: ActionHead = spell.rank === 0 ? "Cast_cantrip" : "Cast_spell";
    for (const foe of foes) {
      if (!canCastSpell(mem, actor, foe, spell)) continue;
      let score = weight(head) * estimateSpellScore(mem, actor, foe, spell) * 2 + 0.4;
      if (hasCover(mem.grid, foe.pos)) score *= 0.85;
      if (foe.role.toLowerCase().includes("wizard") || foe.role.toLowerCase().includes("shaman")) {
        score += focusCaster;
      }
      if (spell.rank === 0) score += 0.3;
      const tag = spell.tactic;
      if (flags.preferControl && (tag === "control" || tag === "crowd_control")) score += 1.4;
      if (flags.preferBlast && (tag === "offense" || spell.kind === "attack")) score += 0.7;
      if (flags.openWithBuffs && (tag === "support" || tag === "heal")) score += 1.1;
      if (flags.preferControl && tag === "offense") score *= 0.75;
      candidates.push({ head, score, targetId: foe.id, spell });
    }
  }

  for (const foe of foes) {
    const melee = pickWeapon(actor, "melee");
    if (melee) {
      const pHit = estimatePHit(mem, actor, foe, melee);
      if (pHit > 0) {
        let score = weight("Strike_melee") * pHit * 2 + 0.5;
        if (inMelee) score += flags.preferMelee ? 2.8 : 2.0;
        if (isFlanking(mem, actor, foe, melee.reach ?? 1)) {
          score += flags.seekFlank ? 2.2 : 0.8;
        } else if (flags.seekFlank && inMelee) {
          score *= 0.55;
        }
        if (foe.role.toLowerCase().includes("wizard") || foe.role.toLowerCase().includes("shaman")) {
          score += focusCaster;
        }
        if (actor.spells.some((s) => s.kind !== "heal") && !flags.preferMelee) score *= 0.35;
        candidates.push({ head: "Strike_melee", score, targetId: foe.id, weapon: melee });
      }
    }
    const ranged = pickWeapon(actor, "ranged");
    if (ranged) {
      const pHit = estimatePHit(mem, actor, foe, ranged);
      if (pHit > 0) {
        let score = weight("Strike_ranged") * pHit * 2;
        if (hasCover(mem.grid, foe.pos)) score *= 0.7;
        if (inMelee) score -= flags.preferMelee ? 0.4 : 1.0;
        if (flags.preferRanged && !inMelee) score += 0.55;
        if (flags.preferBlast && actor.spells.some((s) => s.kind === "attack" || s.kind === "save")) {
          score *= 0.45;
        }
        candidates.push({ head: "Strike_ranged", score, targetId: foe.id, weapon: ranged });
      }
    }
  }

  const canMoveTo = (p: Position) => {
    const k = cellId(p);
    if (k === cellId(actor.pos)) return false;
    if (visited.has(k)) return false;
    return true;
  };

  const hasRangedOption = candidates.some(
    (c) =>
      c.head === "Strike_ranged" ||
      c.head === "Cast_cantrip" ||
      c.head === "Cast_spell",
  );

  // Flanker: only close when a real flank / sneak cell is reachable.
  if (flags.seekFlank && !inMelee) {
    const flank = flankApproachPos(mem, actor);
    if (flank && canMoveTo(flank.to)) {
      candidates.push({
        head: "Stride_close",
        score: weight("Stride_close") + 2.4,
        to: flank.to,
      });
    }
  }

  if (nearest && !inMelee) {
    const closeTo = towardPos(mem, actor, nearest);
    if (closeTo && canMoveTo(closeTo)) {
      let score = weight("Stride_close");
      if (!hasRangedOption) score += 1.2;
      else score *= flags.preferMelee ? 0.7 : 0.4;
      const dist = chebyshev(actor.pos, nearest.pos);
      score += Math.min(2, dist / 4) * (hasRangedOption && !flags.preferMelee ? 0.2 : 1);
      if (flags.preferMelee && !hasRangedOption) score += 0.8;

      if (keepRange) {
        if (endsInMelee(mem, actor, closeTo)) score *= 0.08;
        else if (hasRangedOption) score *= 0.25;
      }
      if (flags.seekFlank) score *= 0.12;

      candidates.push({ head: "Stride_close", score, to: closeTo });
    }

    const cover = coverPos(mem, actor, nearest);
    if (cover && canMoveTo(cover)) {
      let coverScore = weight("Stride_cover") + preferCover;
      if (hasRangedOption && keepRange) {
        const alreadyCover = hasCover(mem.grid, actor.pos);
        coverScore *= alreadyCover ? 0.12 : 0.35;
        if (endsInMelee(mem, actor, cover)) coverScore *= 0.1;
      }
      candidates.push({
        head: "Stride_cover",
        score: coverScore,
        to: cover,
      });
    }
  }

  if (nearest) {
    const hpPct = actor.hp / actor.maxHp;
    const dist = chebyshev(actor.pos, nearest.pos);
    const threatened = inMelee || dist <= 1;
    const rangedInMelee =
      inMelee &&
      (keepRange || (flags.seekFlank && !isFlanking(mem, actor, nearest)));
    if (hpPct < 0.4 || (preserve >= 0.8 && threatened) || rangedInMelee) {
      const away = awayPos(mem, actor, nearest);
      if (away && canMoveTo(away) && chebyshev(away, nearest.pos) > dist) {
        let stepScore =
          weight("Step_away") + (hpPct < 0.35 ? preserve : preserve * 0.3) - (inMelee ? 0.2 : 0);
        if (rangedInMelee) stepScore += 1.8;
        candidates.push({
          head: "Step_away",
          score: stepScore,
          to: away,
        });
      }
    }
  }

  // Round 1: casters / buff groups open with magic, not milling about.
  const hasCastOption = candidates.some(
    (c) => c.head === "Cast_cantrip" || c.head === "Cast_spell",
  );
  if (mem.round <= 1 && hasCastOption) {
    for (const c of candidates) {
      if (c.head === "Cast_cantrip" || c.head === "Cast_spell") {
        c.score += flags.openWithBuffs || flags.preferBlast || flags.preferControl ? 1.8 : 1.4;
      } else if (c.head === "Stride_close") c.score *= 0.45;
      else if (c.head === "Strike_melee") c.score *= flags.preferMelee ? 0.8 : 0.5;
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

export function candidateKey(c: Candidate): string {
  if (c.head === "End_turn") return "end";
  if (c.head === "Strike_melee" || c.head === "Strike_ranged") {
    return `${c.head}:${c.targetId}:${c.weapon.id}`;
  }
  if (c.head === "Cast_cantrip" || c.head === "Cast_spell" || c.head === "Heal_ally") {
    return `${c.head}:${c.spell.id}:${c.targetId}`;
  }
  if (c.head === "Stride_close" || c.head === "Stride_cover" || c.head === "Step_away") {
    return `${c.head}:${cellId(c.to)}`;
  }
  return c.head;
}

export function pickBest(
  mem: CombatMemory,
  actor: CombatantState,
  visited: Set<string> = new Set(),
): Candidate {
  const ranked = rankCandidates(mem, actor, visited);
  return ranked[0] ?? { head: "End_turn", score: 0 };
}

/** Next-best action excluding keys already vetoed by the tactics agent. */
export function pickBestExcluding(
  mem: CombatMemory,
  actor: CombatantState,
  visited: Set<string>,
  rejected: Set<string>,
): Candidate {
  for (const c of rankCandidates(mem, actor, visited)) {
    if (!rejected.has(candidateKey(c))) return c;
  }
  return { head: "End_turn", score: 0 };
}
