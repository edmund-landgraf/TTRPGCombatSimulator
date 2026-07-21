/**
 * Parse a saved Archives of Nethys Feats.aspx HTML shell into a feat ID index.
 * The page is a search result list (name + summary + ID), not full feat bodies.
 */

export type AonFeatIndexEntry = {
  aonId: number;
  name: string;
  summary: string;
  /** Feat level band as listed (1–20), when present. */
  level: number | null;
  uncommon: boolean;
  rare: boolean;
  traits: string[];
  url: string;
};

const LEVEL_RE =
  /<h2[^>]*><div>(?:Level\s+)?(\d+)(?:st|nd|rd|th)?(?:\s+level)?<\/div>/gi;
const ENTRY_RE =
  /<a href="https:\/\/2e\.aonprd\.com\/Feats\.aspx\?ID=(\d+)">([^<]+)<\/a>(.*?)-\s*<p>(.*?)<\/p>/gs;
const TRAIT_RE = /title="([^"]+)"[^>]*class="[^"]*trait[^"]*"/gi;
const TRAIT_RE_ALT = /class="[^"]*trait[^"]*"[^>]*title="([^"]+)"/gi;

function stripHtmlNoise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function extractTraits(meta: string): string[] {
  const traits = new Set<string>();
  for (const re of [TRAIT_RE, TRAIT_RE_ALT]) {
    re.lastIndex = 0;
    for (const m of meta.matchAll(re)) {
      const t = stripHtmlNoise(m[1] ?? "");
      if (t && t !== "Heightenable") traits.add(t);
    }
  }
  return [...traits];
}

export function parseAonFeatsHtml(html: string): AonFeatIndexEntry[] {
  type Marker =
    | { kind: "level"; index: number; level: number }
    | {
        kind: "entry";
        index: number;
        aonId: number;
        name: string;
        meta: string;
        summary: string;
      };

  const markers: Marker[] = [];

  for (const m of html.matchAll(LEVEL_RE)) {
    markers.push({
      kind: "level",
      index: m.index ?? 0,
      level: Number(m[1]),
    });
  }

  for (const m of html.matchAll(ENTRY_RE)) {
    markers.push({
      kind: "entry",
      index: m.index ?? 0,
      aonId: Number(m[1]),
      name: stripHtmlNoise(m[2]!),
      meta: m[3] ?? "",
      summary: stripHtmlNoise(m[4] ?? ""),
    });
  }

  // Also accept relative hrefs / single-quoted links from some saves.
  const loose =
    /<a href=['"](?:https:\/\/2e\.aonprd\.com\/)?Feats\.aspx\?ID=(\d+)['"]>([^<]+)<\/a>(.*?)-\s*<p>(.*?)<\/p>/gs;
  for (const m of html.matchAll(loose)) {
    markers.push({
      kind: "entry",
      index: m.index ?? 0,
      aonId: Number(m[1]),
      name: stripHtmlNoise(m[2]!),
      meta: m[3] ?? "",
      summary: stripHtmlNoise(m[4] ?? ""),
    });
  }

  markers.sort((a, b) => a.index - b.index || (a.kind === "entry" ? 1 : -1));

  let level: number | null = null;
  const byId = new Map<number, AonFeatIndexEntry>();

  for (const marker of markers) {
    if (marker.kind === "level") {
      level = marker.level;
      continue;
    }
    if (byId.has(marker.aonId)) continue;
    byId.set(marker.aonId, {
      aonId: marker.aonId,
      name: marker.name,
      summary: marker.summary,
      level,
      uncommon: /trait-uncommon/i.test(marker.meta),
      rare: /trait-rare/i.test(marker.meta),
      traits: extractTraits(marker.meta),
      url: `https://2e.aonprd.com/Feats.aspx?ID=${marker.aonId}`,
    });
  }

  return [...byId.values()].sort(
    (a, b) => a.aonId - b.aonId || a.name.localeCompare(b.name),
  );
}
