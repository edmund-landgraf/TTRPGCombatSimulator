import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import { cellId } from "../memory/schemas.js";
import type { Candidate } from "./scorer.js";
import { candidateKey } from "./scorer.js";

export type CommanderId = "party-commander" | "enemy-commander";

export type DecisionReject = {
  attempt: number;
  key: string;
  head: string;
  score: number;
  skill: string;
  reason: string;
};

export type RankedCandidate = {
  rank: number;
  key: string;
  head: string;
  score: number;
  detail: string;
};

export type DecisionNode = {
  agent: CommanderId;
  round: number;
  actorId: string;
  actorName: string;
  side: "party" | "enemy";
  actionSlot: number;
  actionsLeft: number;
  ranked: RankedCandidate[];
  rejects: DecisionReject[];
  chosen: RankedCandidate | null;
  outcome: "accepted" | "end_turn" | "low_score";
};

export function commanderFor(side: "party" | "enemy"): CommanderId {
  return side === "party" ? "party-commander" : "enemy-commander";
}

export function describeCandidate(c: Candidate): string {
  if (c.head === "End_turn") return "End turn";
  if (c.head === "Strike_melee" || c.head === "Strike_ranged") {
    return `${c.head} → ${c.targetId} (${c.weapon.id})`;
  }
  if (c.head === "Cast_cantrip" || c.head === "Cast_spell" || c.head === "Heal_ally") {
    return `${c.head} → ${c.targetId} (${c.spell.name})`;
  }
  if (c.head === "Stride_close" || c.head === "Stride_cover" || c.head === "Step_away") {
    return `${c.head} → ${cellId(c.to)}`;
  }
  return c.head;
}

export function toRanked(c: Candidate, rank: number): RankedCandidate {
  return {
    rank,
    key: candidateKey(c),
    head: c.head,
    score: Number(c.score.toFixed(3)),
    detail: describeCandidate(c),
  };
}

export function formatDecisionTreeMarkdown(nodes: DecisionNode[]): string {
  const lines: string[] = [
    "# Decision tree — dual commanders",
    "",
    "Agents:",
    "- **party-commander** — chooses actions for all PCs",
    "- **enemy-commander** — chooses actions for all enemies",
    "",
    "Each action slot lists ranked candidates (scorer), tactics vetoes, then the chosen branch.",
    "",
  ];

  let currentAgent = "";
  let currentActor = "";

  for (const n of nodes) {
    if (n.agent !== currentAgent) {
      currentAgent = n.agent;
      lines.push(`## Agent: ${n.agent}`);
      lines.push("");
    }
    if (n.actorId !== currentActor) {
      currentActor = n.actorId;
      lines.push(`### Round ${n.round} — ${n.actorId} (${n.actorName}) [${n.side}]`);
      lines.push("");
    }

    lines.push(`#### Action slot ${n.actionSlot} (actionsLeft=${n.actionsLeft})`);
    lines.push("");
    lines.push("```");
    lines.push("candidates (score ↓)");
    for (const r of n.ranked.slice(0, 12)) {
      const mark = n.chosen && r.key === n.chosen.key ? " ← CHOSEN" : "";
      lines.push(`  ${String(r.rank).padStart(2)}. [${r.score.toFixed(3)}] ${r.detail}${mark}`);
    }
    if (n.ranked.length > 12) {
      lines.push(`  … +${n.ranked.length - 12} more`);
    }
    if (n.rejects.length) {
      lines.push("tactics vetoes");
      for (const rej of n.rejects) {
        lines.push(
          `  ✗ attempt ${rej.attempt}: ${rej.head} (${rej.score.toFixed(3)}) — [${rej.skill}] ${rej.reason}`,
        );
      }
    }
    lines.push(`outcome: ${n.outcome}${n.chosen ? ` → ${n.chosen.detail}` : ""}`);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

/** Append a decision node onto combat memory. */
export function recordDecision(mem: CombatMemory, node: DecisionNode): void {
  mem.decisionLog.push(node);
}

export function beginActorTurn(actor: CombatantState): {
  agent: CommanderId;
  actionSlot: number;
} {
  return { agent: commanderFor(actor.side), actionSlot: 0 };
}
