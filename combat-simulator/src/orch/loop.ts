import type { EncounterFixture } from "../memory/schemas.js";
import { createMemory, living, snapshotHp, type CombatMemory } from "../memory/combatMemory.js";
import { SeededRng } from "../rules/pf2e/rng.js";
import { rollInitiative } from "../rules/pf2e/initiative.js";
import { forfeitExpiredDelays, returnFromDelay, wantReturnAfter } from "../rules/pf2e/delay.js";
import { runTurn } from "./turn.js";
import { formatRoundEnd, formatRoundSummary, formatStatusRoster } from "./roundOutput.js";
import { applyDirectorNotes } from "./directorInbox.js";
import { renderAscii } from "../map/ascii.js";
import { tickTerrainDurations } from "../map/aoe.js";
import { saveRun, saveTacticsLog, type TacticsLogPaths } from "../runs/save.js";
import type { LlmProvider } from "../llm/types.js";
import { narrateRound } from "../llm/narrate.js";
import type { ActionChooser } from "../play/prompt.js";
import type { CompanionSession } from "../companion/session.js";

export type SimOptions = {
  seed: number;
  notes?: string;
  maxRounds?: number;
  save?: boolean;
  runsDir?: string;
  /** When false, skip writing dual-commander decision trees to logs/tactics. Default true. */
  saveTacticsLogs?: boolean;
  /** When set with an llm provider, append Ollama-friendly prose each round. */
  narrative?: boolean;
  llm?: LlmProvider;
  /** Interactive PC control (enemies still AI). */
  play?: boolean;
  chooser?: ActionChooser;
  /** Live combat context for the companion side-chat panel (read-only). */
  companion?: CompanionSession;
  /** When true with companion, pause after each round until UI advances (Enter). */
  pauseEachRound?: boolean;
  /** When true with companion, pause after each PC/enemy turn until UI advances (Enter). */
  pauseEachTurn?: boolean;
};

export type SimResult = {
  mem: CombatMemory;
  output: string;
  runDir?: string;
  tacticsLogPath?: string;
};

function sideWiped(mem: CombatMemory): string | null {
  if (living(mem, "party").length === 0) return "party defeated";
  if (living(mem, "enemy").length === 0) return "enemies defeated";
  return null;
}

