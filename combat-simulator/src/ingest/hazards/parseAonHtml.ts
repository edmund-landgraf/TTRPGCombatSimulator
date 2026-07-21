export type AonHazardIndexEntry = {
  aonId: number;
  name: string;
  summary: string;
  url: string;
};

const ENTRY_RE =
  /<a href=["'](?:https:\/\/2e\.aonprd\.com\/)?Hazards\.aspx\?ID=(\d+)["']>([^<]+)<\/a>(.*?)-\s*<p>(.*?)<\/p>/gs;

function strip(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function parseAonHazardsHtml(html: string): AonHazardIndexEntry[] {
  const byId = new Map<number, AonHazardIndexEntry>();
  for (const m of html.matchAll(ENTRY_RE)) {
    const aonId = Number(m[1]);
    if (byId.has(aonId)) continue;
    byId.set(aonId, {
      aonId,
      name: strip(m[2]!),
      summary: strip(m[4] ?? ""),
      url: `https://2e.aonprd.com/Hazards.aspx?ID=${aonId}`,
    });
  }
  return [...byId.values()].sort((a, b) => a.aonId - b.aonId);
}
