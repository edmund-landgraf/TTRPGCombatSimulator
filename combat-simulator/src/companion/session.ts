import type { CombatMemory } from "../memory/combatMemory.js";
import { cellId } from "../memory/schemas.js";
import {
  formatAsciiBoard,
  formatRoundSummary,
  formatStatusRoster,
} from "../orch/roundOutput.js";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  at: string;
};

export type CombatantSnapshot = {
  id: string;
  name: string;
  side: "party" | "enemy";
  hp: number;
  maxHp: number;
  ac: number;
  pos: string;
  downed: boolean;
  conditions: string[];
  weapons: string[];
  spells: string[];
  /** Ranked spell remaining uses, e.g. "heal 1/2". */
  spellUsesLeft: string[];
};

export type RoundSnapshot = {
  round: number;
  statusText: string;
  mapText: string;
  summaryText: string;
  actionLog: string;
};

export type CombatContext = {
  updatedAt: string;
  encounterName: string;
  encounterId: string;
  seed: number;
  round: number;
  phase: "active" | "waiting" | "ended";
  endReason?: string;
  winner?: string;
  initiative: string[];
  statusText: string;
  mapText: string;
  recentLog: string;
  summaryText?: string;
  combatants: CombatantSnapshot[];
  /** True when the sim is paused after a round; UI should show Enter to continue. */
  waitingForAdvance: boolean;
  rounds: RoundSnapshot[];
};

/** Live session shared by the sim loop and the companion HTTP server. */
export class CompanionSession {
  context: CombatContext | null = null;
  chat: ChatMessage[] = [];
  logLines: string[] = [];
  rounds: RoundSnapshot[] = [];
  waitingForAdvance = false;

  private advanceWaiters: Array<{
    resolve: (result: "advanced" | "cancelled") => void;
  }> = [];

  reset(): void {
    this.context = null;
    this.chat = [];
    this.logLines = [];
    this.rounds = [];
    this.waitingForAdvance = false;
    this.cancelWaiters();
  }

  /** Clear live combat display so the next Run starts clean; keeps side chat. */
  clearCombatForNewRun(): void {
    this.context = null;
    this.logLines = [];
    this.rounds = [];
    this.waitingForAdvance = false;
    this.cancelWaiters();
  }

  private resolveWaiters(result: "advanced" | "cancelled"): void {
    const waiters = this.advanceWaiters;
    this.advanceWaiters = [];
    for (const w of waiters) w.resolve(result);
  }

  private cancelWaiters(): void {
    this.resolveWaiters("cancelled");
  }

  /** Called by the UI (Enter / button) to continue to the next round. */
  advance(): boolean {
    if (!this.waitingForAdvance) return false;
    this.waitingForAdvance = false;
    this.resolveWaiters("advanced");
    if (this.context) {
      this.context = {
        ...this.context,
        waitingForAdvance: false,
        phase: this.context.phase === "ended" ? "ended" : "active",
        updatedAt: new Date().toISOString(),
      };
    }
    return true;
  }

  /**
   * Block the sim until the UI advances.
   * Resolves `"cancelled"` if combat is cleared/reset — callers must stop the encounter.
   */
  waitForAdvance(): Promise<"advanced" | "cancelled"> {
    this.waitingForAdvance = true;
    if (this.context) {
      this.context = {
        ...this.context,
        waitingForAdvance: true,
        phase: "waiting",
        updatedAt: new Date().toISOString(),
      };
    }
    return new Promise((resolve) => {
      this.advanceWaiters.push({ resolve });
    });
  }

  appendLog(lines: string[]): void {
    this.logLines.push(...lines);
    if (this.logLines.length > 400) {
      this.logLines = this.logLines.slice(-400);
    }
  }

  recordRound(mem: CombatMemory, actionLog: string): RoundSnapshot {
    const snap: RoundSnapshot = {
      round: mem.round,
      statusText: formatStatusRoster(mem),
      mapText: formatAsciiBoard(mem),
      summaryText: formatRoundSummary(mem),
      actionLog,
    };
    this.rounds.push(snap);
    return snap;
  }

