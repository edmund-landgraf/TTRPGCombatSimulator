import type { Candidate } from "./scorer.js";
import { candidateKey } from "./scorer.js";
import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import { living } from "../memory/combatMemory.js";
import { chebyshev } from "../map/grid.js";
import { estimatePHit } from "../rules/pf2e/strike.js";
import { endsInMelee, flankApproachPos, isFlanking } from "./flank.js";
import { groupFlags } from "./tacticsGroups.js";

export type TacticsVerdict =
  | { ok: true }
  | { ok: false; skill: string; reason: string };

export type TacticsReviewContext = {
  visited: Set<string>;
  rejected: Set<string>;
  movesThisTurn: { strides: number; steps: number };
  /** Ranked legal alternatives (already excluding prior tactics rejects). */
  alternatives: Candidate[];
};

type SkillCheck = (
  mem: CombatMemory,
  actor: CombatantState,
  choice: Candidate,
  ctx: TacticsReviewContext,
) => string | null;

type TacticsSkill = { id: string; title: string; check: SkillCheck };

function foesOf(mem: CombatMemory, actor: CombatantState): CombatantState[] {
  return living(mem, actor.side === "party" ? "enemy" : "party");
}

function alliesOf(mem: CombatMemory, actor: CombatantState): CombatantState[] {
  return living(mem, actor.side);
}

function isOffense(c: Candidate): boolean {
  return (
    c.head === "Strike_melee" ||
    c.head === "Strike_ranged" ||
    c.head === "Cast_cantrip" ||
    c.head === "Cast_spell"
  );
}

function isHeal(c: Candidate): boolean {
  return c.head === "Heal_ally";
}

function offenseAlts(alts: Candidate[]): Candidate[] {
  return alts.filter(isOffense);
}

function healAlts(alts: Candidate[]): Candidate[] {
  return alts.filter(isHeal);
}

function targetOf(c: Candidate): string | undefined {
  if ("targetId" in c) return c.targetId;
  return undefined;
}

function hasMeleeReach(actor: CombatantState, foe: CombatantState): boolean {
  const melee = actor.weapons.find((w) => w.kind === "melee");
  if (!melee) return false;
  return chebyshev(actor.pos, foe.pos) <= (melee.reach ?? 1);
}

function isMeleePrimary(actor: CombatantState): boolean {
  const melee = actor.weapons.some((w) => w.kind === "melee");
  const ranged = actor.weapons.some((w) => w.kind === "ranged");
  const caster = actor.spells.some((s) => s.kind === "attack" || s.kind === "save");
  return melee && !ranged && !caster;
}

/** Ally in triage range (critically hurt). */
function criticalAlly(mem: CombatMemory, actor: CombatantState): CombatantState | undefined {
  return alliesOf(mem, actor)
    .filter((a) => a.hp > 0 && a.hp / a.maxHp < 0.35)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
}

/** Softened foe worth finishing / focusing. */
function woundedFoe(mem: CombatMemory, actor: CombatantState): CombatantState | undefined {
  return foesOf(mem, actor)
    .filter((f) => f.hp / f.maxHp <= 0.5 || f.hp <= 6)
    .sort((a, b) => a.hp - b.hp)[0];
}

