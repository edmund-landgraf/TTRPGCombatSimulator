import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { EncounterFixtureSchema } from "./memory/schemas.js";
import { buildClassicFourCells, classicHazardPlacements } from "./map/buildClassicMap.js";
import { runEncounter } from "./orch/loop.js";
import { OllamaProvider } from "./llm/ollama.js";
import type { LlmProvider } from "./llm/types.js";
import { buildChallenge } from "./encounters/buildChallenge.js";
import type { ThreatLevel } from "./encounters/pf2eBudget.js";
import {
  formatRules,
  formatRulesHelp,
  resolveRulesEntries,
  type RulesMode,
} from "./rules/pf2e/rulesCatalog.js";
import { closeChooser, createStdinChooser } from "./play/prompt.js";
import {
  runChallengeMatrix,
  writeChallengeMatrixArtifacts,
} from "./analysis/challengeMatrix.js";
import { companionSession } from "./companion/session.js";
import { seedClassicStudio } from "./companion/seedClassic.js";
import { startCompanionServer } from "./companion/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]) {
  const opts = {
    encounter: "classic-four-vs-goblins",
    seed: 42,
    notes: "",
    llm: "none",
    narrative: false,
    play: false,
    companion: false,
    ui: false,
    loop: false,
    save: true,
    maxRounds: 20,
    seedCount: 3,
    baseSeed: 201,
    model: "llama3",
    threat: "" as "" | ThreatLevel,
    partySize: 0 as 0 | 3 | 4 | 5,
    partySizes: undefined as number[] | undefined,
    threats: undefined as ThreatLevel[] | undefined,
    rules: undefined as string[] | undefined,
    rulesMode: "brief" as RulesMode,
    port: Number(process.env.COMPANION_PORT ?? 5179),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--encounter") opts.encounter = argv[++i]!;
    else if (a === "--seed") opts.seed = Number(argv[++i]);
    else if (a === "--notes") opts.notes = argv[++i]!;
    else if (a === "--llm") opts.llm = argv[++i]!;
    else if (a === "--narrative") opts.narrative = true;
    else if (a === "--play") opts.play = true;
    else if (a === "--companion") opts.companion = true;
    else if (a === "--loop" || a === "--matrix") opts.loop = true;
    else if (a === "--ui") {
      opts.ui = true;
      opts.companion = true;
    } else if (a === "--port") opts.port = Number(argv[++i]);
    else if (a === "--model") opts.model = argv[++i]!;
    else if (a === "--no-save") opts.save = false;
    else if (a === "--max-rounds") opts.maxRounds = Number(argv[++i]);
    else if (a === "--seed-count") opts.seedCount = Number(argv[++i]);
    else if (a === "--base-seed") opts.baseSeed = Number(argv[++i]);
    else if (a === "--threat") opts.threat = argv[++i] as ThreatLevel;
    else if (a === "--party-size") opts.partySize = Number(argv[++i]) as 3 | 4 | 5;
    else if (a === "--party-sizes") {
      opts.partySizes = argv[++i]!.split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
    } else if (a === "--threats") {
      opts.threats = argv[++i]!.split(",").map((s) => s.trim()).filter(Boolean) as ThreatLevel[];
    }
    else if (a === "--rules-mode") {
      const mode = argv[++i]!;
      if (mode !== "brief" && mode !== "verbose") {
        throw new Error("--rules-mode must be brief or verbose");
      }
      opts.rulesMode = mode;
    } else if (a === "--rules") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        opts.rules = [];
      } else {
        i++;
        opts.rules = next.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
  }
  return opts;
}

