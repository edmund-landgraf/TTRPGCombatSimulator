import type { Candidate } from "./scorer.js";
import { candidateKey } from "./scorer.js";
import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import { living } from "../memory/combatMemory.js";
import { chebyshev } from "../map/grid.js";
import { estimatePHit } from "../rules/pf2e/strike.js";
import { endsInMelee, flankApproachPos, isFlanking } from "./flank.js";
import {
  alreadyHasCover,
  classPacketOf,
  heavyStatusPenalty,
  nearFinishTarget,
  persistentThreat,
  threatenedByRangedLos,
  weakestSaveFoe,
} from "./combatLoop.js";
import { gatherBattlefieldHints, hasCapability, resolveBuildProfile } from "./buildProfile.js";
import { shouldAttemptFeat } from "./featLookup.js";
import {
  breakFlankStepPos,
  canReachAdjacentInOneStride,
  frontlinerAllyHoldingChoke,
  hazardDamageAlongPath,
  isChokepointCell,
  isFlankedBy,
  nearestFoe,
  pathCells,
  pathCrossesDifficult,
  strideIsImmediateKill,
  wallAnchorStepPos,
} from "./spatialThreat.js";
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
  // --- Step 1: Environmental & Status Assessment ---
  {
    id: "clear_persistent",
    title: "Clear persistent damage threat",
    check: (_mem, actor, choice, ctx) => {
      const threat = persistentThreat(actor);
      if (!threat) return null;
      const selfHeal = healAlts(ctx.alternatives).find((c) => targetOf(c) === actor.id);
      if (!selfHeal) return null;
      if (isHeal(choice) && targetOf(choice) === actor.id) return null;
      if (isOffense(choice) || choice.head === "End_turn" || choice.head === "Stride_close") {
        return `persistent ${threat.condition.name} (${threat.tick}/tick) with hp ${actor.hp} — recover before offense`;
      }
      return null;
    },
  },
  {
    id: "clear_status_penalty",
    title: "Don't attack through heavy status penalties",
    check: (_mem, actor, choice, ctx) => {
      const pen = heavyStatusPenalty(actor);
      if (!pen) return null;
      const defensive = ctx.alternatives.find(
        (c) =>
          c.head === "Step_away" ||
          c.head === "Stride_cover" ||
          c.head === "Heal_ally" ||
          (c.head === "Cast_cantrip" && "spell" in c && c.spell.tactic === "support"),
      );
      if (!defensive) return null;
      if (
        choice.head === "Strike_melee" ||
        choice.head === "Strike_ranged" ||
        (choice.head === "Cast_spell" && "spell" in choice && choice.spell.rank > 0)
      ) {
        return `${pen.name} ${pen.value ?? 2}+ tanks accuracy — pivot to defense/buff, not ranked offense`;
      }
      return null;
    },
  },
  // --- Step 2: Spatiotemporal Positioning (see also spatialThreat skills) ---
  {
    id: "break_flank",
    title: "Break the flank (critical)",
    check: (_mem, actor, choice, ctx) => {
      // CRITICAL OVERRIDE — supersedes offense when enemies flank the actor.
      if (!isFlankedBy(_mem, actor)) return null;
      const escape = ctx.alternatives.find(
        (c) =>
          c.head === "Step_away" &&
          "to" in c &&
          !isFlankedBy(_mem, actor, 1, c.to),
      );
      if (!escape && !breakFlankStepPos(_mem, actor)) return null;
      if (choice.head === "Step_away" && "to" in choice) {
        if (!isFlankedBy(_mem, actor, 1, choice.to)) return null;
        return "still flanked after that Step — pick a square that breaks the pincer";
      }
      if (isOffense(choice) || choice.head === "End_turn" || choice.head === "Stride_close") {
        return "enemies are flanking you (off-guard) — Step to break the line before attacking";
      }
      return null;
    },
  },
  {
    id: "avoid_hazard",
    title: "Avoid hazardous terrain",
    check: (mem, actor, choice) => {
      if (
        choice.head !== "Stride_close" &&
        choice.head !== "Stride_cover" &&
        choice.head !== "Step_away"
      ) {
        return null;
      }
      if (!("to" in choice)) return null;
      const budget = choice.head === "Step_away" ? 1 : actor.speedCells;
      const path = pathCells(mem, actor.pos, choice.to, budget, actor.id);
      if (!path) return null;
      const hazardDmg = hazardDamageAlongPath(mem.grid, path);
      if (hazardDmg <= 0) return null;
      const killOk =
        hazardDmg < actor.hp && strideIsImmediateKill(mem, actor, choice.to);
      if (killOk) return null;
      return `path crosses hazardous terrain (~${hazardDmg} dmg) — reroute unless it secures an immediate kill`;
    },
  },
  {
    id: "respect_difficult",
    title: "Respect difficult terrain",
    check: (mem, actor, choice, ctx) => {
      if (hasCapability(actor, "ignore_difficult_terrain")) return null;
      if (choice.head !== "Stride_close") return null;
      if (!("to" in choice)) return null;
      const foe = nearestFoe(mem, actor);
      if (!foe) return null;
      const stridePath = pathCells(mem, actor.pos, choice.to, actor.speedCells, actor.id);
      const approach = pathCells(
        mem,
        actor.pos,
        foe.pos,
        actor.speedCells * 4,
        actor.id,
      );
      const crosses =
        (!!stridePath && pathCrossesDifficult(mem.grid, stridePath)) ||
        (!!approach && pathCrossesDifficult(mem.grid, approach));
      if (!crosses) return null;
      const reaches =
        endsInMelee(mem, actor, choice.to) || canReachAdjacentInOneStride(mem, actor, foe);
      const ranged = ctx.alternatives.find(
        (c) =>
          (c.head === "Strike_ranged" ||
            c.head === "Cast_cantrip" ||
            c.head === "Cast_spell") &&
          c.score >= 0.55,
      );
      if (!ranged) return null;
      if (ctx.movesThisTurn.strides >= 1 && !endsInMelee(mem, actor, choice.to)) {
        return "difficult terrain — don't Stride twice; shoot or force them to cross";
      }
      if (ctx.movesThisTurn.strides === 0 && !reaches) {
        return "target behind difficult terrain — shoot rather than burning Strides to crawl through";
      }
      return null;
    },
  },
  {
    id: "anchor_wall",
    title: "Anchor to wall against multi-threat",
    check: (mem, actor, choice, ctx) => {
      const anchor = wallAnchorStepPos(mem, actor);
      if (!anchor) return null;
      const stepAlt = ctx.alternatives.find(
        (c) =>
          c.head === "Step_away" &&
          "to" in c &&
          c.to.x === anchor.x &&
          c.to.y === anchor.y,
      );
      if (!stepAlt) return null;
      if (choice.head === "Step_away" && "to" in choice) {
        if (choice.to.x === anchor.x && choice.to.y === anchor.y) return null;
      }
      if (choice.head === "End_turn" || (isOffense(choice) && actor.map >= 1)) {
        return "two+ foes in melee — Step to wall/corner to deny a flank";
      }
      return null;
    },
  },
  {
    id: "hold_chokepoint",
    title: "Hold the chokepoint",
    check: (mem, actor, choice) => {
      if (choice.head !== "Step_away") return null;
      const f = groupFlags(actor);
      if (!f.preferMelee || f.keepDistance) return null;
      if (!isChokepointCell(mem.grid, actor.pos)) return null;
      if (actor.hp / actor.maxHp < 0.4) return null;
      if (isFlankedBy(mem, actor)) return null;
      return "holding a doorway/corridor — stay planted and force them through you";
    },
  },
  {
    id: "deep_retreat_choke",
    title: "Stay behind the choke tank",
    check: (mem, actor, choice) => {
      if (choice.head !== "Stride_close") return null;
      if (!("to" in choice)) return null;
      const f = groupFlags(actor);
      if (!f.keepDistance && !f.preferRanged) return null;
      const tank = frontlinerAllyHoldingChoke(mem, actor);
      if (!tank) return null;
      // Maintain ~20 ft (4 cells) behind the frontliner.
      if (chebyshev(choice.to, tank.pos) >= 4) return null;
      if (chebyshev(actor.pos, tank.pos) >= 4 && chebyshev(choice.to, tank.pos) < 4) {
        return "keep 20 ft behind the frontliner at the chokepoint";
      }
      // Closing past the tank toward the scrum.
      const foe = nearestFoe(mem, actor);
      if (!foe) return null;
      if (chebyshev(choice.to, foe.pos) < chebyshev(tank.pos, foe.pos)) {
        return "deep retreat — don't Stride past the choke tank into melee";
      }
      return null;
    },
  },
  // --- Step 3: Tactical Target & Saving Throw Selection ---
  {
    id: "save_arbitrage",
    title: "Save arbitrage — hit the weak defense",
    check: (mem, actor, choice, ctx) => {
      if (choice.head !== "Cast_cantrip" && choice.head !== "Cast_spell") return null;
      if (!("spell" in choice) || choice.spell.kind !== "save") return null;
      const tid = targetOf(choice);
      if (!tid) return null;
      const tgt = mem.combatants.get(tid);
      if (!tgt) return null;
      const weak = weakestSaveFoe(mem, actor);
      if (!weak || weak.id === tid) return null;
      if (tgt.saveBonus - weak.saveBonus < 2) return null;
      const alt = ctx.alternatives.find(
        (c) =>
          (c.head === "Cast_cantrip" || c.head === "Cast_spell") &&
          "spell" in c &&
          c.spell.id === choice.spell.id &&
          targetOf(c) === weak.id,
      );
      if (!alt) return null;
      return `save arbitrage — ${weak.id} save ${weak.saveBonus} beats ${tid} save ${tgt.saveBonus}`;
    },
  },
  // --- Step 4: Action Packet Execution (class matrices + capability overlays) ---
  {
    id: "prefer_off_guard",
    title: "Sneak Attack — prefer Off-Guard before Strike",
    check: (mem, actor, choice, ctx) => {
      if (!hasCapability(actor, "sneak_attack")) return null;
      if (actor.map > 0) return null;
      if (choice.head !== "Strike_melee") return null;
      const tid = targetOf(choice);
      if (!tid) return null;
      const foe = mem.combatants.get(tid);
      if (!foe || isFlanking(mem, actor, foe)) return null;
      const path = flankApproachPos(mem, actor);
      if (!path) return null;
      const stride = ctx.alternatives.find(
        (c) =>
          c.head === "Stride_close" &&
          "to" in c &&
          c.to.x === path.to.x &&
          c.to.y === path.to.y,
      );
      if (!stride) return null;
      const hints = gatherBattlefieldHints(mem, actor);
      const gate = shouldAttemptFeat(mem, actor, "sneak_attack", { hints });
      if (gate.attempt) return null;
      return `sneak_attack — ${gate.reason}`;
    },
  },
  {
    id: "setup_reactive_strike",
    title: "Reactive Strike — hold adjacent geometry",
    check: (mem, actor, choice, ctx) => {
      if (!hasCapability(actor, "reactive_strike") && !hasCapability(actor, "champion_dedication")) {
        return null;
      }
      if (!actor.reactionAvailable) return null;
      if (choice.head !== "Step_away" && choice.head !== "Stride_cover") return null;
      const inMelee = foesOf(mem, actor).some((f) => hasMeleeReach(actor, f));
      if (!inMelee) return null;
      if (actor.hp / actor.maxHp < 0.4) return null;
      const strike = offenseAlts(ctx.alternatives).find((c) => c.head === "Strike_melee");
      if (!strike && choice.head === "Step_away") return null;
      if (choice.head === "Step_away" && actor.map >= 1) {
        return "reactive strike armed — stay adjacent to threaten the reaction instead of stepping out";
      }
      return null;
    },
  },
  {
    id: "font_heal_priority",
    title: "Heal Font — triage before offense",
    check: (mem, actor, choice, ctx) => {
      if (!hasCapability(actor, "heal_font")) return null;
      const hurt = criticalAlly(mem, actor);
      if (!hurt) return null;
      const heals = healAlts(ctx.alternatives).filter((c) => targetOf(c) === hurt.id);
      if (heals.length === 0) return null;
      if (isHeal(choice) && targetOf(choice) === hurt.id) return null;
      if (isOffense(choice) || choice.head === "End_turn") {
        return `heal font — ${hurt.id} critical (${hurt.hp}/${hurt.maxHp}); spend font before offense`;
      }
      return null;
    },
  },
  {
    id: "fighter_setup",
    title: "Fighter — set up off-guard before MAP-0 Strike",
    check: (mem, actor, choice, ctx) => {
      const role = resolveBuildProfile(actor).rolePacket;
      if (role !== "fighter" && role !== "champion" && classPacketOf(actor) !== "fighter") {
        return null;
      }
      if (actor.map > 0) return null;
      if (choice.head !== "Strike_melee") return null;
      const tid = targetOf(choice);
      if (!tid) return null;
      const foe = mem.combatants.get(tid);
      if (!foe || isFlanking(mem, actor, foe)) return null;
      const path = flankApproachPos(mem, actor);
      if (!path) return null;
      const stride = ctx.alternatives.find(
        (c) =>
          c.head === "Stride_close" &&
          "to" in c &&
          c.to.x === path.to.x &&
          c.to.y === path.to.y,
      );
      if (!stride) return null;
      return "critical fisher — Stride to flank (off-guard) before the MAP-0 Strike";
    },
  },
  {
    id: "math_buff_first",
    title: "Bard — math buff before offense",
    check: (mem, actor, choice, ctx) => {
      if (classPacketOf(actor) !== "bard" && !groupFlags(actor).openWithBuffs) return null;
      if (mem.round > 2) return null;
      const buffs = ctx.alternatives.filter(
        (c) =>
          (c.head === "Cast_cantrip" || c.head === "Cast_spell") &&
          "spell" in c &&
          (c.spell.tactic === "support" || c.spell.tactic === "control"),
      );
      if (buffs.length === 0) return null;
      if (
        (choice.head === "Cast_cantrip" || choice.head === "Cast_spell") &&
        "spell" in choice &&
        (choice.spell.tactic === "support" || choice.spell.tactic === "control")
      ) {
        return null;
      }
      if (isOffense(choice) || choice.head === "End_turn") {
        return "math maximizer — drop party buff/control before raw offense";
      }
      return null;
    },
  },
  {
    id: "monk_skirmish",
    title: "Monk — deny chase actions after strikes",
    check: (mem, actor, choice, ctx) => {
      if (classPacketOf(actor) !== "monk") return null;
      if (actor.map < 1) return null;
      if (choice.head !== "Strike_melee" && choice.head !== "Strike_ranged") return null;
      const tgt = mem.combatants.get(choice.targetId);
      if (tgt && actor.map < 2 && nearFinishTarget(tgt)) return null;
      const step = ctx.alternatives.find((c) => c.head === "Step_away" || c.head === "Stride_cover");
      if (!step) return null;
      const inMelee = foesOf(mem, actor).some((f) => hasMeleeReach(actor, f));
      if (!inMelee) return null;
      return "action denier — Step/Stride out after strikes so foes waste actions chasing";
    },
  },
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
      // Flank escape and chokepoint holds own these cases.
      if (isFlankedBy(mem, actor)) return null;
      if (isChokepointCell(mem.grid, actor.pos)) return null;
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
      // Grandmaster loop: never third-strike under normal MAP unless finishing.
      if (nearFinishTarget(tgt)) return null;
      const pHit = estimatePHit(mem, actor, tgt, choice.weapon);
      const better = ctx.alternatives.some(
        (c) =>
          c.head === "Heal_ally" ||
          c.head === "Stride_cover" ||
          c.head === "Step_away" ||
          c.head === "Cast_cantrip" ||
          c.head === "Cast_spell" ||
          c.head === "End_turn" ||
          (isOffense(c) && c.score > choice.score + 0.3),
      );
      if (better || ctx.alternatives.some((c) => c.head === "End_turn")) {
        return `never third-strike under MAP (~${Math.round(pHit * 100)}% hit) — mitigate or End turn`;
      }
      return null;
    },
  },
  // --- Step 5: End of Turn Mitigation ---
  {
    id: "eot_mitigate",
    title: "End-of-turn mitigation over low-odds attacks",
    check: (mem, actor, choice, ctx) => {
      if (actor.actionsLeft !== 1) return null;
      if (choice.head !== "Strike_melee" && choice.head !== "Strike_ranged") return null;
      const tgt = mem.combatants.get(choice.targetId);
      if (tgt && nearFinishTarget(tgt)) return null;
      const cover = ctx.alternatives.find((c) => c.head === "Stride_cover");
      const needCover =
        threatenedByRangedLos(mem, actor) && !alreadyHasCover(mem, actor) && !!cover;
      // After two attacks (MAP −10): always prefer mitigation.
      if (actor.map >= 2) {
        if (needCover) return "EoT mitigation — Take Cover vs ranged LOS instead of MAP-10 Strike";
        if (ctx.alternatives.some((c) => c.head === "Step_away" || c.head === "End_turn")) {
          return "EoT mitigation — End turn / Step rather than a third Strike";
        }
      }
      // After one attack: only divert when cover is clearly better than a press.
      if (actor.map >= 1 && needCover) {
        return "EoT mitigation — Take Cover vs ranged LOS instead of another Strike";
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
      // EoT mitigation may intentionally end with actions left after MAP strikes.
      if (actor.map >= 2) return null;
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
