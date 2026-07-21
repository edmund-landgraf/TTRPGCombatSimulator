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
import {
  applyEndOfTurnDecay,
  formatCombatState,
  parseCombatState,
  raiseShield,
} from "../ai/combatStateParser.js";
import {
  formatGrandmasterPlan,
  guidedChoice,
  runGrandmasterLoop,
} from "../ai/grandmasterLoop.js";
import { resolveStride, resolveStep } from "../rules/pf2e/movement.js";
import { formatAttackLine, resolveStrike } from "../rules/pf2e/strike.js";
import { formatSpellLine, formatTerrainLine, resolveSpell } from "../rules/pf2e/spell.js";
import type { SeededRng } from "../rules/pf2e/rng.js";
import { wantDelay, applyDelay } from "../rules/pf2e/delay.js";
import {
  describeVitalStatus,
  isDead,
  recordRecoveryEvent,
  runDyingRecoveryCheck,
} from "../rules/pf2e/dying.js";
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
    if (!target || isDead(target)) return false;
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
    if (!target || (choice.head !== "Heal_ally" && isDead(target))) return false;
    const before = mem.events.length;
    resolveSpell(mem, actor, target, choice.spell, rng, mem.round);
    let any = false;
    for (let i = before; i < mem.events.length; i++) {
      const ev = mem.events[i]!;
      if (ev.t === "terrain") {
        log.push(formatTerrainLine(ev));
        any = true;
      } else if (ev.t === "spell") {
        log.push(formatSpellLine(ev));
        any = true;
      } else if (ev.t === "reject") {
        log.push(`  REJECT ${ev.reason}`);
        return false;
      }
    }
    return any;
  }

  // PF2e allows multiple Strides per turn. Cap Step_away to one so skittish
  // combatants don't burn the turn stepping back and forth.
  if (choice.head === "Step_away" && movesThisTurn.steps >= 1) {
    return false;
  }

  if (choice.head === "Stride_close" || choice.head === "Stride_cover") {
    const before = mem.events.length;
    const ok = resolveStride(mem, actor, choice.to, mem.round, rng);
    for (let i = before; i < mem.events.length; i++) {
      const ev = mem.events[i]!;
      if (ev.t === "hazard") {
        log.push(`  HAZARD ${ev.cell} dmg ${ev.dmg} → hp ${ev.hpAfter}`);
      } else if (ev.t === "move") {
        log.push(`  ${ev.kind} ${ev.from} → ${ev.to}`);
        visited.add(ev.to);
        movesThisTurn.strides++;
      } else if (ev.t === "reject") {
        log.push(`  REJECT ${ev.reason}`);
        return false;
      }
    }
    return ok;
  }

  if (choice.head === "Step_away") {
    const before = mem.events.length;
    const ok = resolveStep(mem, actor, choice.to, mem.round, rng);
    for (let i = before; i < mem.events.length; i++) {
      const ev = mem.events[i]!;
      if (ev.t === "hazard") {
        log.push(`  HAZARD ${ev.cell} dmg ${ev.dmg} → hp ${ev.hpAfter}`);
      } else if (ev.t === "move") {
        log.push(`  ${ev.kind} ${ev.from} → ${ev.to}`);
        visited.add(ev.to);
        movesThisTurn.steps++;
      } else if (ev.t === "reject") log.push(`  REJECT ${ev.reason}`);
    }
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
  const planned =
    mem.activeGrandmasterPlan &&
    guidedChoice(mem, actor, mem.activeGrandmasterPlan, actionSlot, visited);
  let choice = planned ?? pickBest(mem, actor, visited);
  if (planned && planned.head !== "End_turn") {
    const node = mem.activeGrandmasterPlan?.actionBudget.find(
      (a) => a.actionIndex === actionSlot,
    );
    if (node) {
      log.push(`  GM-BUDGET A${actionSlot}: "${node.schemaNode}" → ${planned.head}`);
    }
  }

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
  if (!actor || isDead(actor)) return;

  // PF2e: at the start of your turn while Dying, attempt a recovery check.
  if (actor.hp <= 0 || actor.downed) {
    log.push(`--- ${actor.id} (${actor.name}) ---`);
    const recovery = runDyingRecoveryCheck(actor, rng);
    if (recovery) {
      log.push(recovery.line);
      recordRecoveryEvent(mem, actor, recovery);
    } else {
      const vital = describeVitalStatus(actor);
      log.push(`  (${vital.label} — cannot act)`);
    }
    if (isDead(actor) || actor.hp <= 0 || actor.downed) {
      mem.events.push({ t: "end_turn", round: mem.round, actor: actorId });
      return;
    }
  }

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

  // Real-Time Combat State Parser → feed Grandmaster loop.
  mem.activeCombatState = parseCombatState(mem, actor, { turnActive: true });
  for (const line of formatCombatState(mem.activeCombatState)) log.push(line);

  // AGENT: parse Grandmaster schema and run Steps 1→6; emit 3-action budget.
  const gmPlan = runGrandmasterLoop(mem, actor);
  mem.grandmasterPlans.push(gmPlan);
  mem.activeGrandmasterPlan = gmPlan;
  for (const line of formatGrandmasterPlan(gmPlan)) log.push(line);

  const visited = new Set<string>([cellId(actor.pos)]);
  const movesThisTurn = { strides: 0, steps: 0 };
  let safety = 0;
  let actionSlot = 0;

  try {
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

      // Raise a Shield schema node → arm shield state (AC +2 until EOT decay).
      const budgetNode = mem.activeGrandmasterPlan?.actionBudget.find(
        (a) => a.actionIndex === actionSlot,
      );
      if (budgetNode?.mappedHead === "Raise_Shield") {
        raiseShield(actor, log);
        if (choice.head === "End_turn") break;
      }

      const cont = executeCandidate(mem, actor, choice, rng, log, visited, movesThisTurn);
      // Refresh live state after each committed action (MAP / space / HP).
      mem.activeCombatState = parseCombatState(mem, actor, { turnActive: true });
      if (!cont || choice.head === "End_turn") break;
    }
  } finally {
    applyEndOfTurnDecay(mem, actor, log, rng);
    mem.activeCombatState = parseCombatState(mem, actor, { turnActive: false });
    mem.activeGrandmasterPlan = undefined;
  }

  mem.events.push({ t: "end_turn", round: mem.round, actor: actorId });
}
