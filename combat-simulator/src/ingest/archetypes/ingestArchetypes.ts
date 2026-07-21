import fs from "node:fs";
import path from "node:path";
import { ArchetypeSchema, type Archetype } from "../../memory/schemas.js";
import { COMBAT_ARCHETYPE_STUBS, type CombatArchetypeStub } from "./combatStubs.js";
import type { ElasticArchetypeHit } from "./fetchElastic.js";
import { parseAonArchetypesHtml } from "./parseAonHtml.js";

export type ArchetypeIndexEntry = {
  aonId: number;
  name: string;
  summary: string;
  url: string;
  level?: number | null;
  prerequisites?: string | null;
  traits?: string[];
};

export type UnmappedArchetypeStub = {
  id: string;
  name: string;
  matchNames: string[];
  reason: string;
};

export type IngestArchetypesResult = {
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

export function indexFromElastic(hits: ElasticArchetypeHit[]): ArchetypeIndexEntry[] {
  return hits.map((h) => ({
    aonId: h.aonId,
    name: h.name,
    summary: h.summary,
    url: h.url,
    level: h.level,
    prerequisites: h.prerequisites,
    traits: h.traits,
  }));
}

export function indexFromHtml(html: string): ArchetypeIndexEntry[] {
  return parseAonArchetypesHtml(html);
}

function findMatch(
  stub: CombatArchetypeStub,
  byName: Map<string, ArchetypeIndexEntry>,
): ArchetypeIndexEntry | undefined {
  for (const n of stub.matchNames) {
    const hit = byName.get(normalizeName(n));
    if (hit) return hit;
  }
  return undefined;
}

export function buildArchetypeCatalog(index: ArchetypeIndexEntry[]): {
  catalog: Archetype[];
  unmapped: UnmappedArchetypeStub[];
} {
  const byName = new Map<string, ArchetypeIndexEntry>();
  for (const e of index) {
    const key = normalizeName(e.name);
    if (!byName.has(key)) byName.set(key, e);
  }

  const catalog: Archetype[] = [];
  const unmapped: UnmappedArchetypeStub[] = [];

  for (const stub of COMBAT_ARCHETYPE_STUBS) {
    const matched = findMatch(stub, byName);
    if (!matched && !stub.allowMissingAon) {
      unmapped.push({
        id: stub.id,
        name: stub.name,
        matchNames: stub.matchNames,
        reason: "no matching Archetypes.aspx?ID in index",
      });
      continue;
    }

    const parsed = ArchetypeSchema.safeParse({
      id: stub.id,
      name: stub.name,
      kind: stub.kind,
      dedicationLevel: matched?.level ?? stub.dedicationLevel,
      overlayId: stub.overlayId,
      grantCapabilities: stub.grantCapabilities ?? [],
      preferPacketIds: stub.preferPacketIds ?? [],
      scoreHints: stub.scoreHints ?? {},
      roleHint: stub.roleHint,
      aonId: matched?.aonId,
      aonUrl: matched?.url,
      summary: matched?.summary || stub.summary,
    });
    if (!parsed.success) {
      unmapped.push({
        id: stub.id,
        name: stub.name,
        matchNames: stub.matchNames,
        reason: `ArchetypeSchema failed: ${parsed.error.message}`,
      });
      continue;
    }
    catalog.push(parsed.data);
  }

  catalog.sort(
    (a, b) =>
      a.dedicationLevel - b.dedicationLevel || a.name.localeCompare(b.name),
  );
  return { catalog, unmapped };
}

export function writeArchetypeArtifacts(opts: {
  index: ArchetypeIndexEntry[];
  outDir: string;
  source: string;
}): IngestArchetypesResult {
  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const { catalog, unmapped } = buildArchetypeCatalog(opts.index);
  const generatedAt = new Date().toISOString();
  const indexPath = path.join(outDir, "index.json");
  const catalogPath = path.join(outDir, "catalog.json");
  const unmappedPath = path.join(outDir, "unmapped.json");

  fs.writeFileSync(
    indexPath,
    `${JSON.stringify(
      {
        generatedAt,
        source: opts.source,
        count: opts.index.length,
        archetypes: opts.index,
      },
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
        note: "Combat-ready ArchetypeSchema stubs. Tags go on combatant.archetypes[]; overlays/capabilities applied in buildProfile.",
        archetypes: catalog,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  fs.writeFileSync(
    unmappedPath,
    `${JSON.stringify(
      {
        generatedAt,
        source: opts.source,
        count: unmapped.length,
        stubs: unmapped,
      },
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

export function ingestArchetypesFromHtml(opts: {
  fromPath: string;
  outDir: string;
}): IngestArchetypesResult {
  const fromPath = path.resolve(opts.fromPath);
  if (!fs.existsSync(fromPath)) {
    throw new Error(
      `Archetypes HTML not found: ${fromPath}\nHint: npm run ingest-archetypes -- --fetch-elastic`,
    );
  }
  const html = fs.readFileSync(fromPath, "utf8");
  const index = indexFromHtml(html);
  if (index.length === 0) {
    throw new Error(`No Archetypes.aspx?ID entries in ${fromPath}`);
  }
  const source =
    path.relative(process.cwd(), fromPath).replace(/\\/g, "/") || fromPath;
  return writeArchetypeArtifacts({ index, outDir: opts.outDir, source });
}
