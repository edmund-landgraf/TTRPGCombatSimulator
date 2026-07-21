import fs from "node:fs";
import path from "node:path";
import { COMBAT_FEAT_STUBS, type CombatFeatStub } from "./combatStubs.js";
import { parseAonFeatsHtml, type AonFeatIndexEntry } from "./parseAonHtml.js";

export type FeatCatalogEntry = {
  id: string;
  name: string;
  aonId: number | null;
  aonUrl: string | null;
  summary: string;
  level: number | null;
  traits: string[];
  matchedName: string | null;
  overlayId?: string;
  preferPacketIds?: string[];
  head?: string;
  actions: number;
  frequency: CombatFeatStub["frequency"];
  effectClass: CombatFeatStub["effectClass"];
  needsOffGuard?: boolean;
  needsRaisedShield?: boolean;
  needsAdjacentFoe?: boolean;
  needsReactionAvailable?: boolean;
  minActions?: number;
  maxMap?: number;
  avoidThirdStrike?: boolean;
  scoreHint: number;
};

export type UnmappedFeatStub = {
  id: string;
  name: string;
  matchNames: string[];
  reason: string;
};

export type IngestFeatsResult = {
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

function findIndexMatch(
  stub: CombatFeatStub,
  byName: Map<string, AonFeatIndexEntry>,
): AonFeatIndexEntry | undefined {
  for (const candidate of stub.matchNames) {
    const hit = byName.get(normalizeName(candidate));
    if (hit) return hit;
  }
  return undefined;
}

export function buildFeatCatalog(index: AonFeatIndexEntry[]): {
  catalog: FeatCatalogEntry[];
  unmapped: UnmappedFeatStub[];
} {
  const byName = new Map<string, AonFeatIndexEntry>();
  for (const entry of index) {
    const key = normalizeName(entry.name);
    if (!byName.has(key)) byName.set(key, entry);
  }

  const catalog: FeatCatalogEntry[] = [];
  const unmapped: UnmappedFeatStub[] = [];

  for (const stub of COMBAT_FEAT_STUBS) {
    const matched =
      stub.matchNames.length > 0 ? findIndexMatch(stub, byName) : undefined;

    if (!matched && !stub.allowMissingAon && stub.matchNames.length > 0) {
      unmapped.push({
        id: stub.id,
        name: stub.name,
        matchNames: stub.matchNames,
        reason: "no matching Feats.aspx?ID entry in HTML index",
      });
      continue;
    }

    catalog.push({
      id: stub.id,
      name: stub.name,
      aonId: matched?.aonId ?? null,
      aonUrl: matched?.url ?? null,
      summary: matched?.summary ?? "",
      level: matched?.level ?? null,
      traits: matched?.traits ?? [],
      matchedName: matched?.name ?? null,
      overlayId: stub.overlayId,
      preferPacketIds: stub.preferPacketIds,
      head: stub.head,
      actions: stub.actions,
      frequency: stub.frequency,
      effectClass: stub.effectClass,
      needsOffGuard: stub.needsOffGuard,
      needsRaisedShield: stub.needsRaisedShield,
      needsAdjacentFoe: stub.needsAdjacentFoe,
      needsReactionAvailable: stub.needsReactionAvailable,
      minActions: stub.minActions,
      maxMap: stub.maxMap,
      avoidThirdStrike: stub.avoidThirdStrike,
      scoreHint: stub.scoreHint,
    });
  }

  catalog.sort(
    (a, b) => (a.level ?? 99) - (b.level ?? 99) || a.name.localeCompare(b.name),
  );
  return { catalog, unmapped };
}

export function ingestFeatsFromHtml(opts: {
  fromPath: string;
  outDir: string;
}): IngestFeatsResult {
  const fromPath = path.resolve(opts.fromPath);
  const outDir = path.resolve(opts.outDir);

  if (!fs.existsSync(fromPath)) {
    throw new Error(
      `AoN HTML not found: ${fromPath}\nHint: npm run ingest-feats -- --from data/aon/Feats.aspx.html --fetch-elastic`,
    );
  }

  const html = fs.readFileSync(fromPath, "utf8");
  const index = parseAonFeatsHtml(html);
  if (index.length === 0) {
    throw new Error(`No Feats.aspx?ID entries found in ${fromPath}`);
  }

  const { catalog, unmapped } = buildFeatCatalog(index);
  fs.mkdirSync(outDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  const source = path.relative(process.cwd(), fromPath).replace(/\\/g, "/") || fromPath;

  const indexPath = path.join(outDir, "index.json");
  const catalogPath = path.join(outDir, "catalog.json");
  const unmappedPath = path.join(outDir, "unmapped.json");

  fs.writeFileSync(
    indexPath,
    `${JSON.stringify(
      {
        generatedAt,
        source,
        count: index.length,
        feats: index,
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
        source,
        count: catalog.length,
        note: "Combat-attempt feat stubs joined to AoN IDs. Runtime: shouldAttemptFeat gates Step 4.",
        feats: catalog,
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
        source,
        count: unmapped.length,
        stubs: unmapped,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    source,
    generatedAt,
    indexCount: index.length,
    catalogCount: catalog.length,
    unmappedCount: unmapped.length,
    indexPath,
    catalogPath,
    unmappedPath,
  };
}
