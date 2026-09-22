import type { Candidate } from "../ai/scorer.js";
import { candidateKey, rankCandidates } from "../ai/scorer.js";
import { flankApproachPos, isDualWeaponFlanker, isRogueLike } from "../ai/flank.js";
import { groupFlags } from "../ai/tacticsGroups.js";
import { aoeCellsForSpell, combatantsInAoe, spellHasAoe } from "../map/aoe.js";
import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import { living } from "../memory/combatMemory.js";
import type { Spell, Weapon } from "../memory/schemas.js";
import { cellId } from "../memory/schemas.js";
import { chebyshev } from "../map/grid.js";
import { canCastSpell, spellUsesLeft } from "../rules/pf2e/spell.js";
import { canStrike } from "../rules/pf2e/strike.js";
import { itemUsesLeft } from "../rules/pf2e/item.js";

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

function isAreaSpell(spell: Spell): boolean {
  return spellHasAoe(spell) || !!spell.leaveTerrain;
}

function areaSpellLabel(spell: Spell): string {
  if (spell.areaSquareCells != null && spell.areaSquareCells > 0) {
    return `${spell.areaSquareCells}×${spell.areaSquareCells} area`;
  }
  if (spell.blastRadius != null && spell.blastRadius > 0) {
    return `${spell.blastRadius}-cell burst`;
  }
  return "area";
}

