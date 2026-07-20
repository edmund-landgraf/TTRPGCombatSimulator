import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import type { Candidate } from "../ai/scorer.js";
import { candidateKey, pickBest, pickBestExcluding, rankCandidates } from "../ai/scorer.js";
import {
  reviewAction,
  TACTICS_MAX_RETRIES,
  type TacticsReviewContext,
} from "../ai/tacticsAgent.js";
import {
  commanderFor,
  recordDecision,
  toRanked,
  type DecisionReject,
} from "../ai/decisionLog.js";
import { cellId } from "../memory/schemas.js";
import { resolveStride, resolveStep } from "../rules/pf2e/movement.js";
import { formatAttackLine, resolveStrike } from "../rules/pf2e/strike.js";
import { formatSpellLine, resolveSpell } from "../rules/pf2e/spell.js";
import type { SeededRng } from "../rules/pf2e/rng.js";
import { wantDelay, applyDelay } from "../rules/pf2e/delay.js";
import type { ActionChooser } from "../play/prompt.js";

export function startTurn(mem: CombatMemory, actorId: string): void {
  const actor = mem.combatants.get(actorId);
  if (!actor) return;
  actor.actionsLeft = 3;
  actor.reactionAvailable = true;
  actor.map = 0;
}

/** Apply one chosen candidate. Returns false if the turn should stop. */
export function executeCandidate(
  mem: CombatMemory,
  actor: CombatantState,
  choice: Candidate,
  rng: SeededRng,
  log: string[],
  visited: Set<string>,
  movesThisTurn: { strides: number; steps: number },
): boolean {
  if (choice.head === "End_turn") return false;

  if (choice.head === "Strike_melee" || choice.head === "Strike_ranged") {
    const target = mem.combatants.get(choice.targetId);
    if (!target || target.downed) return false;
    resolveStrike(mem, actor, target, choice.weapon, rng, mem.round);
    const ev = mem.events[mem.events.length - 1];
    if (ev?.t === "attack") log.push(formatAttackLine(ev));
    else if (ev?.t === "reject") {
      log.push(`  REJECT ${ev.reason}`);
      return false;
    }
    return true;
  }

  if (
    choice.head === "Cast_cantrip" ||
    choice.head === "Cast_spell" ||
    choice.head === "Heal_ally"
  ) {
    const target = mem.combatants.get(choice.targetId);
    if (!target || (choice.head !== "Heal_ally" && target.downed)) return false;
    resolveSpell(mem, actor, target, choice.spell, rng, mem.round);
    const ev = mem.events[mem.events.length - 1];
    if (ev?.t === "spell") log.push(formatSpellLine(ev));
    else if (ev?.t === "reject") {
      log.push(`  REJECT ${ev.reason}`);
      return false;
    }
    return true;
  }

  // PF2e allows multiple Strides per turn. Cap Step_away to one so skittish
  // combatants don't burn the turn stepping back and forth.
  if (choice.head === "Step_away" && movesThisTurn.steps >= 1) {
    return false;
  }

  if (choice.head === "Stride_close" || choice.head === "Stride_cover") {
    const ok = resolveStride(mem, actor, choice.to, mem.round);
    const ev = mem.events[mem.events.length - 1];
    if (ev?.t === "move") {
      log.push(`  ${ev.kind} ${ev.from} → ${ev.to}`);
      visited.add(ev.to);
      movesThisTurn.strides++;
    } else if (ev?.t === "reject") {
      log.push(`  REJECT ${ev.reason}`);
      return false;
    }
    return ok;
  }

  if (choice.head === "Step_away") {
    const ok = resolveStep(mem, actor, choice.to, mem.round);
    const ev = mem.events[mem.events.length - 1];
    if (ev?.t === "move") {
      log.push(`  ${ev.kind} ${ev.from} → ${ev.to}`);
      visited.add(ev.to);
      movesThisTurn.steps++;
    } else if (ev?.t === "reject") log.push(`  REJECT ${ev.reason}`);
    return ok;
  }

  return false;
}

/**
 * Propose an action via the side's commander agent, send it through the
 * tactics reviewer, and on reject propose a different action (up to
 * TACTICS_MAX_RETRIES). Records the full decision tree branch.
 */
