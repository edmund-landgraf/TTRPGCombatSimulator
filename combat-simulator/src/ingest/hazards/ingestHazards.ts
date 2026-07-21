import fs from "node:fs";
import path from "node:path";
import { HazardSchema, type Hazard } from "../../memory/schemas.js";
import { COMBAT_HAZARD_STUBS, type CombatHazardStub } from "./combatStubs.js";
import {
  parseDc,
  parseDisableSkill,
  type ElasticHazardHit,
} from "./fetchElastic.js";
import { parseAonHazardsHtml } from "./parseAonHtml.js";

export type HazardIndexEntry = {
  aonId: number;
  name: string;
  summary: string;
  url: string;
  level?: number | null;
  complexity?: string | null;
  hazardType?: string | null;
  stealthDc?: number;
  disableDc?: number;
  disableSkill?: string;
  traits?: string[];
};

export type UnmappedHazardStub = {
  id: string;
  name: string;
  matchNames: string[];
  reason: string;
};

export type IngestHazardsResult = {
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

export function indexFromElastic(hits: ElasticHazardHit[]): HazardIndexEntry[] {
  return hits.map((h) => ({
    aonId: h.aonId,
    name: h.name,
    summary: h.summary,
    url: h.url,
    level: h.level,
    complexity: h.complexity,
    hazardType: h.hazardType,
    stealthDc: parseDc(h.stealth),
    disableDc: parseDc(h.disable),
    disableSkill: parseDisableSkill(h.disable),
    traits: h.traits,
  }));
}

export function indexFromHtml(html: string): HazardIndexEntry[] {
  return parseAonHazardsHtml(html);
}

function findMatch(
  stub: CombatHazardStub,
  byName: Map<string, HazardIndexEntry>,
): HazardIndexEntry | undefined {
  for (const n of stub.matchNames) {
    const hit = byName.get(normalizeName(n));
    if (hit) return hit;
  }
  return undefined;
}

function mapHazardType(
  raw: string | null | undefined,
  fallback: Hazard["hazardType"],
): Hazard["hazardType"] {
  const t = (raw ?? "").toLowerCase();
  if (t.includes("haunt")) return "haunt";
  if (t.includes("environ")) return "environmental";
  if (t.includes("trap")) return "trap";
  return fallback;
}

export function buildHazardCatalog(index: HazardIndexEntry[]): {
  catalog: Hazard[];
  unmapped: UnmappedHazardStub[];
} {
  const byName = new Map<string, HazardIndexEntry>();
  for (const e of index) {
    const key = normalizeName(e.name);
    if (!byName.has(key)) byName.set(key, e);
  }

  const catalog: Hazard[] = [];
  const unmapped: UnmappedHazardStub[] = [];

  for (const stub of COMBAT_HAZARD_STUBS) {
    const matched = findMatch(stub, byName);
    if (!matched && !stub.allowMissingAon) {
      unmapped.push({
        id: stub.id!,
        name: stub.name!,
        matchNames: stub.matchNames,
        reason: "no matching Hazards.aspx?ID in index",
      });
      continue;
    }

    const parsed = HazardSchema.safeParse({
      ...stub,
      level: matched?.level ?? stub.level,
      complexity:
        matched?.complexity?.toLowerCase() === "complex" ? "complex" : stub.complexity,
      hazardType: mapHazardType(matched?.hazardType, stub.hazardType ?? "trap"),
      stealthDc: matched?.stealthDc ?? stub.stealthDc,
      disableDc: matched?.disableDc ?? stub.disableDc,
      disableSkill: matched?.disableSkill ?? stub.disableSkill,
      aonId: matched?.aonId,
      aonUrl: matched?.url,
      summary: matched?.summary || stub.summary,
    });
    if (!parsed.success) {
      unmapped.push({
        id: stub.id!,
        name: stub.name!,
        matchNames: stub.matchNames,
        reason: `HazardSchema failed: ${parsed.error.message}`,
      });
      continue;
    }
    catalog.push(parsed.data);
  }

  catalog.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  return { catalog, unmapped };
}

export function writeHazardArtifacts(opts: {
  index: HazardIndexEntry[];
  outDir: string;
  source: string;
}): IngestHazardsResult {
  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const { catalog, unmapped } = buildHazardCatalog(opts.index);
  const generatedAt = new Date().toISOString();
  const indexPath = path.join(outDir, "index.json");
  const catalogPath = path.join(outDir, "catalog.json");
  const unmappedPath = path.join(outDir, "unmapped.json");

  fs.writeFileSync(
    indexPath,
    `${JSON.stringify(
      { generatedAt, source: opts.source, count: opts.index.length, hazards: opts.index },
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
        note: "Combat-ready HazardSchema stubs. Place via fixture.hazards[]; trigger on enter_square / EOT.",
        hazards: catalog,
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

export function ingestHazardsFromHtml(opts: {
  fromPath: string;
  outDir: string;
}): IngestHazardsResult {
  const fromPath = path.resolve(opts.fromPath);
  if (!fs.existsSync(fromPath)) {
    throw new Error(
      `Hazards HTML not found: ${fromPath}\nHint: npm run ingest-hazards -- --fetch-elastic`,
    );
  }
  const html = fs.readFileSync(fromPath, "utf8");
  const index = indexFromHtml(html);
  if (index.length === 0) {
    throw new Error(`No Hazards.aspx?ID entries in ${fromPath}`);
  }
  const source = path.relative(process.cwd(), fromPath).replace(/\\/g, "/") || fromPath;
  return writeHazardArtifacts({ index, outDir: opts.outDir, source });
}
