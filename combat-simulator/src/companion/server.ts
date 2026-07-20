import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureLoopBriefing,
  renderChallengeMatrixHtml,
  runChallengeMatrix,
  writeChallengeMatrixArtifacts,
  type ChallengeMatrixReport,
  type MatrixProgress,
} from "../analysis/challengeMatrix.js";
import { OllamaProvider } from "../llm/ollama.js";
import { runEncounter } from "../orch/loop.js";
import { answerCompanionChat } from "./chat.js";
import { listRunContainers, listRuns, loadRunDetail, registerFinishedRun } from "./runHistory.js";
import { compositionFromSides } from "../runs/composition.js";
import { companionSession, emptyBoard } from "./session.js";
import { seedClassicStudio } from "./seedClassic.js";
import {
  applyAutoPlacement,
  buildEncounterFromStudio,
  createStudioState,
  generateAsciiSquareMap,
  importCombatantsJson,
  moveStudioToken,
  paintStudioCell,
  setMapFromImageGrid,
  setStudioTacticsGroup,
  studioState,
  studioSummary,
  type PaintBrush,
} from "./studio.js";
import { isTacticsGroupId, type TacticsGroupId } from "../ai/tacticsGroups.js";

function runsDir(): string {
  return runHooks.runsDir ?? path.join(process.cwd(), "runs");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

export type CompanionServer = {
  port: number;
  url: string;
  close: () => Promise<void>;
};

/** When set, POST /api/studio/run uses this to launch combat from the UI. */
export type StudioRunHooks = {
  seed?: number;
  maxRounds?: number;
  play?: boolean;
  narrative?: boolean;
  runsDir?: string;
  save?: boolean;
  onQueued?: () => void;
};

export type StudioSettings = {
  /** Persist dual-commander decision trees under logs/tactics/. */
  saveTacticsLogs: boolean;
  /** Pause after each full round until Enter (includes pre-round deploy when any pause is on). */
  pauseEachRound: boolean;
  /** Pause after each PC/enemy turn until Enter; sticky map updates live each pause. */
  pauseEachTurn: boolean;
};

const DEFAULT_SETTINGS: StudioSettings = {
  saveTacticsLogs: true,
  pauseEachRound: true,
  pauseEachTurn: false,
};

const SETTINGS_FILE = path.join(process.cwd(), "logs", "tactics", ".settings.json");

function loadStudioSettings(): StudioSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) as Partial<StudioSettings>;
      return {
        saveTacticsLogs:
          typeof raw.saveTacticsLogs === "boolean"
            ? raw.saveTacticsLogs
            : DEFAULT_SETTINGS.saveTacticsLogs,
        pauseEachRound:
          typeof raw.pauseEachRound === "boolean"
            ? raw.pauseEachRound
            : DEFAULT_SETTINGS.pauseEachRound,
        pauseEachTurn:
          typeof raw.pauseEachTurn === "boolean"
            ? raw.pauseEachTurn
            : DEFAULT_SETTINGS.pauseEachTurn,
      };
    }
  } catch {
    /* use defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

function persistStudioSettings(settings: StudioSettings): void {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n");
}

let studioSettings: StudioSettings = loadStudioSettings();

let runHooks: StudioRunHooks = {};
let runInFlight = false;
let matrixInFlight = false;
let matrixProgress: MatrixProgress | null = null;
let lastMatrixReport: ChallengeMatrixReport | null = null;

function loadLastMatrixReport(): ChallengeMatrixReport | null {
  if (lastMatrixReport) {
    lastMatrixReport = ensureLoopBriefing(lastMatrixReport);
    return lastMatrixReport;
  }
  const disk = path.join(runsDir(), "challenge-matrix", "challenge-matrix-report.json");
  if (!fs.existsSync(disk)) return null;
  try {
    lastMatrixReport = ensureLoopBriefing(
      JSON.parse(fs.readFileSync(disk, "utf8")) as ChallengeMatrixReport,
    );
    return lastMatrixReport;
  } catch {
    return null;
  }
}

export function setStudioRunHooks(hooks: StudioRunHooks): void {
  runHooks = hooks;
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleStudioApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  ollama: OllamaProvider,
): Promise<boolean> {
  const pathname = url.pathname;
  if (req.method === "GET" && pathname === "/api/studio") {
    json(res, 200, {
      ...studioSummary(studioState),
      mapImage: studioState.map.imageDataUrl ?? null,
      encounter: studioState.encounter,
      runInFlight,
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/studio/reset") {
    Object.assign(studioState, createStudioState());
    json(res, 200, studioSummary(studioState));
    return true;
  }

  if (req.method === "POST" && pathname === "/api/studio/load-sample") {
    try {
      const body = JSON.parse((await readBody(req)) || "{}") as { size?: number };
      const size = body.size ?? studioState.map.width ?? 12;
      seedClassicStudio(size);
      json(res, 200, studioSummary(studioState));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      studioState.lastError = msg;
      json(res, 400, { error: msg, ...studioSummary(studioState) });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/import/pcs") {
    try {
      const raw = JSON.parse(await readBody(req));
      studioState.pcs = importCombatantsJson(raw, "party", studioState.map);
      applyAutoPlacement(studioState);
      studioState.lastError = undefined;
      studioState.encounter = null;
      json(res, 200, studioSummary(studioState));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      studioState.lastError = msg;
      json(res, 400, { error: msg, ...studioSummary(studioState) });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/import/enemies") {
    try {
      const raw = JSON.parse(await readBody(req));
      studioState.enemies = importCombatantsJson(raw, "enemy", studioState.map);
      applyAutoPlacement(studioState);
      studioState.lastError = undefined;
      studioState.encounter = null;
      json(res, 200, studioSummary(studioState));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      studioState.lastError = msg;
      json(res, 400, { error: msg, ...studioSummary(studioState) });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/import/map") {
    try {
      const body = JSON.parse(await readBody(req)) as {
        width: number;
        height: number;
        cells: unknown;
        imageDataUrl?: string;
        imageName?: string;
      };
      setMapFromImageGrid(studioState, body);
      studioState.lastError = undefined;
      json(res, 200, {
        ...studioSummary(studioState),
        mapImage: studioState.map.imageDataUrl ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      studioState.lastError = msg;
      json(res, 400, { error: msg, ...studioSummary(studioState) });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/studio/generate-map") {
    try {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        size?: number;
        borderWalls?: boolean;
      };
      const size = body.size ?? studioState.map.width;
      generateAsciiSquareMap(studioState, size, body.borderWalls !== false);
      studioState.lastError = undefined;
      json(res, 200, studioSummary(studioState));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      studioState.lastError = msg;
      json(res, 400, { error: msg, ...studioSummary(studioState) });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/studio/build") {
    try {
      studioState.encounter = buildEncounterFromStudio(studioState);
      studioState.lastError = undefined;
      json(res, 200, {
        ...studioSummary(studioState),
        encounter: studioState.encounter,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      studioState.lastError = msg;
      json(res, 400, { error: msg, ...studioSummary(studioState) });
    }
    return true;
  }

  if (req.method === "GET" && pathname === "/api/settings") {
    json(res, 200, studioSettings);
    return true;
  }

  if (req.method === "POST" && pathname === "/api/settings") {
    try {
      const body = JSON.parse(await readBody(req)) as Partial<StudioSettings>;
      if (typeof body.saveTacticsLogs === "boolean") {
        studioSettings.saveTacticsLogs = body.saveTacticsLogs;
      }
      if (typeof body.pauseEachRound === "boolean") {
        studioSettings.pauseEachRound = body.pauseEachRound;
      }
      if (typeof body.pauseEachTurn === "boolean") {
        studioSettings.pauseEachTurn = body.pauseEachTurn;
      }
      persistStudioSettings(studioSettings);
      json(res, 200, studioSettings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      json(res, 400, { error: msg });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/studio/run") {
    if (runInFlight) {
      json(res, 409, { error: "A combat run is already in progress" });
      return true;
    }
    try {
      if (!studioState.encounter) {
        studioState.encounter = buildEncounterFromStudio(studioState);
      }
      const fixture = studioState.encounter;
      companionSession.clearCombatForNewRun();
      runInFlight = true;
      runHooks.onQueued?.();
      json(res, 202, {
        ok: true,
        message: "Combat started",
        ...studioSummary(studioState),
      });

      void (async () => {
        try {
          let llm = undefined;
          if (runHooks.narrative) {
            const ok = await ollama.healthCheck();
            if (ok) llm = ollama;
          }
          console.error(
            `[studio] saveTacticsLogs=${studioSettings.saveTacticsLogs} pauseEachRound=${studioSettings.pauseEachRound} pauseEachTurn=${studioSettings.pauseEachTurn} saveRuns=${runHooks.save !== false}`,
          );
          const result = await runEncounter(fixture, {
            seed: runHooks.seed ?? 42,
            save: runHooks.save !== false,
            saveTacticsLogs: studioSettings.saveTacticsLogs,
            maxRounds: runHooks.maxRounds ?? 20,
            runsDir: runsDir(),
            narrative: runHooks.narrative,
            llm,
            companion: companionSession,
            pauseEachRound: studioSettings.pauseEachRound,
            pauseEachTurn: studioSettings.pauseEachTurn,
          });
          if (result.tacticsLogPath) {
            console.error(`[studio] Tactics log: ${result.tacticsLogPath}`);
          } else if (studioSettings.saveTacticsLogs) {
            console.error("[studio] Tactics log setting is on, but no file was written.");
          } else {
            console.error("[studio] Tactics log skipped (Settings → Save tactical logs? is off).");
          }
          const end = [...result.mem.events].reverse().find((e) => e.t === "combat_end");
          const party = [...result.mem.combatants.values()].filter((c) => c.side === "party");
          const enemies = [...result.mem.combatants.values()].filter((c) => c.side === "enemy");
          registerFinishedRun({
            runDir: result.runDir,
            runsDir: runsDir(),
            encounterId: fixture.id,
            encounterName: fixture.name,
            seed: runHooks.seed ?? 42,
            output: result.output,
            winner: end && end.t === "combat_end" ? end.winner : undefined,
            rounds: result.mem.round,
            composition: compositionFromSides(
              party.map((c) => c.name),
              enemies.map((c) => c.name),
              result.mem.grid.width,
              result.mem.grid.height,
            ),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          companionSession.context = {
            updatedAt: new Date().toISOString(),
            encounterId: fixture.id,
            encounterName: fixture.name,
            seed: runHooks.seed ?? 42,
            round: 0,
            phase: "ended",
            endReason: msg,
            initiative: [],
            statusText: `Run failed: ${msg}`,
            mapText: "",
            board: emptyBoard(),
            recentLog: msg,
            combatants: [],
            waitingForAdvance: false,
            rounds: [],
          };
        } finally {
          runInFlight = false;
        }
      })();
    } catch (err) {
      runInFlight = false;
      const msg = err instanceof Error ? err.message : String(err);
      studioState.lastError = msg;
      json(res, 400, { error: msg, ...studioSummary(studioState) });
    }
    return true;
  }

  if (req.method === "GET" && pathname === "/api/runs") {
    const dir = runsDir();
    json(res, 200, { runs: listRuns(dir), containers: listRunContainers(dir) });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/runs/detail") {
    try {
      const id = url.searchParams.get("id");
      if (!id) {
        json(res, 400, { error: "id required" });
        return true;
      }
      json(res, 200, loadRunDetail(runsDir(), id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      json(res, 404, { error: msg });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/combat/clear") {
    companionSession.clearCombatForNewRun();
    json(res, 200, {
      ok: true,
      message: "Combat cleared — ready for a new run",
      ...studioSummary(studioState),
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/combat/advance") {
    const wasDeploy = companionSession.context?.phase === "deploy";
    const ok = companionSession.advance();
    json(res, ok ? 200 : 409, {
      ok,
      message: ok
        ? wasDeploy
          ? "Starting Round 1"
          : "Advancing to next round"
        : "Combat is not waiting for advance",
      waitingForAdvance: companionSession.waitingForAdvance,
      context: companionSession.context,
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/studio/move-token") {
    try {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        id?: string;
        x?: number;
        y?: number;
      };
      if (!body.id || body.x == null || body.y == null) {
        json(res, 400, { error: "id, x, y required" });
        return true;
      }
      moveStudioToken(studioState, body.id, Number(body.x), Number(body.y));
      // keep encounter; moveStudioToken syncs starts when built
      studioState.lastError = undefined;
      json(res, 200, { ok: true, ...studioSummary(studioState) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      json(res, 400, { error: msg, ...studioSummary(studioState) });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/studio/paint-cell") {
    try {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        x?: number;
        y?: number;
        brush?: string;
      };
      const brush = body.brush as PaintBrush | undefined;
      if (body.x == null || body.y == null || (brush !== "wall" && brush !== "barricade")) {
        json(res, 400, { error: "x, y, and brush (wall|barricade) required" });
        return true;
      }
      paintStudioCell(studioState, Number(body.x), Number(body.y), brush);
      json(res, 200, { ok: true, ...studioSummary(studioState) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      json(res, 400, { error: msg, ...studioSummary(studioState) });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/studio/set-tactics-group") {
    try {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        id?: string;
        tacticsGroup?: string;
        tacticsSecondary?: string | null;
      };
      if (!body.id || !isTacticsGroupId(body.tacticsGroup)) {
        json(res, 400, { error: "id and valid tacticsGroup required" });
        return true;
      }
      let secondary: TacticsGroupId | null = null;
      if (
        body.tacticsSecondary != null &&
        body.tacticsSecondary !== "" &&
        body.tacticsSecondary !== "none"
      ) {
        if (!isTacticsGroupId(body.tacticsSecondary)) {
          json(res, 400, { error: "tacticsSecondary must be a valid group or none" });
          return true;
        }
        secondary = body.tacticsSecondary;
      }
      setStudioTacticsGroup(studioState, body.id, body.tacticsGroup, secondary);
      studioState.lastError = undefined;
      json(res, 200, { ok: true, ...studioSummary(studioState) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      json(res, 400, { error: msg, ...studioSummary(studioState) });
    }
    return true;
  }

  if (req.method === "POST" && pathname === "/api/combat/move-token") {
    try {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        id?: string;
        x?: number;
        y?: number;
      };
      if (!body.id || body.x == null || body.y == null) {
        json(res, 400, { error: "id, x, y required" });
        return true;
      }
      const x = Number(body.x);
      const y = Number(body.y);
      companionSession.moveLiveToken(body.id, x, y);
      // Mirror into studio so a re-run keeps the deploy.
      try {
        moveStudioToken(studioState, body.id, x, y);
      } catch {
        /* studio may not have this id during a non-studio run */
      }
      json(res, 200, {
        ok: true,
        context: companionSession.context,
        ...studioSummary(studioState),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      json(res, 400, { error: msg, context: companionSession.context });
    }
    return true;
  }

  if (req.method === "GET" && pathname === "/api/loop/status") {
    const report = loadLastMatrixReport();
    json(res, 200, {
      running: matrixInFlight,
      progress: matrixProgress,
      hasReport: !!report,
      summary: report?.summary ?? null,
      generatedAt: report?.generatedAt ?? null,
      briefingHeadline: report?.briefing?.headline ?? null,
    });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/loop/report") {
    const report = loadLastMatrixReport();
    if (!report) {
      json(res, 404, { error: "No loop report yet. Start Loop mode first." });
      return true;
    }
    json(res, 200, report);
    return true;
  }

  if (req.method === "GET" && pathname === "/api/loop/report.html") {
    const report = loadLastMatrixReport();
    if (!report) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No loop report yet. Start Loop mode first.");
      return true;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderChallengeMatrixHtml(report));
    return true;
  }

  if (req.method === "POST" && pathname === "/api/loop/start") {
    if (matrixInFlight || runInFlight) {
      json(res, 409, { error: "A run or loop is already in progress" });
      return true;
    }

    type LoopStartBody = {
      seedCount?: number;
      baseSeed?: number;
      maxRounds?: number;
      partySizes?: number[];
      threats?: Array<"trivial" | "moderate" | "hard" | "extreme">;
    };
    let body: LoopStartBody = {};
    try {
      const raw = await readBody(req);
      if (raw.trim()) body = JSON.parse(raw) as LoopStartBody;
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return true;
    }

    const seedCount = Math.min(20, Math.max(1, Math.floor(Number(body.seedCount ?? 3))));
    const baseSeed = Math.floor(Number(body.baseSeed ?? 201));
    const maxRounds = Math.min(
      100,
      Math.max(1, Math.floor(Number(body.maxRounds ?? runHooks.maxRounds ?? 20))),
    );
    const partySizes = Array.isArray(body.partySizes) ? body.partySizes : [3, 4, 5];
    const threats = Array.isArray(body.threats)
      ? body.threats
      : (["trivial", "moderate", "hard", "extreme"] as const);

    const totalGuess =
      Math.max(1, partySizes.length) * Math.max(1, threats.length) * seedCount;

    matrixInFlight = true;
    matrixProgress = {
      phase: "running",
      message: "Queued…",
      completed: 0,
      total: totalGuess,
    };
    json(res, 202, {
      ok: true,
      message: `Loop matrix started (~${totalGuess} fights)`,
      params: { seedCount, baseSeed, maxRounds, partySizes, threats },
    });

    void (async () => {
      try {
        const outDir = path.join(runsDir(), "challenge-matrix");
        const report = await runChallengeMatrix({
          maxRounds,
          seedCount,
          baseSeed,
          partySizes,
          threats: [...threats],
          onProgress: (p) => {
            matrixProgress = p;
          },
        });
        lastMatrixReport = ensureLoopBriefing(report);
        writeChallengeMatrixArtifacts(lastMatrixReport, outDir);
        matrixProgress = {
          phase: "done",
          message: "Matrix complete",
          completed: report.rows.length,
          total: report.rows.length,
          report,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        matrixProgress = {
          phase: "error",
          message: msg,
          completed: matrixProgress?.completed ?? 0,
          total: matrixProgress?.total ?? totalGuess,
          error: msg,
        };
      } finally {
        matrixInFlight = false;
      }
    })();
    return true;
  }

  return false;
}

