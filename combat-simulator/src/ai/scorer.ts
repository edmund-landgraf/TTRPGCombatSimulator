import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import { living } from "../memory/combatMemory.js";
import type { ActionHead, Position, Spell, Weapon } from "../memory/schemas.js";
import { cellId } from "../memory/schemas.js";
import { chebyshev, hasCover } from "../map/grid.js";
import { findPath } from "../map/pathfind.js";
import { occupiedKeys } from "../memory/combatMemory.js";
import { estimatePHit } from "../rules/pf2e/strike.js";
import { canCastSpell, estimateSpellScore } from "../rules/pf2e/spell.js";

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

/** Toward a foe: furthest legal cell along path that is not the foe's square. */
function towardPos(mem: CombatMemory, actor: CombatantState, foe: CombatantState): Position | null {
  const blocked = occupiedKeys(mem, actor.id);
  const path = findPath(mem.grid, actor.pos, foe.pos, actor.speedCells, blocked);
  if (!path.ok || path.path.length < 2) return null;
  for (let i = path.path.length - 1; i >= 1; i--) {
    const p = path.path[i]!;
    if (cellId(p) === cellId(foe.pos)) continue;
    if (blocked.has(cellId(p))) continue;
    return p;
  }
  return null;
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
  const w = actor.aiProfile.weights;
  const weight = (head: ActionHead) => (w[head] ?? 0) + (deltas[head] ?? 0);

  const candidates: Candidate[] = [{ head: "End_turn", score: 0.05 }];

  const foes = living(mem, actor.side === "party" ? "enemy" : "party");
  const allies = [...mem.combatants.values()].filter((c) => c.side === actor.side);
  const nearest = nearestEnemy(mem, actor);
  const meleeWeapon = pickWeapon(actor, "melee");
  const inMelee =
    !!meleeWeapon &&
    foes.some((f) => chebyshev(actor.pos, f.pos) <= (meleeWeapon.reach ?? 1));

  // Spells first so casters prefer them over weapon Strikes
  for (const spell of actor.spells) {
    if (spell.kind === "heal") {
      for (const ally of allies) {
        if (!canCastSpell(mem, actor, ally, spell)) continue;
        const missing = ally.maxHp - ally.hp;
        if (missing < 4) continue;
        let score = weight("Heal_ally") * Math.min(2, missing / 8) + estimateSpellScore(mem, actor, ally, spell);
        if (ally.hp / ally.maxHp < 0.4) score += 2;
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
        score += actor.aiProfile.featureBias?.focusCaster ?? 0;
      }
      // Prefer cantrips; still allow ranked when weight high
      if (spell.rank === 0) score += 0.3;
      candidates.push({ head, score, targetId: foe.id, spell });
    }
  }

  for (const foe of foes) {
    const melee = pickWeapon(actor, "melee");
    if (melee) {
      const pHit = estimatePHit(mem, actor, foe, melee);
      if (pHit > 0) {
        let score = weight("Strike_melee") * pHit * 2 + 0.5;
        if (inMelee) score += 2.5;
        if (foe.role.toLowerCase().includes("wizard") || foe.role.toLowerCase().includes("shaman")) {
          score += actor.aiProfile.featureBias?.focusCaster ?? 0;
        }
        // Casters: don't rush to club people if spells available
        if (actor.spells.some((s) => s.kind !== "heal")) score *= 0.35;
        candidates.push({ head: "Strike_melee", score, targetId: foe.id, weapon: melee });
      }
    }
    const ranged = pickWeapon(actor, "ranged");
    if (ranged) {
      const pHit = estimatePHit(mem, actor, foe, ranged);
      if (pHit > 0) {
        let score = weight("Strike_ranged") * pHit * 2;
        if (hasCover(mem.grid, foe.pos)) score *= 0.7;
        if (inMelee) score -= 1.0;
        if (actor.spells.some((s) => s.kind === "attack" || s.kind === "save")) score *= 0.45;
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

  if (nearest && !inMelee) {
    const closeTo = towardPos(mem, actor, nearest);
    if (closeTo && canMoveTo(closeTo)) {
      let score = weight("Stride_close");
      if (!hasRangedOption) score += 1.2;
      else score *= 0.4; // stay put if you can shoot/cast
      const dist = chebyshev(actor.pos, nearest.pos);
      score += Math.min(2, dist / 4) * (hasRangedOption ? 0.2 : 1);
      candidates.push({ head: "Stride_close", score, to: closeTo });
    }

    const cover = coverPos(mem, actor, nearest);
    if (cover && canMoveTo(cover)) {
      candidates.push({
        head: "Stride_cover",
        score: weight("Stride_cover") + (actor.aiProfile.featureBias?.preferCover ?? 0),
        to: cover,
      });
    }
  }

  if (nearest) {
    const hpPct = actor.hp / actor.maxHp;
    const preserve = actor.aiProfile.featureBias?.selfPreservation ?? 0;
    if (hpPct < 0.4 || preserve >= 0.8) {
      const away = awayPos(mem, actor, nearest);
      if (away && canMoveTo(away) && chebyshev(away, nearest.pos) > chebyshev(actor.pos, nearest.pos)) {
        candidates.push({
          head: "Step_away",
          score: weight("Step_away") + (hpPct < 0.35 ? preserve : preserve * 0.3) - (inMelee ? 1.5 : 0),
          to: away,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

export function pickBest(
  mem: CombatMemory,
  actor: CombatantState,
  visited: Set<string> = new Set(),
): Candidate {
  const ranked = rankCandidates(mem, actor, visited);
  return ranked[0] ?? { head: "End_turn", score: 0 };
}
