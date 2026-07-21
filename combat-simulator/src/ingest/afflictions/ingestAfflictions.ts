import fs from "node:fs";
import path from "node:path";
import { AfflictionSchema, type Affliction } from "../../memory/schemas.js";
import { COMBAT_AFFLICTION_STUBS, type CombatAfflictionStub } from "./combatStubs.js";
import type { ElasticAfflictionHit } from "./fetchElastic.js";
import { parseStageText } from "./parseStageText.js";
import {
  parseAonAfflictionsHtml,
  type AonAfflictionIndexEntry,
} from "./parseAonHtml.js";

export type AfflictionIndexEntry = {
  aonId: number;
  name: string;
  summary: string;
  url: string;
  kind?: string;
  level?: number | null;
  saveDc?: number | null;
  stagesRaw?: string[];
  traits?: string[];
};

export type UnmappedAfflictionStub = {
  id: string;
  name: string;
  matchNames: string[];
  reason: string;
};

export type IngestAfflictionsResult = {
  source: string;
  generatedAt: string;
  indexCount: number;
  catalogCount: number;
  unmappedCount: number;
  indexPath: string;
  catalogPath: string;
  unmappedPath: string;
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function indexFromElastic(hits: ElasticAfflictionHit[]): AfflictionIndexEntry[] {
  return hits.map((h) => ({
    aonId: h.aonId,
    name: h.name,
    summary: h.summary,
    url: h.url,
    kind: h.kind,
    level: h.level,
    saveDc: h.saveDc,
    stagesRaw: h.stagesRaw,
    traits: h.traits,
  }));
}

export function indexFromHtml(html: string): AfflictionIndexEntry[] {
  return parseAonAfflictionsHtml(html).map((e: AonAfflictionIndexEntry) => ({
    aonId: e.aonId,
    name: e.name,
    summary: e.summary,
    url: e.url,
  }));
}

function findMatch(
  stub: CombatAfflictionStub,
  byName: Map<string, AfflictionIndexEntry>,
): AfflictionIndexEntry | undefined {
  for (const n of stub.matchNames) {
    const hit = byName.get(normalizeName(n));
    if (hit) return hit;
  }
  return undefined;
}

export function buildAfflictionCatalog(index: AfflictionIndexEntry[]): {
  catalog: Affliction[];
  unmapped: UnmappedAfflictionStub[];
} {
  const byName = new Map<string, AfflictionIndexEntry>();
  for (const e of index) {
    const key = normalizeName(e.name);
    if (!byName.has(key)) byName.set(key, e);
  }

  const catalog: Affliction[] = [];
  const unmapped: UnmappedAfflictionStub[] = [];

  for (const stub of COMBAT_AFFLICTION_STUBS) {
    const matched = findMatch(stub, byName);
    if (!matched && !stub.allowMissingAon && stub.matchNames.length > 0) {
      unmapped.push({
        id: stub.id,
        name: stub.name,
        matchNames: stub.matchNames,
        reason: "no matching AoN affliction in index",
      });
      continue;
    }

    // Prefer parsed Elastic stages when available and non-empty.
    let stages = stub.stages;
    if (matched?.stagesRaw && matched.stagesRaw.length > 0) {
      stages = matched.stagesRaw.map((t) => parseStageText(t));
    }

    const parsed = AfflictionSchema.safeParse({
      id: stub.id,
      name: stub.name,
      kind: stub.kind,
      level: matched?.level ?? stub.level,
      saveDc: matched?.saveDc ?? stub.saveDc,
      virulent: stub.virulent ?? matched?.traits?.some((t) => /virulent/i.test(t)) ?? false,
      maxDurationRounds: stub.maxDurationRounds,
      stages,
      aonId: matched?.aonId,
      aonUrl: matched?.url,
      summary: matched?.summary ?? stub.summary,
    });
    if (!parsed.success) {
      unmapped.push({
        id: stub.id,
        name: stub.name,
        matchNames: stub.matchNames,
        reason: `AfflictionSchema failed: ${parsed.error.message}`,
      });
      continue;
    }
    catalog.push(parsed.data);
  }

  catalog.sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.name.localeCompare(b.name));
  return { catalog, unmapped };
}

export function writeAfflictionArtifacts(opts: {
  index: AfflictionIndexEntry[];
  outDir: string;
  source: string;
}): IngestAfflictionsResult {
  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const { catalog, unmapped } = buildAfflictionCatalog(opts.index);
  const generatedAt = new Date().toISOString();

  const indexPath = path.join(outDir, "index.json");
  const catalogPath = path.join(outDir, "catalog.json");
  const unmappedPath = path.join(outDir, "unmapped.json");

  fs.writeFileSync(
    indexPath,
    `${JSON.stringify(
      { generatedAt, source: opts.source, count: opts.index.length, afflictions: opts.index },
      null,
      2,
    )}\n`,
    "utf8",
  );
  fs.writeFileSync(
    catalogPath,
    `${JSON.stringify(
      {
        generatedAt,
        source: opts.source,
        count: catalog.length,
        note: "Combat-ready AfflictionSchema stubs. Runtime: exposeAffliction + EOT tick.",
        afflictions: catalog,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  fs.writeFileSync(
    unmappedPath,
    `${JSON.stringify(
      { generatedAt, source: opts.source, count: unmapped.length, stubs: unmapped },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    source: opts.source,
    generatedAt,
    indexCount: opts.index.length,
    catalogCount: catalog.length,
    unmappedCount: unmapped.length,
    indexPath,
    catalogPath,
    unmappedPath,
  };
}

export function ingestAfflictionsFromHtml(opts: {
  fromPath: string;
  outDir: string;
}): IngestAfflictionsResult {
  const fromPath = path.resolve(opts.fromPath);
  if (!fs.existsSync(fromPath)) {
    throw new Error(
      `Afflictions HTML not found: ${fromPath}\nHint: npm run ingest-afflictions -- --fetch-elastic`,
    );
  }
  const html = fs.readFileSync(fromPath, "utf8");
  const index = indexFromHtml(html);
  if (index.length === 0) {
    throw new Error(`No affliction ID links found in ${fromPath}`);
  }
  const source = path.relative(process.cwd(), fromPath).replace(/\\/g, "/") || fromPath;
  return writeAfflictionArtifacts({ index, outDir: opts.outDir, source });
}
