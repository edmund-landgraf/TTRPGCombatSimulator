import fs from "node:fs";
import path from "node:path";
import {
  compositionKey,
  compositionLabel,
  parseCompositionFromWalkthrough,
  type RunComposition,
} from "../runs/composition.js";

export type RunListItem = {
  id: string;
  encounterId: string;
  label: string;
  createdAt: string;
  winner?: string;
  rounds?: number;
  seed?: number;
  source: "disk" | "memory";
  composition?: RunComposition;
  containerKey?: string;
  containerLabel?: string;
};

export type RunContainer = {
  key: string;
  label: string;
  runs: RunListItem[];
};

export type RunDetail = RunListItem & {
  walkthrough: string;
  statusSummary?: string;
};

type MemoryRun = RunDetail;

const memoryRuns: MemoryRun[] = [];

const SKIP_DIR_NAMES = new Set(["batch10", "challenge-matrix", "node_modules"]);

function safeJoin(runsDir: string, id: string): string {
  const resolvedRoot = path.resolve(runsDir);
  const resolved = path.resolve(runsDir, id);
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    throw new Error("Invalid run id");
  }
  return resolved;
}

function withContainer(item: Omit<RunListItem, "containerKey" | "containerLabel">): RunListItem {
  if (!item.composition) {
    return {
      ...item,
      containerKey: `unknown|${item.encounterId}|${item.createdAt.slice(0, 10)}`,
      containerLabel: `${item.encounterId}, ${new Date(item.createdAt).toLocaleDateString()}`,
    };
  }
  return {
    ...item,
    containerKey: compositionKey(item.composition, item.createdAt),
    containerLabel: compositionLabel(item.composition, item.createdAt),
  };
}

function readComposition(
  dir: string,
  raw: { composition?: RunComposition },
): RunComposition | undefined {
  if (
    raw.composition &&
    typeof raw.composition.partyCount === "number" &&
    typeof raw.composition.enemyLabel === "string" &&
    typeof raw.composition.gridWidth === "number" &&
    typeof raw.composition.gridHeight === "number"
  ) {
    return raw.composition;
  }
  const walkPath = path.join(dir, "walkthrough.md");
  if (!fs.existsSync(walkPath)) return undefined;
  try {
    return parseCompositionFromWalkthrough(fs.readFileSync(walkPath, "utf8")) ?? undefined;
  } catch {
    return undefined;
  }
}

function readRunMeta(dir: string, encounterId: string, id: string): RunListItem | null {
  const runPath = path.join(dir, "run.json");
  if (!fs.existsSync(runPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(runPath, "utf8")) as {
      runId?: string;
      encounterId?: string;
      createdAt?: string;
      seed?: number;
      outcome?: { winner?: string; rounds?: number; reason?: string };
      notes?: string;
      composition?: RunComposition;
    };
    const stamp = raw.createdAt ?? raw.runId ?? path.basename(dir);
    const winner = raw.outcome?.winner;
    const rounds = raw.outcome?.rounds;
    const label = [
      encounterId,
      winner ? `→ ${winner}` : null,
      rounds != null ? `r${rounds}` : null,
      raw.notes ? raw.notes.slice(0, 24) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const createdAt = typeof stamp === "string" ? stamp : new Date().toISOString();
    return withContainer({
      id,
      encounterId: raw.encounterId ?? encounterId,
      label,
      createdAt,
      winner,
      rounds,
      seed: raw.seed,
      source: "disk",
      composition: readComposition(dir, raw),
    });
  } catch {
    return null;
  }
}

/** Register a finished run (disk path and/or in-memory transcript). */
export function registerFinishedRun(opts: {
  runDir?: string;
  runsDir: string;
  encounterId: string;
  encounterName: string;
  seed: number;
  output: string;
  winner?: string;
  rounds?: number;
  composition?: RunComposition;
}): RunListItem {
  if (opts.runDir) {
    const id = path.relative(opts.runsDir, opts.runDir).replace(/\\/g, "/");
    const item = readRunMeta(opts.runDir, opts.encounterId, id);
    if (item) return item;
  }

  const createdAt = new Date().toISOString();
  const id = `memory/${createdAt.replace(/[:.]/g, "-")}_${opts.encounterId}`;
  const composition =
    opts.composition ?? parseCompositionFromWalkthrough(opts.output) ?? undefined;
  const mem: MemoryRun = {
    ...withContainer({
      id,
      encounterId: opts.encounterId,
      label: `${opts.encounterName} · ${opts.winner ?? "done"} · r${opts.rounds ?? "?"}`,
      createdAt,
      winner: opts.winner,
      rounds: opts.rounds,
      seed: opts.seed,
      source: "memory",
      composition,
    }),
    walkthrough: opts.output,
  };
  memoryRuns.unshift(mem);
  if (memoryRuns.length > 40) memoryRuns.length = 40;
  return mem;
}

export function listRuns(runsDir: string, limit = 60): RunListItem[] {
  const items: RunListItem[] = [...memoryRuns];

  if (fs.existsSync(runsDir)) {
    const encounterDirs = fs
      .readdirSync(runsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !SKIP_DIR_NAMES.has(d.name));

    for (const enc of encounterDirs) {
      const encPath = path.join(runsDir, enc.name);
      let runDirs: fs.Dirent[];
      try {
        runDirs = fs.readdirSync(encPath, { withFileTypes: true }).filter((d) => d.isDirectory());
      } catch {
        continue;
      }
      for (const rd of runDirs) {
        const dir = path.join(encPath, rd.name);
        const id = `${enc.name}/${rd.name}`.replace(/\\/g, "/");
        const meta = readRunMeta(dir, enc.name, id);
        if (meta) items.push(meta);
      }
    }
  }

  items.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const seen = new Set<string>();
  const out: RunListItem[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

/** Group runs into expandable containers: roster + grid + calendar day. */
export function listRunContainers(runsDir: string, limit = 60): RunContainer[] {
  const runs = listRuns(runsDir, limit);
  const byKey = new Map<string, RunContainer>();

  for (const run of runs) {
    const key = run.containerKey ?? `unknown|${run.id}`;
    const label = run.containerLabel ?? run.encounterId;
    let container = byKey.get(key);
    if (!container) {
      container = { key, label, runs: [] };
      byKey.set(key, container);
    }
    container.runs.push(run);
  }

  const containers = [...byKey.values()];
  containers.sort((a, b) => {
    const aDate = a.runs[0]?.createdAt ?? "";
    const bDate = b.runs[0]?.createdAt ?? "";
    if (aDate !== bDate) return aDate < bDate ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  for (const c of containers) {
    c.runs.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }
  return containers;
}

export function loadRunDetail(runsDir: string, id: string): RunDetail {
  const mem = memoryRuns.find((r) => r.id === id);
  if (mem) return mem;

  const dir = safeJoin(runsDir, id);
  if (!fs.existsSync(dir)) throw new Error(`Run not found: ${id}`);
  const encounterId = id.split("/")[0] ?? "unknown";
  const meta = readRunMeta(dir, encounterId, id);
  if (!meta) throw new Error(`Run meta missing: ${id}`);

  const walkPath = path.join(dir, "walkthrough.md");
  const walkthrough = fs.existsSync(walkPath)
    ? fs.readFileSync(walkPath, "utf8")
    : fs.existsSync(path.join(dir, "run.json"))
      ? JSON.stringify(JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8")), null, 2)
      : "(no walkthrough)";

  return { ...meta, walkthrough };
}
