import fs from "node:fs";
import path from "node:path";
import { SpellSchema, type Spell } from "../../memory/schemas.js";
import { COMBAT_SPELL_STUBS, type CombatSpellStub } from "./combatStubs.js";
import { parseAonSpellsHtml, type AonSpellIndexEntry } from "./parseAonHtml.js";

export type SpellCatalogEntry = {
  aonId: number;
  aonUrl: string;
  summary: string;
  category: AonSpellIndexEntry["category"];
  listedRank: number | null;
  heightenable: boolean;
  /** Remaster / index name that matched. */
  matchedName: string;
  spell: Spell;
};

export type UnmappedStub = {
  id: string;
  name: string;
  matchNames: string[];
  reason: string;
};

export type IngestSpellsResult = {
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
  stub: CombatSpellStub,
  byName: Map<string, AonSpellIndexEntry>,
): AonSpellIndexEntry | undefined {
  for (const candidate of stub.matchNames) {
    const hit = byName.get(normalizeName(candidate));
    if (hit) return hit;
  }
  return undefined;
}

export function buildSpellCatalog(index: AonSpellIndexEntry[]): {
  catalog: SpellCatalogEntry[];
  unmapped: UnmappedStub[];
} {
  const byName = new Map<string, AonSpellIndexEntry>();
  for (const entry of index) {
    const key = normalizeName(entry.name);
    // Prefer Spell/Cantrip over Focus when duplicate display names exist.
    const prev = byName.get(key);
    if (!prev || (prev.category === "Focus" && entry.category !== "Focus")) {
      byName.set(key, entry);
    }
  }

  const catalog: SpellCatalogEntry[] = [];
  const unmapped: UnmappedStub[] = [];

  for (const stub of COMBAT_SPELL_STUBS) {
    const matched = findIndexMatch(stub, byName);
    if (!matched) {
      unmapped.push({
        id: stub.id,
        name: stub.name,
        matchNames: stub.matchNames,
        reason: "no matching Spells.aspx?ID entry in HTML index",
      });
      continue;
    }

    const parsed = SpellSchema.safeParse({
      id: stub.id,
      name: stub.name,
      ...stub.spell,
    });
    if (!parsed.success) {
      unmapped.push({
        id: stub.id,
        name: stub.name,
        matchNames: stub.matchNames,
        reason: `SpellSchema validation failed: ${parsed.error.message}`,
      });
      continue;
    }

    catalog.push({
      aonId: matched.aonId,
      aonUrl: matched.url,
      summary: matched.summary,
      category: matched.category,
      listedRank: matched.listedRank,
      heightenable: matched.heightenable,
      matchedName: matched.name,
      spell: parsed.data,
    });
  }

  catalog.sort((a, b) => a.spell.rank - b.spell.rank || a.spell.name.localeCompare(b.spell.name));
  return { catalog, unmapped };
}

export function ingestSpellsFromHtml(opts: {
  fromPath: string;
  outDir: string;
}): IngestSpellsResult {
  const fromPath = path.resolve(opts.fromPath);
  const outDir = path.resolve(opts.outDir);

  if (!fs.existsSync(fromPath)) {
    throw new Error(`AoN HTML not found: ${fromPath}`);
  }

  const html = fs.readFileSync(fromPath, "utf8");
  const index = parseAonSpellsHtml(html);
  if (index.length === 0) {
    throw new Error(`No Spells.aspx?ID entries found in ${fromPath}`);
  }

  const { catalog, unmapped } = buildSpellCatalog(index);
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
        spells: index,
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
        note: "Combat-ready SpellSchema stubs joined to AoN IDs. Override attackBonus/saveDc per caster.",
        spells: catalog,
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
