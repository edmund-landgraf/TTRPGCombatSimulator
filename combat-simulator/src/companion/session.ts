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

export type BoardCell = {
  x: number;
  y: number;
  tags: string[];
};

export type BoardToken = {
  id: string;
  name: string;
  side: "party" | "enemy";
  tokenChar: string;
  x: number;
  y: number;
  downed: boolean;
};

export type BoardSnapshot = {
  width: number;
  height: number;
  cells: BoardCell[];
  tokens: BoardToken[];
};

export type CombatantSnapshot = {
  id: string;
  name: string;
  side: "party" | "enemy";
  hp: number;
  maxHp: number;
  ac: number;
  pos: string;
  x: number;
  y: number;
  tokenChar: string;
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
  board: BoardSnapshot;
  summaryText: string;
  actionLog: string;
};

export type CombatContext = {
  updatedAt: string;
  encounterName: string;
  encounterId: string;
  seed: number;
  round: number;
  phase: "active" | "waiting" | "ended" | "deploy";
  endReason?: string;
  winner?: string;
  initiative: string[];
  statusText: string;
  mapText: string;
  board: BoardSnapshot;
  recentLog: string;
  summaryText?: string;
  combatants: CombatantSnapshot[];
  /** True when the sim is paused (deploy, between rounds, or between turns); UI shows Enter to continue. */
  waitingForAdvance: boolean;
  /** Why the sim is paused — drives Next turn vs Next round button copy. */
  pauseKind?: "deploy" | "round" | "turn";
  /** Token drag allowed during deploy and between-round/turn pauses. */
  canMoveTokens?: boolean;
  rounds: RoundSnapshot[];
};

/** Reconstruct full grid (including walls) for the companion UI. */
export function buildBoard(mem: CombatMemory): BoardSnapshot {
  const { width, height, walkable } = mem.grid;
  const cells: BoardCell[] = [];
  for (let y = 1; y <= height; y++) {
    for (let x = 1; x <= width; x++) {
      const w = walkable.get(cellId({ x, y }));
      cells.push({
        x,
        y,
        tags: w ? [...w.tags] : ["blocking"],
      });
    }
  }
  const tokens: BoardToken[] = [...mem.combatants.values()].map((c) => ({
    id: c.id,
    name: c.name,
    side: c.side,
    tokenChar: c.tokenChar,
    x: c.pos.x,
    y: c.pos.y,
    downed: c.downed,
  }));
  return { width, height, cells, tokens };
}

export function emptyBoard(): BoardSnapshot {
  return { width: 0, height: 0, cells: [], tokens: [] };
}

/** Live session shared by the sim loop and the companion HTTP server. */
export class CompanionSession {
  context: CombatContext | null = null;
  chat: ChatMessage[] = [];
  logLines: string[] = [];
  rounds: RoundSnapshot[] = [];
  waitingForAdvance = false;
  /** Active memory while a run is in flight (for deploy-time token moves). */
  liveMemory: CombatMemory | null = null;

  private advanceWaiters: Array<{
    resolve: (result: "advanced" | "cancelled") => void;
  }> = [];

  reset(): void {
    this.context = null;
    this.chat = [];
    this.logLines = [];
    this.rounds = [];
    this.waitingForAdvance = false;
    this.liveMemory = null;
    this.cancelWaiters();
  }

