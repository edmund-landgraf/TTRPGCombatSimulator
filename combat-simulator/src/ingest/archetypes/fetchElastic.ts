/**
 * Fetch AoN archetype dedications from Elasticsearch.
 */

export type ElasticArchetypeHit = {
  aonId: number;
  name: string;
  summary: string;
  level: number | null;
  prerequisites: string | null;
  traits: string[];
  url: string;
};

const ELASTIC_URL = "https://elasticsearch.aonprd.com/aon/_search";
const QUERY = "category:archetype -trait:mythic";

async function searchPage(from: number, size: number): Promise<{
  total: number;
  hits: ElasticArchetypeHit[];
}> {
  const body = {
    from,
    size,
    track_total_hits: true,
    query: { query_string: { query: QUERY } },
    _source: ["name", "level", "summary", "url", "trait", "prerequisite"],
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
          prerequisite?: string;
        };
      }>;
    };
  };
  const total =
    typeof data.hits.total === "number" ? data.hits.total : data.hits.total.value;
  const hits: ElasticArchetypeHit[] = [];
  for (const h of data.hits.hits) {
    const src = h._source ?? {};
    const url = src.url ?? "";
    const m = url.match(/ID=(\d+)/i);
    if (!m || !src.name) continue;
    hits.push({
      aonId: Number(m[1]),
      name: src.name,
      summary: (src.summary ?? "").replace(/\s+/g, " ").trim(),
      level: typeof src.level === "number" ? src.level : null,
      prerequisites: src.prerequisite ?? null,
      traits: Array.isArray(src.trait) ? src.trait : [],
      url: url.startsWith("http") ? url : `https://2e.aonprd.com${url}`,
    });
  }
  return { total, hits };
}

export async function fetchElasticArchetypes(): Promise<ElasticArchetypeHit[]> {
  const pageSize = 1000;
  const first = await searchPage(0, pageSize);
  const out = [...first.hits];
  for (let from = pageSize; from < first.total; from += pageSize) {
    out.push(...(await searchPage(from, pageSize)).hits);
  }
  const byId = new Map<number, ElasticArchetypeHit>();
  for (const h of out) {
    if (!byId.has(h.aonId)) byId.set(h.aonId, h);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function elasticArchetypesToHtml(hits: ElasticArchetypeHit[]): string {
  const parts = [
    "<!DOCTYPE html>",
    "<!-- bootstrapped from elasticsearch category:archetype -trait:mythic -->",
    '<html><head><meta charset="UTF-8"><title>Archetypes</title></head><body>',
    `<h1 class="title"><div>Archetype</div><div>${hits.length}/${hits.length}</div></h1>`,
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