const SKILLS: TacticsSkill[] = [
  {
    id: "open_with_magic",
    title: "Open with magic",
    check: (mem, actor, choice, ctx) => {
      // Round 1: wizards/clerics should get spells into play, not stall.
      if (mem.round > 1) return null;
      if (!actor.spells.some((s) => s.kind === "attack" || s.kind === "save")) return null;
      const casts = ctx.alternatives.filter(
        (c) => c.head === "Cast_cantrip" || c.head === "Cast_spell",
      );
      if (casts.length === 0) return null; // still closing into range — Stride ok
      if (choice.head === "Cast_cantrip" || choice.head === "Cast_spell") return null;
      if (
        choice.head === "Stride_close" ||
        choice.head === "Strike_melee" ||
        choice.head === "End_turn" ||
        choice.head === "Step_away"
      ) {
        return "round 1 — cast now that a foe is in spell range (don't save the cantrip)";
      }
      return null;
    },
  },
  {
    id: "triage",
    title: "Triage the dying",
    check: (mem, actor, choice, ctx) => {
      if (!groupFlags(actor).healAllies && !actor.spells.some((s) => s.kind === "heal")) {
        return null;
      }
      const hurt = criticalAlly(mem, actor);
      if (!hurt) return null;
      const heals = healAlts(ctx.alternatives).filter((c) => targetOf(c) === hurt.id);
      if (heals.length === 0) return null;
      if (isHeal(choice) && targetOf(choice) === hurt.id) return null;
      if (isOffense(choice) || choice.head === "End_turn" || choice.head === "Step_away") {
        return `ally ${hurt.id} is critical (${hurt.hp}/${hurt.maxHp}) — heal before attacking or disengaging`;
      }
      return null;
    },
  },
  {
    id: "finish_him",
    title: "Finish the wounded",
    check: (mem, actor, choice, ctx) => {
      if (!isOffense(choice)) return null;
      const soft = woundedFoe(mem, actor);
      if (!soft) return null;
      const nearlyDead = soft.hp / soft.maxHp <= 0.35 || soft.hp <= 6;
      if (!nearlyDead) return null;
      const tid = targetOf(choice);
      if (!tid || tid === soft.id) return null;
      const tgt = mem.combatants.get(tid);
      if (!tgt || tgt.hp / tgt.maxHp <= 0.5) return null;
      const canHitSoft = offenseAlts(ctx.alternatives).some((c) => targetOf(c) === soft.id);
      if (!canHitSoft) return null;
      return `${soft.id} is nearly down (${soft.hp}/${soft.maxHp}) — finish them before ${tid}`;
    },
  },
  {
    id: "focus_fire",
    title: "Focus fire",
    check: (mem, actor, choice, ctx) => {
      if (!isOffense(choice)) return null;
      const soft = woundedFoe(mem, actor);
      if (!soft) return null;
      const tid = targetOf(choice);
      if (!tid || tid === soft.id) return null;
      const tgt = mem.combatants.get(tid);
      if (!tgt || tgt.hp < tgt.maxHp) return null; // already damaged is ok enough
      const canHitSoft = offenseAlts(ctx.alternatives).some((c) => targetOf(c) === soft.id);
      if (!canHitSoft) return null;
      return `focus fire on wounded ${soft.id} (${soft.hp}/${soft.maxHp}) instead of full-HP ${tid}`;
    },
  },
  {
    id: "close_to_melee",
    title: "Close to melee",
    check: (mem, actor, choice, ctx) => {
      if (!isMeleePrimary(actor)) return null;
      const stride = ctx.alternatives.find((c) => c.head === "Stride_close");
      if (!stride) return null;
      const inMelee = foesOf(mem, actor).some((f) => hasMeleeReach(actor, f));
      if (inMelee) return null;
      if (choice.head === "End_turn" || choice.head === "Step_away") {
        return "melee fighter is out of reach — Stride closer before ending or stepping away";
      }
      return null;
    },
  },
  {
    id: "shoot_dont_shuffle",
    title: "Shoot, don't shuffle",
    check: (_mem, actor, choice, ctx) => {
      if (choice.head !== "Stride_cover") return null;
      const f = groupFlags(actor);
      if (!f.keepDistance && !f.preferRanged) return null;
      const shot = ctx.alternatives.find(
        (c) =>
          (c.head === "Strike_ranged" || c.head === "Cast_cantrip" || c.head === "Cast_spell") &&
          c.score >= 0.7,
      );
      if (!shot) return null;
      return "already have a shot/cast — don't waste the turn cover-hopping";
    },
  },
  {
    id: "keep_range",
    title: "Keep your range",
    check: (mem, actor, choice) => {
      if (choice.head !== "Stride_close") return null;
      const f = groupFlags(actor);
      if (!f.keepDistance && !f.preferRanged) return null;
      if (!("to" in choice)) return null;
      if (!endsInMelee(mem, actor, choice.to)) return null;
      return "tactics group keeps distance — don't Stride into melee; shoot or Step back";
    },
  },
  {
    id: "rogue_backline",
    title: "Flanker stays back unless flanking",
    check: (_mem, actor, choice, ctx) => {
      if (!groupFlags(actor).seekFlank) return null;
      if (choice.head !== "Stride_close") return null;
      if (!("to" in choice)) return null;
      const flank = flankApproachPos(_mem, actor);
      if (flank && choice.to.x === flank.to.x && choice.to.y === flank.to.y) return null;
      const bow = ctx.alternatives.find((c) => c.head === "Strike_ranged" && c.score >= 0.5);
      if (bow) return "flanker — stay back and shoot unless Striding to a flank for sneak attack";
      return null;
    },
  },
  {
    id: "seek_flank",
    title: "Seek the flank",
    check: (mem, actor, choice, ctx) => {
      if (!groupFlags(actor).seekFlank) return null;
      const flank = ctx.alternatives.find((c) => {
        if (c.head !== "Stride_close" || !("to" in c)) return false;
        const path = flankApproachPos(mem, actor);
        return !!path && path.to.x === c.to.x && path.to.y === c.to.y;
      });
      if (!flank) return null;
      if (choice.head === "Stride_close" && "to" in choice) {
        const path = flankApproachPos(mem, actor);
        if (path && choice.to.x === path.to.x && choice.to.y === path.to.y) return null;
      }
      if (choice.head === "Strike_ranged" || choice.head === "End_turn") {
        return "ally has a foe pinned — Stride to the flank for sneak attack";
      }
      return null;
    },
  },
  {
    id: "hold_the_line",
    title: "Hold the line",
    check: (mem, actor, choice, ctx) => {
      if (choice.head !== "Step_away") return null;
      const f = groupFlags(actor);
      if (f.keepDistance || f.preferRanged) return null;
      if (f.seekFlank) {
        const foe = foesOf(mem, actor).find((x) => hasMeleeReach(actor, x));
        if (foe && !isFlanking(mem, actor, foe)) return null;
      }
      if (actor.hp / actor.maxHp < 0.45) return null;
      if (offenseAlts(ctx.alternatives).length === 0) return null;
      const threatened = foesOf(mem, actor).some((x) => chebyshev(actor.pos, x.pos) <= 1);
      if (!threatened) return null;
      return "healthy and engaged — Strike or cast instead of stepping away";
    },
  },
  {
    id: "no_thrash",
    title: "No thrashing",
    check: (_mem, actor, choice, ctx) => {
      if (choice.head === "Step_away" && ctx.movesThisTurn.strides > 0) {
        if (groupFlags(actor).keepDistance || groupFlags(actor).preferRanged) return null;
        return "already Strid this turn — don't Step away and waste the approach";
      }
      return null;
    },
  },
  {
    id: "cast_over_club",
    title: "Cast over club",
    check: (_mem, actor, choice, ctx) => {
      if (choice.head !== "Strike_melee") return null;
      const casts = ctx.alternatives.filter(
        (c) => c.head === "Cast_cantrip" || c.head === "Cast_spell",
      );
      if (casts.length === 0) return null;
      if (!actor.spells.some((s) => s.kind === "attack" || s.kind === "save")) return null;
      return "caster has a legal spell — don't waste the action on a staff Strike";
    },
  },
  {
    id: "dont_waste_map",
    title: "Don't waste MAP",
    check: (mem, actor, choice, ctx) => {
      if (choice.head !== "Strike_melee" && choice.head !== "Strike_ranged") return null;
      if (actor.map < 2) return null;
      const tgt = mem.combatants.get(choice.targetId);
      if (!tgt) return null;
      const pHit = estimatePHit(mem, actor, tgt, choice.weapon);
      if (pHit >= 0.3) return null;
      const better = ctx.alternatives.some(
        (c) =>
          c.head === "Heal_ally" ||
          c.head === "Stride_cover" ||
          c.head === "Cast_cantrip" ||
          c.head === "Cast_spell" ||
          (isOffense(c) && c.score > choice.score + 0.3),
      );
      if (!better && ctx.alternatives.some((c) => c.head === "End_turn")) {
        return `third attack MAP is poor (~${Math.round(pHit * 100)}% hit) — End turn instead`;
      }
      if (better) {
        return `third attack MAP is poor (~${Math.round(pHit * 100)}% hit) — pick a better action`;
      }
      return null;
    },
  },
  {
    id: "action_economy",
    title: "Spend your actions",
    check: (_mem, actor, choice, ctx) => {
      if (choice.head !== "End_turn") return null;
      if (actor.actionsLeft < 1) return null;
      const useful = ctx.alternatives.find(
        (c) =>
          c.head !== "End_turn" &&
          c.score >= 0.5 &&
          (isOffense(c) ||
            isHeal(c) ||
            c.head === "Stride_close" ||
            c.head === "Stride_cover"),
      );
      if (!useful) return null;
      return `still have ${actor.actionsLeft} action(s) and a useful ${useful.head} available`;
    },
  },
];

/**
 * Classic-tactics reviewer: approve or veto a proposed action before commit.
 * On veto, the turn loop should exclude that candidate and submit another.
 */
export function reviewAction(
  mem: CombatMemory,
  actor: CombatantState,
  choice: Candidate,
  ctx: TacticsReviewContext,
): TacticsVerdict {
  // Always allow End_turn once nothing else remains.
  if (choice.head === "End_turn") {
    const others = ctx.alternatives.filter((c) => c.head !== "End_turn");
    if (others.length === 0) return { ok: true };
  }

  for (const skill of SKILLS) {
    const reason = skill.check(mem, actor, choice, ctx);
    if (reason) {
      return { ok: false, skill: skill.id, reason };
    }
  }
  return { ok: true };
}

/** Max propose→review attempts per action slot (then commit best remaining / End_turn). */
export const TACTICS_MAX_RETRIES = 3;

export function listTacticsSkills(): { id: string; title: string }[] {
  return SKILLS.map((s) => ({ id: s.id, title: s.title }));
}

export { candidateKey };