  publishFromMemory(
    mem: CombatMemory,
    opts?: {
      phase?: "active" | "waiting" | "ended";
      endReason?: string;
      winner?: string;
      actionLog?: string;
    },
  ): void {
    const combatants: CombatantSnapshot[] = [...mem.combatants.values()].map((c) => ({
      id: c.id,
      name: c.name,
      side: c.side,
      hp: c.hp,
      maxHp: c.maxHp,
      ac: c.ac,
      pos: cellId(c.pos),
      downed: c.downed,
      conditions: c.conditions.map((x) => x.name),
      weapons: c.weapons.map((w) => w.id),
      spells: c.spells.map((s) => s.name),
      spellUsesLeft: c.spells
        .filter((s) => s.rank > 0 && s.usesPerCombat != null)
        .map((s) => {
          const used = c.spellUses.get(s.id) ?? 0;
          const left = Math.max(0, (s.usesPerCombat ?? 0) - used);
          return `${s.name} ${left}/${s.usesPerCombat}`;
        }),
    }));

    const latest = this.rounds[this.rounds.length - 1];
    this.context = {
      updatedAt: new Date().toISOString(),
      encounterName: mem.name,
      encounterId: mem.encounterId,
      seed: mem.seed,
      round: mem.round,
      phase: opts?.phase ?? (this.waitingForAdvance ? "waiting" : "active"),
      endReason: opts?.endReason,
      winner: opts?.winner,
      initiative: [...mem.initiative],
      statusText: latest?.statusText ?? formatStatusRoster(mem),
      mapText: latest?.mapText ?? formatAsciiBoard(mem),
      summaryText: latest?.summaryText ?? formatRoundSummary(mem),
      recentLog: opts?.actionLog ?? latest?.actionLog ?? this.logLines.slice(-80).join("\n"),
      combatants,
      waitingForAdvance: this.waitingForAdvance,
      rounds: [...this.rounds],
    };
  }

  addChat(role: "user" | "assistant", content: string): void {
    this.chat.push({ role, content, at: new Date().toISOString() });
    if (this.chat.length > 80) this.chat = this.chat.slice(-80);
  }
}

export const companionSession = new CompanionSession();

/** Human-readable combat state for the side-chat model (pause vs ended vs resolving). */
export function describeCombatState(
  ctx: CombatContext,
  opts?: { runInFlight?: boolean },
): string {
  if (ctx.phase === "ended" || ctx.endReason) {
    return [
      "COMBAT STATE: ENDED",
      `Outcome: ${ctx.endReason ?? "done"} (${ctx.winner ?? "—"})`,
      `Last round completed: ${ctx.round}`,
      "The fight is over. Discuss what already happened; do not plan the next round as if combat continues.",
    ].join("\n");
  }
  if (ctx.waitingForAdvance || ctx.phase === "waiting") {
    return [
      "COMBAT STATE: PAUSED BETWEEN ROUNDS",
      `Round ${ctx.round} has fully finished. The sim is waiting for the GM/user to press Enter before Round ${ctx.round + 1}.`,
      "Side chat during this pause is the normal time to ask tactics. Treat actions in the Round log below as already spent for this round (e.g. if the cleric cast Heal, that use is gone).",
      "Do not invent actions for the next round unless asked hypothetically.",
    ].join("\n");
  }
  if (opts?.runInFlight || ctx.phase === "active") {
    return [
      "COMBAT STATE: ROUND RESOLVING",
      `A round is currently being simulated (around round ${ctx.round}).`,
      "Prefer answering from completed rounds already in the log. Say if a detail may still be in flux until the next pause.",
    ].join("\n");
  }
  return `COMBAT STATE: UNKNOWN (round ${ctx.round})`;
}

/** Compact text block injected into the side-chat system prompt. */
export function formatContextForLlm(
  ctx: CombatContext,
  opts?: { runInFlight?: boolean },
): string {
  const latest = ctx.rounds[ctx.rounds.length - 1];
  const state = describeCombatState(ctx, opts);
  return [
    state,
    "",
    `Encounter: ${ctx.encounterName} (${ctx.encounterId}) seed=${ctx.seed}`,
    `Phase flag: ${ctx.phase}` +
      (ctx.waitingForAdvance ? " · waitingForAdvance=true" : "") +
      (ctx.endReason ? ` — ${ctx.endReason} (${ctx.winner})` : ""),
    `Round: ${ctx.round} · completed round snapshots: ${ctx.rounds.length}`,
    `Initiative: ${ctx.initiative.join(", ")}`,
    "",
    "=== Status (end of last completed round) ===",
    ctx.statusText || "(none)",
    "",
    "=== Map ===",
    ctx.mapText || "(none)",
    "",
    latest
      ? [
          `=== Round ${latest.round} actions (already resolved) ===`,
          latest.actionLog || "(no actions)",
          "",
          `=== Round ${latest.round} summary ===`,
          latest.summaryText || "(none)",
        ].join("\n")
      : ["=== Recent combat log ===", ctx.recentLog || "(no actions yet)"].join("\n"),
    "",
    "=== Combatants ===",
    ...ctx.combatants.map((c) => {
      const uses =
        c.spellUsesLeft?.length ? ` rankedUses=${c.spellUsesLeft.join("; ")}` : "";
      return (
        `- ${c.id} ${c.name} [${c.side}] hp ${c.hp}/${c.maxHp}${c.downed ? " downed" : ""} AC ${c.ac} @ ${c.pos}` +
        (c.conditions.length ? ` cond=${c.conditions.join(",")}` : "") +
        ` weapons=${c.weapons.join("/") || "—"} spells=${c.spells.join("/") || "—"}` +
        uses
      );
    }),
  ].join("\n");
}
