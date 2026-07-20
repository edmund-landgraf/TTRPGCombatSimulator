import type { Candidate } from "../ai/scorer.js";
import { rankCandidates } from "../ai/scorer.js";
import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import { living } from "../memory/combatMemory.js";
import { cellId } from "../memory/schemas.js";
import { chebyshev } from "../map/grid.js";
import { spellUsesLeft } from "../rules/pf2e/spell.js";

export type TacticKind =
  | "offense"
  | "control"
  | "crowd_control"
  | "heal"
  | "support"
  | "reposition"
  | "defense"
  | "end";

export type PlayerChoice = {
  key: string;
  label: string;
  tip: string;
  tactic: TacticKind;
  candidate: Candidate;
};

const KEYS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function foeName(mem: CombatMemory, id: string): string {
  return mem.combatants.get(id)?.name ?? id;
}

function allyName(mem: CombatMemory, id: string): string {
  return mem.combatants.get(id)?.name ?? id;
}

function blastFoeCount(
  mem: CombatMemory,
  actor: CombatantState,
  centerId: string,
  radius: number,
): number {
  const center = mem.combatants.get(centerId);
  if (!center) return 0;
  const foes = living(mem, actor.side === "party" ? "enemy" : "party");
  return foes.filter((f) => chebyshev(center.pos, f.pos) <= radius).length;
}

function describe(
  mem: CombatMemory,
  actor: CombatantState,
  c: Candidate,
): { label: string; tip: string; tactic: TacticKind } | null {
  if (c.head === "End_turn") {
    return {
      label: "End turn",
      tip: "Save remaining actions. MAP resets on your next turn.",
      tactic: "end",
    };
  }
  if (c.head === "Strike_melee" || c.head === "Strike_ranged") {
    const tgt = foeName(mem, c.targetId);
    const kind = c.head === "Strike_melee" ? "melee" : "ranged";
    return {
      label: `Strike ${tgt} with ${c.weapon.id} (${kind}, 1 act)`,
      tip: "offense — weapon attack vs Armor Class.",
      tactic: "offense",
    };
  }
  if (c.head === "Heal_ally") {
    const tgt = allyName(mem, c.targetId);
    const uses = spellUsesLeft(actor, c.spell);
    const useNote = Number.isFinite(uses) ? `, ${uses} left` : "";
    return {
      label: `Cast ${c.spell.name} on ${tgt} (${c.spell.actions} act${useNote})`,
      tip: "heal — restore HP to a wounded ally.",
      tactic: "heal",
    };
  }
  if (c.head === "Cast_cantrip" || c.head === "Cast_spell") {
    const tgt = foeName(mem, c.targetId);
    const spell = c.spell;
    const uses = spellUsesLeft(actor, spell);
    const useNote = Number.isFinite(uses) ? `, ${uses} left` : "";
    const label = `Cast ${spell.name} at ${tgt} (${spell.actions} act${useNote})`;
    const tactic = (spell.tactic ?? "offense") as TacticKind;

    if (tactic === "crowd_control") {
      const will = mem.combatants.get(c.targetId)?.saveBonus ?? 0;
      return {
        label,
        tip: `crowd control — strong vs low Will (their save +${will}). Skipped vs high Will.`,
        tactic,
      };
    }
    if (tactic === "control") {
      return {
        label,
        tip: "control — terrain/status (e.g. Grease → off-guard on a failed save).",
        tactic,
      };
    }
    if (spell.blastRadius != null && spell.blastRadius > 0) {
      const n = blastFoeCount(mem, actor, c.targetId, spell.blastRadius);
      return {
        label,
        tip:
          n >= 2
            ? `offense — blast: ${n} foes near ${tgt}; good clustered target.`
            : `offense — blast: only ${n} foe near ${tgt}; wait for a cluster if you can.`,
        tactic: "offense",
      };
    }
    return {
      label,
      tip:
        spell.kind === "save"
          ? "offense — saving throw; often half damage on a success."
          : "offense — spell attack roll vs AC.",
      tactic: "offense",
    };
  }
  if (c.head === "Stride_close") {
    return {
      label: `Stride toward foe → ${cellId(c.to)}`,
      tip: "reposition — close with the enemy.",
      tactic: "reposition",
    };
  }
  if (c.head === "Stride_cover") {
    return {
      label: `Stride to cover → ${cellId(c.to)}`,
      tip: "defense — move onto cover (+AC vs ranged).",
      tactic: "defense",
    };
  }
  if (c.head === "Step_away") {
    return {
      label: `Step away → ${cellId(c.to)}`,
      tip: "defense — 5 ft Step (does not trigger Reactive Strike / AoO).",
      tactic: "defense",
    };
  }
  return null;
}

