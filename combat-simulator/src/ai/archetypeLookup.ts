/**
 * Runtime archetype catalog lookup + tag normalization for buildProfile.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Archetype } from "../memory/schemas.js";
import {
  COMBAT_ARCHETYPE_STUBS,
  type CombatArchetypeStub,
} from "../ingest/archetypes/combatStubs.js";

/** Overlay shape compatible with feat-archetype-overlays / buildProfile.FeatOverlay. */
export type ArchetypeOverlay = {
  kind: string;
  priorityBonus?: number;
  preferPacketIds?: string[];
  scoreHints?: Record<string, number>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "../..");

let cachedCatalog: Archetype[] | null = null;

function stubToArchetype(stub: CombatArchetypeStub): Archetype {
  return {
    id: stub.id,
    name: stub.name,
    kind: stub.kind,
    dedicationLevel: stub.dedicationLevel,
    overlayId: stub.overlayId,
    grantCapabilities: stub.grantCapabilities ?? [],
    preferPacketIds: stub.preferPacketIds ?? [],
    scoreHints: stub.scoreHints ?? {},
    roleHint: stub.roleHint,
    summary: stub.summary,
  };
}

/** Load data/archetypes/catalog.json, or fall back to in-source combat stubs. */
export function loadArchetypeCatalog(forceReload = false): Archetype[] {
  if (cachedCatalog && !forceReload) return cachedCatalog;

  const candidates = [
    path.join(process.cwd(), "data", "archetypes", "catalog.json"),
    path.join(PACKAGE_ROOT, "data", "archetypes", "catalog.json"),
  ];

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as {
        archetypes?: Archetype[];
      };
      if (Array.isArray(raw.archetypes) && raw.archetypes.length > 0) {
        cachedCatalog = raw.archetypes;
        return cachedCatalog;
      }
    } catch {
      /* try next */
    }
  }

  cachedCatalog = COMBAT_ARCHETYPE_STUBS.map(stubToArchetype);
  return cachedCatalog;
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

/** Resolve a tag or display name to a catalog entry. */
export function lookupArchetype(tagOrName: string): Archetype | undefined {
  const catalog = loadArchetypeCatalog();
  const key = normalizeKey(tagOrName);
  const slug = key.replace(/\s+/g, "_");

  for (const a of catalog) {
    if (a.id === tagOrName || normalizeKey(a.id) === key || a.id === slug) {
      return a;
    }
    if (normalizeKey(a.name) === key) return a;
  }

  for (const stub of COMBAT_ARCHETYPE_STUBS) {
    if (stub.matchNames.some((n) => normalizeKey(n) === key)) {
      return catalog.find((a) => a.id === stub.id) ?? stubToArchetype(stub);
    }
  }
  return undefined;
}

export type ResolvedArchetypes = {
  /** Normalized catalog ids (e.g. champion_dedication, archer). */
  tags: string[];
  /** Capability tags granted by dedications. */
  grantCapabilities: string[];
  entries: Archetype[];
};

/** Expand actor.archetypes[] (ids or AoN names) into catalog tags + grants. */
export function resolveArchetypesForActor(tags: string[]): ResolvedArchetypes {
  const seen = new Set<string>();
  const entries: Archetype[] = [];
  const grantCapabilities: string[] = [];
  const outTags: string[] = [];

  for (const raw of tags) {
    const entry = lookupArchetype(raw);
    if (entry) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        outTags.push(entry.id);
        entries.push(entry);
        for (const c of entry.grantCapabilities) {
          if (!grantCapabilities.includes(c)) grantCapabilities.push(c);
        }
      }
      continue;
    }
    // Pass through unknown tags (fixtures may use custom overlays).
    const pass = raw.trim();
    if (pass && !seen.has(pass)) {
      seen.add(pass);
      outTags.push(pass);
    }
  }

  return { tags: outTags, grantCapabilities, entries };
}

/** Build a synthetic overlay from a catalog archetype (when not in JSON). */
export function archetypeToOverlay(entry: Archetype): ArchetypeOverlay | null {
  const hasHints =
    Object.keys(entry.scoreHints ?? {}).length > 0 ||
    (entry.preferPacketIds?.length ?? 0) > 0;
  if (!hasHints && !entry.overlayId) return null;
  return {
    kind: "archetype",
    priorityBonus: entry.kind === "multiclass" ? 1 : 0,
    preferPacketIds: entry.preferPacketIds?.length
      ? entry.preferPacketIds
      : undefined,
    scoreHints:
      Object.keys(entry.scoreHints ?? {}).length > 0
        ? entry.scoreHints
        : undefined,
  };
}
