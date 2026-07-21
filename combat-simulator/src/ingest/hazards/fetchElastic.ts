/**
 * Fetch AoN hazard docs from Elasticsearch (category:hazard).
 */

export type ElasticHazardHit = {
  aonId: number;
  name: string;
  summary: string;
  level: number | null;
  complexity: string | null;
  hazardType: string | null;
  stealth: string | null;
  disable: string | null;
  traits: string[];
  url: string;
};

const ELASTIC_URL = "https://elasticsearch.aonprd.com/aon/_search";
/** Full hazard index; UI "General" filters vary (~109). */
const QUERY = "category:hazard -trait:mythic";

async function searchPage(from: number, size: number): Promise<{
  total: number;
  hits: ElasticHazardHit[];
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
      "complexity",
      "hazard_type",
      "stealth",
      "disable",
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
          complexity?: string;
          hazard_type?: string;
          stealth?: string;
          disable?: string;
        };
      }>;
    };
  };
  const total =
    typeof data.hits.total === "number" ? data.hits.total : data.hits.total.value;
  const hits: ElasticHazardHit[] = [];
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
      complexity: src.complexity ?? null,
      hazardType: src.hazard_type ?? null,
      stealth: src.stealth ?? null,
      disable: src.disable ?? null,
      traits: Array.isArray(src.trait) ? src.trait : [],
      url: url.startsWith("http") ? url : `https://2e.aonprd.com${url}`,
    });
  }
  return { total, hits };
}

export async function fetchElasticHazards(): Promise<ElasticHazardHit[]> {
  const pageSize = 1000;
  const first = await searchPage(0, pageSize);
  const out = [...first.hits];
  for (let from = pageSize; from < first.total; from += pageSize) {
    out.push(...(await searchPage(from, pageSize)).hits);
  }
  const byId = new Map<number, ElasticHazardHit>();
  for (const h of out) {
    if (!byId.has(h.aonId)) byId.set(h.aonId, h);
  }
  return [...byId.values()].sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.name.localeCompare(b.name));
}

export function elasticHazardsToHtml(hits: ElasticHazardHit[]): string {
  const parts = [
    "<!DOCTYPE html>",
    "<!-- bootstrapped from elasticsearch category:hazard -trait:mythic -->",
    '<html><head><meta charset="UTF-8"><title>Hazards</title></head><body>',
    `<h1 class="title"><div>Hazard</div><div>${hits.length}/${hits.length}</div></h1>`,
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

export function parseDc(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const m = text.match(/DC\s*(\d+)/i);
  return m ? Number(m[1]) : undefined;
}

export function parseDisableSkill(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const m = text.match(/^([A-Za-z ]+?)\s+DC/i);
  return m ? m[1]!.trim() : undefined;
}