function candidateKey(c: Candidate): string {
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

/**
 * Build a short multiple-choice menu of only legal actions for this PC.
 * Caps list size; always includes End turn; prefers diverse tactics.
 */
export function buildPlayerChoices(
  mem: CombatMemory,
  actor: CombatantState,
  visited: Set<string>,
  maxChoices = 8,
): PlayerChoice[] {
  const ranked = rankCandidates(mem, actor, visited).filter((c) => {
    if (c.head === "End_turn") return true;
    if (c.score < 0.12) return false;
    if (c.head === "Cast_cantrip" || c.head === "Cast_spell" || c.head === "Heal_ally") {
      return actor.actionsLeft >= c.spell.actions;
    }
    return actor.actionsLeft >= 1;
  });

  const best = new Map<string, Candidate>();
  for (const c of ranked) {
    const k = candidateKey(c);
    const prev = best.get(k);
    if (!prev || c.score > prev.score) best.set(k, c);
  }
  const unique = [...best.values()].sort((a, b) => b.score - a.score);

  const byTactic = new Map<TacticKind, Candidate[]>();
  for (const c of unique) {
    const d = describe(mem, actor, c);
    if (!d) continue;
    const arr = byTactic.get(d.tactic) ?? [];
    arr.push(c);
    byTactic.set(d.tactic, arr);
  }

  const picked: Candidate[] = [];
  const seen = new Set<string>();
  const seenSpell = new Set<string>();

  // Offense: prefer diverse spells/weapons (don't list the same cantrip five times).
  for (const c of byTactic.get("offense") ?? []) {
    if (picked.length >= maxChoices - 1) break;
    const k = candidateKey(c);
    if (seen.has(k)) continue;
    if (c.head === "Cast_cantrip" || c.head === "Cast_spell") {
      if (seenSpell.has(c.spell.id) && seenSpell.size >= 3) continue;
      // one option per spell id first pass
      if (seenSpell.has(c.spell.id)) continue;
      seenSpell.add(c.spell.id);
    }
    seen.add(k);
    picked.push(c);
  }

  for (const tactic of [
    "crowd_control",
    "control",
    "heal",
    "defense",
    "reposition",
    "end",
  ] as TacticKind[]) {
    const list = byTactic.get(tactic) ?? [];
    for (const c of list.slice(0, 2)) {
      const k = candidateKey(c);
      if (seen.has(k)) continue;
      seen.add(k);
      picked.push(c);
      if (picked.length >= maxChoices - 1) break;
    }
    if (picked.length >= maxChoices - 1) break;
  }
  for (const c of unique) {
    if (picked.length >= maxChoices - 1) break;
    const k = candidateKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push(c);
  }
  if (!picked.some((c) => c.head === "End_turn")) {
    picked.push({ head: "End_turn", score: 0.05 });
  }

  return picked.slice(0, maxChoices).map((c, i) => {
    const d = describe(mem, actor, c)!;
    return {
      key: KEYS[i]!,
      label: d.label,
      tip: d.tip,
      tactic: d.tactic,
      candidate: c,
    };
  });
}
