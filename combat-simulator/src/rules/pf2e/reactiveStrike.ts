import type { CombatantState, CombatMemory } from "../../memory/combatMemory.js";
import { cellId, type Position } from "../../memory/schemas.js";
import type { SeededRng } from "./rng.js";
import {
  bestMeleeWeapon,
  canThreatenReactiveStrike,
  reactiveStrikersOnLeave,
} from "./threaten.js";
import { formatAttackLine, resolveStrike } from "./strike.js";

export type ReactiveStrikeOptions = {
  /** When set, append human-readable log lines (turn transcript). */
  log?: string[];
};

/**
 * PF2e Reactive Strike (legacy Attack of Opportunity):
 * when a foe uses a move action and leaves a square you threaten — Step does NOT trigger.
 * Each reactor spends one reaction (once per round); uses the held melee weapon.
 */
export function resolveReactiveStrikesOnMove(
  mem: CombatMemory,
  mover: CombatantState,
  path: Position[],
  moveKind: "Stride" | "Step",
  round: number,
  rng: SeededRng,
  opts?: ReactiveStrikeOptions,
): void {
  if (moveKind === "Step" || path.length < 2) return;

  const savedPos = { ...mover.pos };
  try {
    for (let i = 0; i < path.length - 1; i++) {
      const leftCell = path[i]!;
      mover.pos = leftCell;
      const strikers = reactiveStrikersOnLeave(mem, mover, leftCell);
      for (const reactor of strikers) {
        if (!canThreatenReactiveStrike(mem, reactor, mover, leftCell)) continue;
        const weapon = bestMeleeWeapon(reactor);
        if (!weapon) continue;

        const before = mem.events.length;
        resolveStrike(mem, reactor, mover, weapon, rng, round, {
          reaction: true,
          skipActionCost: true,
        });
        reactor.reactionAvailable = false;

        for (let e = before; e < mem.events.length; e++) {
          const ev = mem.events[e]!;
          if (ev.t === "attack") {
            opts?.log?.push(
              `  Reactive Strike (${reactor.id}): left ${cellId(leftCell)} → ${formatAttackLine(ev).trim()}`,
            );
          } else if (ev.t === "reject") {
            opts?.log?.push(`  Reactive Strike (${reactor.id}): ${ev.reason}`);
          }
        }
      }
    }
  } finally {
    mover.pos = savedPos;
  }
}