export async function runEncounter(fixture: EncounterFixture, opts: SimOptions): Promise<SimResult> {
  const maxRounds = opts.maxRounds ?? 20;
  const rng = new SeededRng(opts.seed);
  const mem = createMemory(fixture, opts.seed, opts.notes ?? "");
  if (opts.notes) applyDirectorNotes(mem, opts.notes);

  const out: string[] = [];
  out.push(`Loaded: ${mem.name} (${mem.ruleset}) seed=${mem.seed}`);
  if (mem.notes) out.push(`Notes: ${mem.notes}`);
  if (mem.weightDeltas.length) {
    out.push(`Weight deltas: ${JSON.stringify(mem.weightDeltas)}`);
  }
  out.push(
    opts.play
      ? "Agents: you (PCs) + enemy-commander (AI); decision tree logged"
      : "Agents: party-commander + enemy-commander; decision tree logged",
  );
  if (opts.narrative && opts.llm) {
    out.push(`Narrative: on (${opts.llm.id})`);
  }
  if (opts.play) {
    out.push("Play mode: on (you choose PC actions; enemies are AI)");
  }
  if (opts.companion) {
    out.push("Companion: on (side chat has live combat context; cannot change the fight)");
    opts.companion.reset();
  }

  const publish = (extra?: {
    phase?: "active" | "waiting" | "ended" | "deploy";
    endReason?: string;
    winner?: string;
    actionLog?: string;
  }) => {
    if (!opts.companion) return;
    opts.companion.logLines = out.length > 400 ? out.slice(-400) : [...out];
    opts.companion.publishFromMemory(mem, extra);
  };

  rollInitiative(mem, rng);
  const initEv = mem.events.find((e) => e.t === "initiative");
  if (initEv && initEv.t === "initiative") {
    out.push(
      "Initiative: " + initEv.order.map((o) => `${o.id} ${o.total}`).join(", "),
    );
  }

  const tokens = [...mem.combatants.values()].map((c) => ({
    id: c.id,
    tokenChar: c.tokenChar,
    pos: c.pos,
    downed: c.downed,
  }));
  out.push("");
  out.push(renderAscii(mem.grid, tokens, "=== Starting positions ==="));
  out.push("");
  if (opts.play) {
    console.log(out.join("\n"));
  }

  let winner: "party" | "enemy" | "draw" = "draw";
  let endReason = "";

  const pauseUi = !!(opts.companion && (opts.pauseEachRound || opts.pauseEachTurn));

  // Pre-round-1 deploy: rearrange tokens, then Enter starts Round 1.
  if (pauseUi && opts.companion) {
    mem.round = 0;
    publish({ phase: "deploy" });
    out.push("=== Deploy (move tokens, then Start Round 1) ===");
    const adv = await opts.companion.waitForAdvance("deploy", { pauseKind: "deploy" });
    if (adv === "cancelled") {
      endReason = "cancelled";
      winner = "draw";
      mem.events.push({ t: "combat_end", reason: endReason, winner });
      out.push(`=== Combat end: ${endReason} (${winner}) ===`);
      return { mem, output: out.join("\n") };
    }
    // Refresh starting map after deploy moves.
    const deployed = [...mem.combatants.values()].map((c) => ({
      id: c.id,
      tokenChar: c.tokenChar,
      pos: c.pos,
      downed: c.downed,
    }));
    out.push(renderAscii(mem.grid, deployed, "=== Deployed positions ==="));
    out.push("");
  } else {
    publish({ phase: "active" });
  }

  const waitTurnPause = async (): Promise<boolean> => {
    if (!opts.pauseEachTurn || !opts.companion || sideWiped(mem)) return true;
    const adv = await opts.companion.waitForAdvance("waiting", { pauseKind: "turn" });
    if (adv === "cancelled") {
      endReason = "cancelled";
      winner = "draw";
      return false;
    }
    return true;
  };

  for (let round = 1; round <= maxRounds; round++) {
    mem.round = round;
    snapshotHp(mem);
    out.push(`=== Round ${round} start ===`);
    if (opts.play) console.log(`\n=== Round ${round} start ===`);
    const roundLines: string[] = [];
    publish({ phase: "active" });

    // Working queue so Delay returns can insert and act later this round.
    const queue = [...mem.initiative];
    const acted = new Set<string>();
    let qi = 0;

    const pushLines = (turnLines: string[]) => {
      for (const line of turnLines) {
        out.push(line);
        roundLines.push(line);
        if (opts.play) console.log(line);
      }
    };

    while (qi < queue.length) {
      let justActed = queue[qi++]!;
      const c = mem.combatants.get(justActed);
      if (!c || c.downed || acted.has(justActed) || mem.delayed.has(justActed)) continue;
      if (sideWiped(mem)) break;

      const turnLines: string[] = [];
      await runTurn(mem, justActed, rng, turnLines, opts.play ? opts.chooser : undefined);
      pushLines(turnLines);
      // Delay removes the actor without a normal turn — don't mark acted.
      if (!mem.delayed.has(justActed)) acted.add(justActed);
      publish({ phase: "active", actionLog: turnLines.join("\n") });
      if (!(await waitTurnPause())) break;

      // After a turn ends, Delayed creatures may return (PF2e free action).
      let guard = 0;
      while (guard++ < 12 && !sideWiped(mem)) {
        const remaining = queue.length - qi;
        let inserted: string | null = null;
        for (const delayedId of [...mem.delayed.keys()]) {
          if (wantReturnAfter(mem, delayedId, justActed, remaining)) {
            const retLines: string[] = [];
            if (returnFromDelay(mem, delayedId, justActed, retLines)) {
              pushLines(retLines);
              inserted = delayedId;
              break;
            }
          }
        }
        if (!inserted) break;

        const retTurn: string[] = [];
        await runTurn(mem, inserted, rng, retTurn, opts.play ? opts.chooser : undefined);
        pushLines(retTurn);
        if (!mem.delayed.has(inserted)) acted.add(inserted);
        justActed = inserted;
        publish({ phase: "active", actionLog: retTurn.join("\n") });
        if (!(await waitTurnPause())) break;
      }
      if (endReason === "cancelled") break;
    }
    if (endReason === "cancelled") break;

    const forfeitLines: string[] = [];
    forfeitExpiredDelays(mem, forfeitLines);
    pushLines(forfeitLines);

    const terrainExpireLines = tickTerrainDurations(mem);
    if (terrainExpireLines.length) {
      pushLines(terrainExpireLines);
      if (opts.play) {
        for (const line of terrainExpireLines) console.log(line);
      }
    }

    mem.events.push({ t: "round_end", round });
    const roundEnd = formatRoundEnd(mem);
    out.push("");
    out.push(roundEnd);
    out.push("");
    if (opts.play) console.log("\n" + roundEnd + "\n");

    const actionLog = roundLines.join("\n");
    if (opts.companion) {
      opts.companion.recordRound(mem, actionLog);
    }
    publish({ phase: "active", actionLog });

    if (opts.narrative && opts.llm) {
      const mechanical = [
        roundLines.join("\n"),
        formatStatusRoster(mem),
        formatRoundSummary(mem),
      ].join("\n\n");
      try {
        const prose = await narrateRound(opts.llm, round, mechanical);
        out.push(`--- Round ${round} narrative ---`);
        out.push(prose);
        out.push("");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        out.push(`--- Round ${round} narrative (failed) ---`);
        out.push(msg);
        out.push("");
      }
    }

    const wiped = sideWiped(mem);
    if (wiped) {
      endReason = wiped;
      winner = wiped === "party defeated" ? "enemy" : "party";
      break;
    }

    // Pause for UI: Enter advances to the next round (not after the final round).
    if (opts.pauseEachRound && opts.companion && round < maxRounds) {
      const adv = await opts.companion.waitForAdvance("waiting", { pauseKind: "round" });
      if (adv === "cancelled") {
        endReason = "cancelled";
        winner = "draw";
        break;
      }
    }
  }

  if (!endReason) {
    endReason = "round cap";
    winner = "draw";
  }

  mem.events.push({ t: "combat_end", reason: endReason, winner });
  out.push(`=== Combat end: ${endReason} (${winner}) ===`);
  // Clear/reset cancels waitForAdvance and wipes the session — do not republish a
  // zombie ended context (round N + empty rounds[]) over that clear.
  if (endReason !== "cancelled") {
    publish({ phase: "ended", endReason, winner });
  }

  let runDir: string | undefined;
  let tacticsLogPath: string | undefined;
  const wantTactics = opts.saveTacticsLogs !== false;

  // Tactics logs follow the Settings toggle and are independent of --no-save / run saves.
  if (opts.save !== false) {
    const saved = saveRun(mem, out.join("\n"), {
      runsDir: opts.runsDir,
      saveTacticsLogs: wantTactics,
    });
    runDir = saved.runDir;
    out.push(`Saved run: ${runDir}`);
    if (saved.tactics) {
      tacticsLogPath = saved.tactics.md;
      out.push(`Tactics log: ${saved.tactics.md}`);
    }
  } else if (wantTactics) {
    const tactics: TacticsLogPaths = saveTacticsLog(mem);
    tacticsLogPath = tactics.md;
    out.push(`Tactics log: ${tactics.md}`);
  }

  if (endReason !== "cancelled") {
    publish({ phase: "ended", endReason, winner });
  }

  return { mem, output: out.join("\n"), runDir, tacticsLogPath };
}