async function waitForExit(): Promise<void> {
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

function resolveFixturePath(encounterId: string): string {
  const candidates = [
    path.join(process.cwd(), "examples", `${encounterId}.json`),
    path.join(process.cwd(), "..", "examples", `${encounterId}.json`),
    path.join(__dirname, "..", "..", "examples", `${encounterId}.json`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Fixture not found: ${encounterId}.json (searched ${candidates.join(", ")})`);
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "win32"
      ? `start "" "${url}"`
      : platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {
    /* ignore open failures */
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.loop) {
    const outDir = path.join(process.cwd(), "runs", "challenge-matrix");
    console.error(
      `Loop mode: party ${opts.partySizes?.join("/") ?? "3/4/5"} × ${opts.threats?.join("/") ?? "all threats"} × ${opts.seedCount} seeds…`,
    );
    const report = await runChallengeMatrix({
      maxRounds: opts.maxRounds,
      seedCount: opts.seedCount,
      baseSeed: opts.baseSeed,
      partySizes: opts.partySizes,
      threats: opts.threats,
      onProgress: (p) => {
        if (p.completed === 0 || p.completed === p.total || p.completed % 3 === 0) {
          console.error(`[${p.completed}/${p.total}] ${p.message}`);
        }
      },
    });
    const { jsonPath, htmlPath } = writeChallengeMatrixArtifacts(report, outDir);
    console.error(`Band OK: ${report.summary.cellsOk}/${report.summary.cellsTotal}`);
    console.error(`JSON: ${jsonPath}`);
    console.error(`HTML report: ${htmlPath}`);
    openBrowser(`file://${htmlPath.replace(/\\/g, "/")}`);
    return;
  }

  if (opts.rules !== undefined) {
    if (opts.rules.length === 1 && opts.rules[0]!.toLowerCase() === "help") {
      console.log(formatRulesHelp());
      return;
    }
    const entries = resolveRulesEntries(opts.rules);
    console.log(formatRules(entries, opts.rulesMode));
    return;
  }

  let llm: LlmProvider | undefined;
  if (opts.narrative) {
    const ollama = new OllamaProvider({ model: opts.model });
    const ok = await ollama.healthCheck();
    if (!ok) {
      console.error(
        `Ollama not reachable at ${process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434"}. ` +
          `Start ollama and pull ${opts.model}, or omit --narrative.`,
      );
      process.exit(1);
    }
    llm = ollama;
    opts.llm = "ollama";
  } else if (opts.llm !== "none") {
    console.error(`Without --narrative, only --llm none is used (got ${opts.llm}).`);
  }

  const runsDir = path.join(process.cwd(), "runs");

  // Studio UI: seed classic fight, keep side chat → Ollama with live combat context.
  if (opts.ui) {
    const ollama = new OllamaProvider({ model: opts.model });
    const ollamaOk = await ollama.healthCheck();
    if (!ollamaOk) {
      console.error(
        `Warning: Ollama not reachable at ${process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434"}. ` +
          `Side chat needs ollama + model ${opts.model}.`,
      );
    } else {
      console.error(`Ollama ok — side chat model: ${ollama.modelName}`);
    }

    seedClassicStudio(12);
    const companionServer = await startCompanionServer({
      port: opts.port,
      model: opts.model,
      runHooks: {
        seed: opts.seed,
        maxRounds: opts.maxRounds,
        narrative: opts.narrative,
        save: opts.save,
        runsDir,
      },
    });
    console.error(`Combat Studio: ${companionServer.url}`);
    console.error("Side chat → Ollama with auto-loaded combat context.");
    console.error("Combat tab: each round pauses — press Enter (or Next round) to continue.");
    openBrowser(companionServer.url);

    // Same paused path as Setup → Run combat (do not blast through rounds).
    const runUrl = new URL("/api/studio/run", companionServer.url).href;
    void fetch(runUrl, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `auto-run HTTP ${res.status}`);
        }
        console.error("\n[auto-run queued — pausing after each round for Enter]\n");
      })
      .catch((err) => {
        console.error(`Auto-run failed: ${err instanceof Error ? err.message : err}`);
      });

    await waitForExit();
    await companionServer.close();
    return;
  }

  let fixture;
  if (opts.threat) {
    const valid: ThreatLevel[] = ["trivial", "moderate", "hard", "extreme"];
    if (!valid.includes(opts.threat)) {
      console.error(`--threat must be one of ${valid.join(", ")}`);
      process.exit(1);
    }
    const partySize = (opts.partySize || 4) as 3 | 4 | 5;
    if (![3, 4, 5].includes(partySize)) {
      console.error("--party-size must be 3, 4, or 5");
      process.exit(1);
    }
    const built = buildChallenge({ partySize, threat: opts.threat, partyLevel: 1 });
    fixture = built.fixture;
    console.error(
      `Challenge: ${fixture.name} (budget ${built.budgetXp} XP, actual ${built.actualXp} XP)`,
    );
  } else {
    const fixturePath = resolveFixturePath(opts.encounter);
    const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    if (!raw.cells || raw.cells.length === 0) {
      raw.cells = buildClassicFourCells(raw.width ?? 12, raw.height ?? 10);
    }
    if (!raw.hazards || raw.hazards.length === 0) {
      raw.hazards = classicHazardPlacements();
    }
    fixture = EncounterFixtureSchema.parse(raw);
  }

  let companionServer: Awaited<ReturnType<typeof startCompanionServer>> | undefined;
  if (opts.companion) {
    companionServer = await startCompanionServer({
      port: opts.port,
      model: opts.model,
      runHooks: {
        seed: opts.seed,
        maxRounds: opts.maxRounds,
        narrative: opts.narrative,
        save: opts.save,
        runsDir,
      },
    });
    console.error(`Companion UI: ${companionServer.url}`);
    console.error("Setup tab: import PCs/enemies (JSON) and map (image). Chat is read-only.");
    openBrowser(companionServer.url);
  }

  const chooser = opts.play ? createStdinChooser() : undefined;
  try {
    const result = await runEncounter(fixture, {
      seed: opts.seed,
      notes: opts.notes,
      save: opts.save,
      maxRounds: opts.maxRounds,
      runsDir,
      narrative: opts.narrative,
      llm,
      play: opts.play,
      chooser,
      companion: opts.companion ? companionSession : undefined,
    });

    if (!opts.play) {
      console.log(result.output);
    } else if (result.runDir) {
      console.log(`\nSaved run: ${result.runDir}`);
    }

    if (opts.companion && companionServer) {
      console.error(
        `\nCombat finished. UI still open at ${companionServer.url} — import/run again or Ctrl+C to exit.`,
      );
      await waitForExit();
      await companionServer.close();
    }
  } finally {
    if (chooser) closeChooser(chooser);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