export async function startCompanionServer(opts?: {
  port?: number;
  model?: string;
  runHooks?: StudioRunHooks;
}): Promise<CompanionServer> {
  const port = opts?.port ?? Number(process.env.COMPANION_PORT ?? 5179);
  const ollama = new OllamaProvider({ model: opts?.model });
  if (opts?.runHooks) setStudioRunHooks(opts.runHooks);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (await handleStudioApi(req, res, url, ollama)) return;

      if (req.method === "GET" && url.pathname === "/api/context") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            context: companionSession.context,
            chat: companionSession.chat,
            model: ollama.modelName,
            studio: studioSummary(studioState),
            runInFlight,
          }),
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/chat") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as { message?: string };
        const message = (body.message ?? "").trim();
        if (!message) {
          json(res, 400, { error: "message required" });
          return;
        }
        const ok = await ollama.healthCheck();
        if (!ok) {
          json(res, 503, {
            error: "Ollama not reachable. Start ollama with llama3 (or set OLLAMA_MODEL).",
          });
          return;
        }
        const matrix = loadLastMatrixReport();
        const reply = await answerCompanionChat(message, ollama, {
          runInFlight,
          loopBriefingText: matrix?.briefing?.text ?? null,
        });
        json(res, 200, { reply, chat: companionSession.chat });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/chat/clear") {
        companionSession.chat = [];
        json(res, 200, { ok: true });
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        json(res, 404, { error: `Unknown API route: ${url.pathname}` });
        return;
      }

      let rel = url.pathname === "/" ? "/index.html" : url.pathname;
      rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
      const filePath = path.join(PUBLIC_DIR, rel);
      if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentType(filePath) });
      res.end(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      json(res, 500, { error: msg });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const url = `http://127.0.0.1:${port}/`;
  return {
    port,
    url,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
