/**
 * Fetch AoN affliction-tagged docs (poisons, diseases, curses) from Elasticsearch.
 */
import {
  inferKind,
  parseMaxDurationRounds,
  parseSaveDc,
  parseStageText,
} from "./parseStageText.js";

export type ElasticAfflictionHit = {
  aonId: number;
  name: string;
  summary: string;
  level: number | null;
  traits: string[];
  category: string;
  kind: "poison" | "disease" | "curse" | "other";
  saveDc: number | null;
  maxDurationRounds?: number;
  stagesRaw: string[];
  url: string;
  virulent: boolean;
};

const ELASTIC_URL = "https://elasticsearch.aonprd.com/aon/_search";
/** Affliction trait_group covers equipment poisons + diseases + curses. */
const QUERY = "trait_group:Affliction AND NOT exclude_from_search:true";

async function searchPage(from: number, size: number): Promise<{
  total: number;
  hits: ElasticAfflictionHit[];
}> {
  const body = {
    from,
    size,
    track_total_hits: true,
    query: { query_string: { query: QUERY } },
    _source: [
      "name",
      "level",
      "summary",
      "url",
      "trait",
      "category",
      "stage",
      "saving_throw",
      "duration_raw",
      "duration",
    ],
  };
  const res = await fetch(ELASTIC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Elastic search failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    hits: {
      total: { value: number } | number;
      hits: Array<{
        _source?: {
          name?: string;
          level?: number;
          summary?: string;
          url?: string;
          trait?: string[];
          category?: string;
          stage?: string[];
          saving_throw?: string;
          duration_raw?: string;
          duration?: number;
        };
      }>;
    };
  };
  const total =
    typeof data.hits.total === "number" ? data.hits.total : data.hits.total.value;
  const hits: ElasticAfflictionHit[] = [];
  for (const h of data.hits.hits) {
    const src = h._source ?? {};
    const url = src.url ?? "";
    const m = url.match(/ID=(\d+)/i);
    if (!m || !src.name) continue;
    const traits = Array.isArray(src.trait) ? src.trait : [];
    const category = src.category ?? "";
    const summary = (src.summary ?? "").replace(/\s+/g, " ").trim();
    const stagesRaw = Array.isArray(src.stage) ? src.stage : [];
    hits.push({
      aonId: Number(m[1]),
      name: src.name,
      summary,
      level: typeof src.level === "number" ? src.level : null,
      traits,
      category,
      kind: inferKind(traits, category),
      saveDc: parseSaveDc(src.saving_throw) ?? parseSaveDc(summary),
      maxDurationRounds: parseMaxDurationRounds(
        src.duration_raw ?? (src.duration != null ? String(src.duration) : undefined),
        summary,
      ),
      stagesRaw,
      url: url.startsWith("http") ? url : `https://2e.aonprd.com${url}`,
      virulent: traits.some((t) => /virulent/i.test(t)),
    });
  }
  return { total, hits };
}

export async function fetchElasticAfflictions(): Promise<ElasticAfflictionHit[]> {
  const pageSize = 1000;
  const first = await searchPage(0, pageSize);
  const out = [...first.hits];
  for (let from = pageSize; from < first.total; from += pageSize) {
    const page = await searchPage(from, pageSize);
    out.push(...page.hits);
  }
  // Prefer Equipment/Diseases/Curses URLs; dedupe by name keeping highest aonId (remaster).
  const byName = new Map<string, ElasticAfflictionHit>();
  for (const hit of out) {
    const key = hit.name.toLowerCase();
    const prev = byName.get(key);
    if (!prev || hit.aonId > prev.aonId) byName.set(key, hit);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Minimal HTML shell so --from Afflictions.html works offline after bootstrap. */
export function elasticAfflictionsToHtml(hits: ElasticAfflictionHit[]): string {
  const parts = [
    "<!DOCTYPE html>",
    "<!-- bootstrapped from elasticsearch trait_group:Affliction -->",
    "<html><head><meta charset=\"UTF-8\"><title>Afflictions</title></head><body>",
    `<h1 class="title"><div>Affliction</div><div>${hits.length}/${hits.length}</div></h1>`,
  ];
  for (const h of hits) {
    parts.push(
      `<div class="inline"><a href="${h.url}">${escapeHtml(h.name)}</a> - <p>${escapeHtml(h.summary)}</p></div>`,
    );
  }
  parts.push("</body></html>");
  return parts.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export { parseStageText };
