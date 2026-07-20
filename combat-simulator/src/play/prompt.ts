import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Candidate } from "../ai/scorer.js";
import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import { cellId } from "../memory/schemas.js";
import { buildPlayerChoices, type PlayerChoice } from "./choices.js";

export type ActionChooser = (
  mem: CombatMemory,
  actor: CombatantState,
  visited: Set<string>,
) => Promise<Candidate>;

function formatMenu(actor: CombatantState, choices: PlayerChoice[]): string {
  const lines = [
    "",
    `══ ${actor.name} (${actor.id}) — actions left: ${actor.actionsLeft}  MAP: ${actor.map}  @ ${cellId(actor.pos)} ══`,
    "Choose an action (only valid options shown):",
  ];
  for (const c of choices) {
    lines.push(`  [${c.key}] ${c.label}`);
    lines.push(`       ${c.tip}`);
  }
  lines.push("  [? ] show again   [Q] quit combat");
  return lines.join("\n");
}

/** Interactive stdin chooser for --play mode. */
export function createStdinChooser(): ActionChooser {
  const rl = readline.createInterface({ input, output });

  const chooser: ActionChooser = async (mem, actor, visited) => {
    for (;;) {
      const choices = buildPlayerChoices(mem, actor, visited);
      output.write(formatMenu(actor, choices) + "\n");
      const answer = (await rl.question("Your choice: ")).trim().toUpperCase();
      if (answer === "Q") {
        throw new Error("Player quit");
      }
      if (answer === "?" || answer === "H" || answer === "HELP") {
        continue;
      }
      const hit = choices.find((c) => c.key === answer);
      if (!hit) {
        output.write(`Invalid choice "${answer}". Enter one of: ${choices.map((c) => c.key).join(", ")}\n`);
        continue;
      }
      return hit.candidate;
    }
  };

  // Attach closer for CLI shutdown
  (chooser as ActionChooser & { close: () => void }).close = () => rl.close();
  return chooser;
}

export function closeChooser(chooser: ActionChooser): void {
  const c = chooser as ActionChooser & { close?: () => void };
  c.close?.();
}
