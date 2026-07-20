import type { EncounterFixture } from "../memory/schemas.js";
import { createMemory, living, snapshotHp, type CombatMemory } from "../memory/combatMemory.js";
import { SeededRng } from "../rules/pf2e/rng.js";
import { rollInitiative } from "../rules/pf2e/initiative.js";
import { runTurn } from "./turn.js";
import { formatRoundEnd, formatRoundSummary, formatStatusRoster } from "./roundOutput.js";
import { applyDirectorNotes } from "./directorInbox.js";
import { renderAscii } from "../map/ascii.js";
import { saveRun } from "../runs/save.js";
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
};

export type SimResult = {
  mem: CombatMemory;
  output: string;
  runDir?: string;
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
    phase?: "active" | "waiting" | "ended";
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
  publish({ phase: "active" });

  let winner: "party" | "enemy" | "draw" = "draw";
  let endReason = "";

  for (let round = 1; round <= maxRounds; round++) {
    mem.round = round;
    snapshotHp(mem);
    out.push(`=== Round ${round} start ===`);
    if (opts.play) console.log(`\n=== Round ${round} start ===`);
    const roundLines: string[] = [];
    publish({ phase: "active" });

    for (const id of mem.initiative) {
      const c = mem.combatants.get(id);
      if (!c || c.downed) continue;
      if (sideWiped(mem)) break;
      const turnLines: string[] = [];
      await runTurn(mem, id, rng, turnLines, opts.play ? opts.chooser : undefined);
      for (const line of turnLines) {
        out.push(line);
        roundLines.push(line);
        if (opts.play) console.log(line);
      }
      publish({ phase: "active" });
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
      const adv = await opts.companion.waitForAdvance();
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
  publish({ phase: "ended", endReason, winner });

  let runDir: string | undefined;
  if (opts.save !== false) {
    runDir = saveRun(mem, out.join("\n"), opts.runsDir);
    out.push(`Saved run: ${runDir}`);
  }
  publish({ phase: "ended", endReason, winner });

  return { mem, output: out.join("\n"), runDir };
}