function foesInAreaSpell(
  mem: CombatMemory,
  actor: CombatantState,
  spell: Spell,
  anchorId: string,
): number {
  const anchor = mem.combatants.get(anchorId);
  if (!anchor) return 0;
  const cells = aoeCellsForSpell(mem, spell, anchor.pos);
  return combatantsInAoe(mem, cells, {
    side: actor.side === "party" ? "enemy" : "party",
  }).length;
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

function strikeDistanceLabel(
  mem: CombatMemory,
  actor: CombatantState,
  targetId: string,
  weapon: Weapon,
): string {
  const target = mem.combatants.get(targetId);
  if (!target) return "";
  const dist = chebyshev(actor.pos, target.pos);
  if (weapon.kind === "melee") {
    return `${dist} sq`;
  }
  const range = weapon.rangeCells ?? 12;
  if (!canStrike(mem, actor, target, weapon)) {
    return dist > range ? `${dist} sq (max ${range})` : `${dist} sq · blocked`;
  }
  return `${dist} sq / ${range}`;
}

/** Drop candidates that fail grid range / LOS checks (must match resolveStrike / resolveSpell). */
function isSpatiallyLegal(mem: CombatMemory, actor: CombatantState, c: Candidate): boolean {
  if (c.head === "Strike_melee" || c.head === "Strike_ranged") {
    const target = mem.combatants.get(c.targetId);
    if (!target) return false;
    return canStrike(mem, actor, target, c.weapon);
  }
  if (c.head === "Cast_cantrip" || c.head === "Cast_spell" || c.head === "Heal_ally") {
    const target = mem.combatants.get(c.targetId);
    if (!target) return false;
    return canCastSpell(mem, actor, target, c.spell);
  }
  return true;
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
    const distNote = strikeDistanceLabel(mem, actor, c.targetId, c.weapon);
    return {
      label: `Strike ${tgt} with ${c.weapon.id} (${kind}${distNote ? ` · ${distNote}` : ""}, 1 act)`,
      tip: "offense — weapon attack vs Armor Class.",
      tactic: "offense",
    };
  }
  if (c.head === "Switch_weapon") {
    return {
      label: `Switch to ${c.weaponId} (1 act)`,
      tip: "reposition — change the weapon you are wielding. Strikes use the held weapon only.",
      tactic: "reposition",
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
  if (c.head === "Use_potion") {
    const tgt = c.targetId === actor.id ? "self" : allyName(mem, c.targetId);
    const left = itemUsesLeft(actor, c.item);
    return {
      label: `Drink ${c.item.name} (${tgt}, ${c.item.actions} act, ${left} left)`,
      tip: "heal — consumable potion; does not spend spell slots.",
      tactic: "heal",
    };
  }
  if (c.head === "Use_scroll") {
    const left = itemUsesLeft(actor, c.item);
    const spell = c.item.spell ?? actor.spells.find((s) => s.id === c.item.spellId);
    const spellName = spell?.name ?? c.item.name;
    const tgt =
      c.item.target === "foe" ? foeName(mem, c.targetId) : allyName(mem, c.targetId);
    const tactic = (c.item.tactic ?? spell?.tactic ?? "offense") as TacticKind;
    return {
      label: `Read scroll ${c.item.name}: ${spellName} → ${tgt} (${c.item.actions} act, ${left} left)`,
      tip: `${tactic} — one-shot scroll; spell effect without using your slots.`,
      tactic,
    };
  }
  if (c.head === "Cast_cantrip" || c.head === "Cast_spell") {
    const spell = c.spell;
    const uses = spellUsesLeft(actor, spell);
    const useNote = Number.isFinite(uses) ? `, ${uses} left` : "";
    const tactic = (spell.tactic ?? "offense") as TacticKind;

    if (isAreaSpell(spell)) {
      const areaDesc = areaSpellLabel(spell);
      const label = `Cast ${spell.name} (${areaDesc}, ${spell.actions} act${useNote})`;
      const n = foesInAreaSpell(mem, actor, spell, c.targetId);
      if (tactic === "crowd_control") {
        return {
          label,
          tip:
            n >= 2
              ? `crowd control — ${areaDesc} catches ${n} foes; strong vs low Will saves.`
              : `crowd control — ${areaDesc}; affects creatures in the area (not a single target).`,
          tactic,
        };
      }
      if (tactic === "control") {
        return {
          label,
          tip:
            n >= 2
              ? `control — ${areaDesc} catches ${n} foes; terrain/status on failed saves.`
              : `control — ${areaDesc}; place on the grid, not on one enemy.`,
          tactic,
        };
      }
      return {
        label,
        tip:
          n >= 2
            ? `offense — ${areaDesc} catches ${n} foes near the blast.`
            : `offense — ${areaDesc}; only ${n} foe in the area right now.`,
        tactic: "offense",
      };
    }

    const tgt = foeName(mem, c.targetId);
    const label = `Cast ${spell.name} at ${tgt} (${spell.actions} act${useNote})`;

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
    const flags = groupFlags(actor);
    const flank = flags.seekFlank ? flankApproachPos(mem, actor) : null;
    const isFlankCell =
      flank && flank.to.x === c.to.x && flank.to.y === c.to.y;
    if (isFlankCell) {
      return {
        label: `Stride to flank for sneak attack → ${cellId(c.to)}`,
        tip: "reposition — ally has a foe pinned; take the opposite flank.",
        tactic: "reposition",
      };
    }
    if (flags.seekFlank && actor.capabilities.includes("sneak_attack")) {
      return {
        label: `Close for sneak attack → ${cellId(c.to)}`,
        tip: "reposition — get in melee for Sneak Attack.",
        tactic: "reposition",
      };
    }
    return {
      label: `Stride toward foe → ${cellId(c.to)}`,
      tip: "reposition — close with the enemy (may provoke Reactive Strike if you leave a threatened square).",
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
    if (isRogueLike(actor)) {
      return {
        label: `Retreat → ${cellId(c.to)}`,
        tip: "defense — default 3rd action: Step out after your strikes (no Reactive Strike).",
        tactic: "defense",
      };
    }
    return {
      label: `Step away → ${cellId(c.to)}`,
      tip: "defense — 5 ft Step (does not trigger Reactive Strike / AoO).",
      tactic: "defense",
    };
  }
  return null;
}

/** Rogues default to hit-hit-retreat: pin the best Step at menu slot 3. */
function pinRetreatAsThird(
  actor: CombatantState,
  picked: Candidate[],
  unique: Candidate[],
): void {
  if (!isRogueLike(actor) && !isDualWeaponFlanker(actor)) return;
  const retreat = unique.find((c) => c.head === "Step_away");
  if (!retreat) return;
  const rk = candidateKey(retreat);
  const without = picked.filter((c) => candidateKey(c) !== rk);
  const endIdx = without.findIndex((c) => c.head === "End_turn");
  const beforeEnd = endIdx >= 0 ? without.slice(0, endIdx) : without;
  const endTurn = endIdx >= 0 ? without.slice(endIdx) : [];
  const head = beforeEnd.slice(0, 2);
  const tail = beforeEnd.slice(2);
  picked.length = 0;
  picked.push(...head, retreat, ...tail, ...endTurn);
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
    if (!isSpatiallyLegal(mem, actor, c)) return false;
    if (c.score < 0.12) return false;
    if (c.head === "Cast_cantrip" || c.head === "Cast_spell" || c.head === "Heal_ally") {
      return actor.actionsLeft >= c.spell.actions;
    }
    if (c.head === "Use_potion" || c.head === "Use_scroll") {
      return actor.actionsLeft >= c.item.actions;
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

  const foes = living(mem, actor.side === "party" ? "enemy" : "party");
  // Adjacent foe (spatial) — dual-weapon flanker menu uses this, not held reach.
  const inMelee = foes.some((f) => chebyshev(actor.pos, f.pos) <= 1);
  const dualWeaponFlanker = isDualWeaponFlanker(actor);

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
  const seenAreaSpell = new Set<string>();

  const shouldSkip = (c: Candidate): boolean => {
    if (c.head !== "Cast_cantrip" && c.head !== "Cast_spell") return false;
    if (isAreaSpell(c.spell)) {
      if (seenAreaSpell.has(c.spell.id)) return true;
      seenAreaSpell.add(c.spell.id);
      return false;
    }
    if (seenSpell.has(c.spell.id) && seenSpell.size >= 3) return true;
    if (seenSpell.has(c.spell.id)) return true;
    seenSpell.add(c.spell.id);
    return false;
  };

  // Dual-weapon rogues: lead with close/sneak, then a few ranged pokes — not five bow shots.
  if (dualWeaponFlanker && !inMelee) {
    const close = (byTactic.get("reposition") ?? []).find((c) => c.head === "Stride_close");
    if (close) {
      const k = candidateKey(close);
      if (!seen.has(k)) {
        seen.add(k);
        picked.push(close);
      }
    }
  }

  const maxOffense =
    dualWeaponFlanker && !inMelee ? 2 : maxChoices;

  // Offense: prefer diverse spells/weapons (don't list the same cantrip five times).
  let offensePicked = 0;
  for (const c of byTactic.get("offense") ?? []) {
    if (picked.length >= maxChoices - 1) break;
    if (dualWeaponFlanker && !inMelee && offensePicked >= maxOffense) break;
    const k = candidateKey(c);
    if (seen.has(k)) continue;
    if (shouldSkip(c)) continue;
    seen.add(k);
    picked.push(c);
    offensePicked++;
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
      if (shouldSkip(c)) continue;
      seen.add(k);
      picked.push(c);
      if (picked.length >= maxChoices - 1) break;
    }
    if (picked.length >= maxChoices - 1) break;
  }
  for (const c of unique) {
    if (picked.length >= maxChoices - 1) break;
    if (dualWeaponFlanker && !inMelee && c.head === "Strike_ranged" && offensePicked >= maxOffense) {
      continue;
    }
    const k = candidateKey(c);
    if (seen.has(k)) continue;
    if (shouldSkip(c)) continue;
    seen.add(k);
    picked.push(c);
    if (c.head === "Strike_melee" || c.head === "Strike_ranged") offensePicked++;
  }
  pinRetreatAsThird(actor, picked, unique);
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
