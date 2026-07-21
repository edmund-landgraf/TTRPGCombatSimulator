/**
 * Parse a saved Archives of Nethys Spells.aspx HTML shell into a spell ID index.
 * The page is a search result list (name + summary + ID), not full spell bodies.
 */

export type AonSpellCategory = "Cantrip" | "Focus" | "Spell";

export type AonSpellIndexEntry = {
  aonId: number;
  name: string;
  summary: string;
  category: AonSpellCategory;
  /** Rank band as listed under the category heading (1–10). */
  listedRank: number | null;
  heightenable: boolean;
  uncommon: boolean;
  rare: boolean;
  url: string;
};

const CATEGORY_RE = /<h1 class="title"><div>(Cantrip|Focus|Spell)<\/div>/g;
const RANK_RE = /<h2[^>]*><div>(\d+)(?:st|nd|rd|th)\s+rank<\/div>/gi;
const ENTRY_RE =
  /<a href="https:\/\/2e\.aonprd\.com\/Spells\.aspx\?ID=(\d+)">([^<]+)<\/a>(.*?)-\s*<p>(.*?)<\/p>/gs;

function parseListedRank(label: string | null): number | null {
  if (!label) return null;
  const m = label.match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

function stripHtmlNoise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function parseAonSpellsHtml(html: string): AonSpellIndexEntry[] {
  type Marker =
    | { kind: "category"; index: number; category: AonSpellCategory }
    | { kind: "rank"; index: number; label: string }
    | { kind: "entry"; index: number; end: number; aonId: number; name: string; meta: string; summary: string };

  const markers: Marker[] = [];

  for (const m of html.matchAll(CATEGORY_RE)) {
    markers.push({
      kind: "category",
      index: m.index ?? 0,
      category: m[1] as AonSpellCategory,
    });
  }

  for (const m of html.matchAll(RANK_RE)) {
    markers.push({
      kind: "rank",
      index: m.index ?? 0,
      label: `${m[1]}`,
    });
  }

  for (const m of html.matchAll(ENTRY_RE)) {
    markers.push({
      kind: "entry",
      index: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      aonId: Number(m[1]),
      name: stripHtmlNoise(m[2]!),
      meta: m[3] ?? "",
      summary: stripHtmlNoise(m[4] ?? ""),
    });
  }

  markers.sort((a, b) => a.index - b.index || (a.kind === "entry" ? 1 : -1));

  let category: AonSpellCategory = "Spell";
  let listedRank: number | null = null;
  const byId = new Map<number, AonSpellIndexEntry>();

  for (const marker of markers) {
    if (marker.kind === "category") {
      category = marker.category;
      listedRank = null;
      continue;
    }
    if (marker.kind === "rank") {
      listedRank = parseListedRank(marker.label);
      continue;
    }

    const existing = byId.get(marker.aonId);
    if (existing) continue;

    byId.set(marker.aonId, {
      aonId: marker.aonId,
      name: marker.name,
      summary: marker.summary,
      category,
      listedRank,
      heightenable: /title="Heightenable"/i.test(marker.meta),
      uncommon: /trait-uncommon/i.test(marker.meta),
      rare: /trait-rare/i.test(marker.meta),
      url: `https://2e.aonprd.com/Spells.aspx?ID=${marker.aonId}`,
    });
  }

  return [...byId.values()].sort((a, b) => a.aonId - b.aonId || a.name.localeCompare(b.name));
}
