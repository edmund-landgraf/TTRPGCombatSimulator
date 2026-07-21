/**
 * Bootstrap a Feats.aspx-style HTML list from AoN's public Elasticsearch index.
 * Used when a saved browser HTML is not yet available.
 */

export type ElasticFeatHit = {
  aonId: number;
  name: string;
  summary: string;
  level: number | null;
  traits: string[];
  url: string;
};

const ELASTIC_URL = "https://elasticsearch.aonprd.com/aon/_search";
const QUERY = "category:feat -trait:mythic";

async function searchPage(from: number, size: number): Promise<{
  total: number;
  hits: ElasticFeatHit[];
}> {
  const body = {
    from,
    size,
    track_total_hits: true,
    query: { query_string: { query: QUERY } },
    _source: ["name", "level", "summary", "url", "trait"],
  };
  const res = await fetch(ELASTIC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Elastic search failed: HTTP ${res.status}`);
  }
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
        };
      }>;
    };
  };
  const total =
    typeof data.hits.total === "number" ? data.hits.total : data.hits.total.value;
  const hits: ElasticFeatHit[] = [];
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
      traits: Array.isArray(src.trait) ? src.trait : [],
      url: url.startsWith("http") ? url : `https://2e.aonprd.com${url}`,
    });
  }
  return { total, hits };
}

/** Fetch all feats matching the AoN Feats.aspx fixed query. */
export async function fetchElasticFeats(): Promise<ElasticFeatHit[]> {
  const pageSize = 1000;
  const first = await searchPage(0, pageSize);
  const out = [...first.hits];
  for (let from = pageSize; from < first.total; from += pageSize) {
    const page = await searchPage(from, pageSize);
    out.push(...page.hits);
  }
  const byId = new Map<number, ElasticFeatHit>();
  for (const hit of out) {
    if (!byId.has(hit.aonId)) byId.set(hit.aonId, hit);
  }
  return [...byId.values()].sort((a, b) => a.aonId - b.aonId);
}

/** Render Elastic hits as a Spells-list-compatible HTML shell for parseAonFeatsHtml. */
export function elasticFeatsToHtml(feats: ElasticFeatHit[]): string {
  const byLevel = new Map<number | "unknown", ElasticFeatHit[]>();
  for (const f of feats) {
    const key = f.level ?? "unknown";
    const list = byLevel.get(key) ?? [];
    list.push(f);
    byLevel.set(key, list);
  }
  const levels = [...byLevel.keys()].sort((a, b) => {
    if (a === "unknown") return 1;
    if (b === "unknown") return -1;
    return a - b;
  });

  const parts: string[] = [
    "<!DOCTYPE html>",
    "<!-- saved from url=(0032)https://2e.aonprd.com/Feats.aspx -->",
    "<!-- bootstrapped from elasticsearch.aonprd.com category:feat -trait:mythic -->",
    '<html lang="en"><head><meta charset="UTF-8"><title>Feats - Archives of Nethys</title></head><body>',
    `<h1 class="title"><div>Feat</div><div class="row"><div>${feats.length}/${feats.length}</div></div></h1>`,
  ];

  for (const level of levels) {
    const list = byLevel.get(level) ?? [];
    const label = level === "unknown" ? "Unknown level" : `${level}`;
    parts.push(`<h2><div>${label}</div><div class="row"><div>${list.length}/${list.length}</div></div></h2>`);
    parts.push('<div class="column gap-small">');
    for (const f of list) {
      const traitHtml = f.traits
        .map(
          (t) =>
            `<div class="trait traitbadge" title="${escapeHtml(t)}">${escapeHtml(t.slice(0, 1))}</div>`,
        )
        .join("");
      parts.push(
        `<div class="inline"><a href="${escapeHtml(f.url)}">${escapeHtml(f.name)}</a> ${traitHtml} - <p>${escapeHtml(f.summary)}</p></div>`,
      );
    }
    parts.push("</div>");
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
