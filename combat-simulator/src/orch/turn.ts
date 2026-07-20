import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import type { Candidate } from "../ai/scorer.js";
import { pickBest } from "../ai/scorer.js";
import { cellId } from "../memory/schemas.js";
import { resolveStride, resolveStep } from "../rules/pf2e/movement.js";
import { formatAttackLine, resolveStrike } from "../rules/pf2e/strike.js";
import { formatSpellLine, resolveSpell } from "../rules/pf2e/spell.js";
import type { SeededRng } from "../rules/pf2e/rng.js";
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
  movesThisTurn: { n: number },
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

  if (movesThisTurn.n >= 1 && (choice.head === "Step_away" || choice.head.startsWith("Stride"))) {
    return false;
  }

  if (choice.head === "Stride_close" || choice.head === "Stride_cover") {
    const ok = resolveStride(mem, actor, choice.to, mem.round);
    const ev = mem.events[mem.events.length - 1];
    if (ev?.t === "move") {
      log.push(`  ${ev.kind} ${ev.from} → ${ev.to}`);
      visited.add(ev.to);
      movesThisTurn.n++;
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
      movesThisTurn.n++;
    } else if (ev?.t === "reject") log.push(`  REJECT ${ev.reason}`);
    return ok;
  }

  return false;
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

  startTurn(mem, actorId);
  log.push(`--- ${actor.id} (${actor.name}) ---`);

  const visited = new Set<string>([cellId(actor.pos)]);
  const movesThisTurn = { n: 0 };
  let safety = 0;
  const usePlayer = !!chooser && actor.side === "party";

  while (actor.actionsLeft > 0 && safety < 8) {
    safety++;
    let choice: Candidate;
    if (usePlayer && chooser) {
      choice = await chooser(mem, actor, visited);
    } else {
      choice = pickBest(mem, actor, visited);
      if (choice.head === "End_turn" || choice.score < 0.15) break;
    }
    const cont = executeCandidate(mem, actor, choice, rng, log, visited, movesThisTurn);
    if (!cont || choice.head === "End_turn") break;
  }

  mem.events.push({ t: "end_turn", round: mem.round, actor: actorId });
}