function proposeWithTacticsReview(
  mem: CombatMemory,
  actor: CombatantState,
  visited: Set<string>,
  movesThisTurn: { strides: number; steps: number },
  log: string[],
  actionSlot: number,
): Candidate {
  const rejected = new Set<string>();
  const rejects: DecisionReject[] = [];
  const ranked = rankCandidates(mem, actor, visited);
  let choice = pickBest(mem, actor, visited);

  for (let attempt = 0; attempt < TACTICS_MAX_RETRIES; attempt++) {
    if (choice.head === "End_turn") {
      // Still let skills veto idle when useful alternatives remain.
    } else if (choice.score < 0.15 && !choice.head.startsWith("Stride")) {
      recordDecision(mem, {
        agent: commanderFor(actor.side),
        round: mem.round,
        actorId: actor.id,
        actorName: actor.name,
        side: actor.side,
        actionSlot,
        actionsLeft: actor.actionsLeft,
        ranked: ranked.map((c, i) => toRanked(c, i + 1)),
        rejects,
        chosen: null,
        outcome: "low_score",
      });
      return { head: "End_turn", score: 0 };
    }

    const alternatives = ranked.filter((c) => !rejected.has(candidateKey(c)));
    const ctx: TacticsReviewContext = {
      visited,
      rejected,
      movesThisTurn,
      alternatives,
    };
    const verdict = reviewAction(mem, actor, choice, ctx);
    if (verdict.ok) {
      const outcome = choice.head === "End_turn" ? "end_turn" : "accepted";
      recordDecision(mem, {
        agent: commanderFor(actor.side),
        round: mem.round,
        actorId: actor.id,
        actorName: actor.name,
        side: actor.side,
        actionSlot,
        actionsLeft: actor.actionsLeft,
        ranked: ranked.map((c, i) => toRanked(c, i + 1)),
        rejects,
        chosen: toRanked(choice, ranked.findIndex((c) => candidateKey(c) === candidateKey(choice)) + 1),
        outcome,
      });
      return choice;
    }

    const key = candidateKey(choice);
    rejected.add(key);
    rejects.push({
      attempt: attempt + 1,
      key,
      head: choice.head,
      score: Number(choice.score.toFixed(3)),
      skill: verdict.skill,
      reason: verdict.reason,
    });
    log.push(`  TACTICS reject [${verdict.skill}]: ${verdict.reason}`);
    mem.events.push({
      t: "reject",
      round: mem.round,
      actor: actor.id,
      reason: `tactics:${verdict.skill}: ${verdict.reason}`,
    });
    choice = pickBestExcluding(mem, actor, visited, rejected);
  }

  recordDecision(mem, {
    agent: commanderFor(actor.side),
    round: mem.round,
    actorId: actor.id,
    actorName: actor.name,
    side: actor.side,
    actionSlot,
    actionsLeft: actor.actionsLeft,
    ranked: ranked.map((c, i) => toRanked(c, i + 1)),
    rejects,
    chosen: toRanked(choice, ranked.findIndex((c) => candidateKey(c) === candidateKey(choice)) + 1),
    outcome: choice.head === "End_turn" ? "end_turn" : "accepted",
  });
  return choice;
}

export async function runTurn(
  mem: CombatMemory,
  actorId: string,
  rng: SeededRng,
  log: string[],
  chooser?: ActionChooser,
): Promise<void> {
  const actor = mem.combatants.get(actorId);
  if (!actor || actor.downed) return;

  // Sleep: skip this turn, then wake
  const asleep = actor.conditions.find((c) => c.name === "asleep");
  if (asleep) {
    startTurn(mem, actorId);
    log.push(`--- ${actor.id} (${actor.name}) ---`);
    log.push("  (asleep — skips this turn, then wakes)");
    actor.conditions = actor.conditions.filter((c) => c.name !== "asleep");
    mem.events.push({ t: "end_turn", round: mem.round, actor: actorId });
    return;
  }

  const usePlayer = !!chooser && actor.side === "party";

  // PF2e Delay is a free action when your turn begins — before other actions.
  if (!usePlayer && wantDelay(mem, actor)) {
    applyDelay(mem, actor, log);
    return;
  }

  startTurn(mem, actorId);
  log.push(`--- ${actor.id} (${actor.name}) ---`);

  const visited = new Set<string>([cellId(actor.pos)]);
  const movesThisTurn = { strides: 0, steps: 0 };
  let safety = 0;
  let actionSlot = 0;

  while (actor.actionsLeft > 0 && safety < 8) {
    safety++;
    let choice: Candidate;
    if (usePlayer && chooser) {
      choice = await chooser(mem, actor, visited);
    } else {
      actionSlot++;
      choice = proposeWithTacticsReview(
        mem,
        actor,
        visited,
        movesThisTurn,
        log,
        actionSlot,
      );
      if (choice.head === "End_turn") break;
      if (choice.score < 0.15 && !choice.head.startsWith("Stride")) break;
    }
    const cont = executeCandidate(mem, actor, choice, rng, log, visited, movesThisTurn);
    if (!cont || choice.head === "End_turn") break;
  }

  mem.events.push({ t: "end_turn", round: mem.round, actor: actorId });
}