  /** Clear live combat display so the next Run starts clean; keeps side chat. */
  clearCombatForNewRun(): void {
    this.context = null;
    this.logLines = [];
    this.rounds = [];
    this.waitingForAdvance = false;
    this.liveMemory = null;
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

  /** Called by the UI (Enter / button) to continue deploy → R1, next turn, or next round. */
  advance(): boolean {
    if (!this.waitingForAdvance) return false;
    this.waitingForAdvance = false;
    this.resolveWaiters("advanced");
    if (this.context) {
      this.context = {
        ...this.context,
        waitingForAdvance: false,
        pauseKind: undefined,
        canMoveTokens: false,
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
  waitForAdvance(
    phase: "waiting" | "deploy" = "waiting",
    opts?: { pauseKind?: "deploy" | "round" | "turn" },
  ): Promise<"advanced" | "cancelled"> {
    this.waitingForAdvance = true;
    const pauseKind = opts?.pauseKind ?? (phase === "deploy" ? "deploy" : "round");
    if (this.context) {
      const mem = this.liveMemory;
      this.context = {
        ...this.context,
        waitingForAdvance: true,
        pauseKind,
        phase,
        canMoveTokens: true,
        // Show live positions / HP while paused (especially between turns).
        board: mem ? buildBoard(mem) : this.context.board,
        mapText: mem ? formatAsciiBoard(mem) : this.context.mapText,
        statusText:
          phase === "deploy"
            ? "--- Deploy — drag tokens, then Start Round 1 ---"
            : mem
              ? formatStatusRoster(mem)
              : this.context.statusText,
        updatedAt: new Date().toISOString(),
      };
    }
    return new Promise((resolve) => {
      this.advanceWaiters.push({ resolve });
    });
  }

  /** Free placement while paused (deploy, between rounds, or between turns). Walkable + unoccupied only. */
  moveLiveToken(id: string, x: number, y: number): void {
    const phase = this.context?.phase;
    if (
      !this.context?.canMoveTokens ||
      (phase !== "deploy" && phase !== "waiting")
    ) {
      throw new Error("Tokens can only be moved during deploy or while combat is paused");
    }
    const mem = this.liveMemory;
    if (!mem) throw new Error("No live combat to move tokens in");
    const actor = mem.combatants.get(id);
    if (!actor) throw new Error(`Unknown combatant ${id}`);
    if (actor.downed) throw new Error(`${id} is downed`);
    const key = cellId({ x, y });
    if (!mem.grid.walkable.has(key)) throw new Error(`Cell ${key} is not walkable`);
    for (const c of mem.combatants.values()) {
      if (c.id !== id && !c.downed && cellId(c.pos) === key) {
        throw new Error(`Cell ${key} is occupied`);
      }
    }
    actor.pos = { x, y };
    const pauseKind = this.context.pauseKind;
    this.publishFromMemory(mem, { phase, pauseKind });
    if (this.context) {
      this.context = {
        ...this.context,
        waitingForAdvance: true,
        pauseKind,
        phase,
        canMoveTokens: true,
        board: buildBoard(mem),
        mapText: formatAsciiBoard(mem),
      };
    }
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
      board: buildBoard(mem),
      summaryText: formatRoundSummary(mem),
      actionLog,
    };
    this.rounds.push(snap);
    return snap;
  }

  publishFromMemory(
    mem: CombatMemory,
    opts?: {
      phase?: "active" | "waiting" | "ended" | "deploy";
      endReason?: string;
      winner?: string;
      actionLog?: string;
      pauseKind?: "deploy" | "round" | "turn";
    },
  ): void {
    this.liveMemory = mem;
    const combatants: CombatantSnapshot[] = [...mem.combatants.values()].map((c) => ({
      id: c.id,
      name: c.name,
      side: c.side,
      hp: c.hp,
      maxHp: c.maxHp,
      ac: c.ac,
      pos: cellId(c.pos),
      x: c.pos.x,
      y: c.pos.y,
      tokenChar: c.tokenChar,
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

    const phase =
      opts?.phase ??
      (this.waitingForAdvance ? "waiting" : "active");
    const latest = this.rounds[this.rounds.length - 1];
    const canMoveTokens = phase === "deploy" || phase === "waiting";
    // Sticky theater map always tracks live positions (turn pauses + mid-round resolves).
    // Per-round cards keep their own snapshots via recordRound.
    const board = buildBoard(mem);
    const mapText = formatAsciiBoard(mem);
    const liveStatus = formatStatusRoster(mem);
    const liveSummary = formatRoundSummary(mem);
    const pauseKind =
      opts?.pauseKind ??
      (this.waitingForAdvance
        ? (this.context?.pauseKind ?? (phase === "deploy" ? "deploy" : "round"))
        : undefined);
    this.context = {
      updatedAt: new Date().toISOString(),
      encounterName: mem.name,
      encounterId: mem.encounterId,
      seed: mem.seed,
      round: mem.round,
      phase,
      endReason: opts?.endReason,
      winner: opts?.winner,
      initiative: [...mem.initiative],
      statusText:
        phase === "deploy"
          ? "--- Deploy — drag tokens, then Start Round 1 ---"
          : canMoveTokens || phase === "active"
            ? liveStatus
            : latest?.statusText ?? liveStatus,
      mapText,
      board,
      summaryText:
        phase === "deploy"
          ? "Party south / enemies north by default. Drag tokens to adjust before Round 1."
          : canMoveTokens || phase === "active"
            ? liveSummary
            : latest?.summaryText ?? liveSummary,
      recentLog: opts?.actionLog ?? latest?.actionLog ?? this.logLines.slice(-80).join("\n"),
      combatants,
      waitingForAdvance: this.waitingForAdvance,
      pauseKind: this.waitingForAdvance ? pauseKind : undefined,
      canMoveTokens,
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
  if (ctx.phase === "deploy") {
    return [
      "COMBAT STATE: DEPLOY (BEFORE ROUND 1)",
      "Initiative is rolled; tokens can still be moved. Combat has not started.",
      "User may drag tokens, then press Enter / Start Round 1.",
    ].join("\n");
  }
  if (ctx.waitingForAdvance || ctx.phase === "waiting") {
    if (ctx.pauseKind === "turn") {
      return [
        "COMBAT STATE: PAUSED BETWEEN TURNS",
        `Round ${ctx.round} is in progress. One combatant's turn just finished; the sim waits for Enter before the next initiative turn.`,
        "Map and status below are live (after the turn that just resolved).",
        "Tokens may be dragged on the battle map during this pause (free placement on walkable cells).",
        "Do not invent the next turn's actions unless asked hypothetically.",
      ].join("\n");
    }
    return [
      "COMBAT STATE: PAUSED BETWEEN ROUNDS",
      `Round ${ctx.round} has fully finished. The sim is waiting for the GM/user to press Enter before Round ${ctx.round + 1}.`,
      "Tokens may be dragged on the battle map during this pause (free placement on walkable cells).",
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
