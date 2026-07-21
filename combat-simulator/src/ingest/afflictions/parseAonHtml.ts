/**
 * Parse a saved AoN afflictions HTML shell (Diseases / Curses / Equipment links).
 */

export type AonAfflictionIndexEntry = {
  aonId: number;
  name: string;
  summary: string;
  url: string;
  sourcePage: "Diseases" | "Curses" | "Equipment" | "Afflictions" | "Other";
};

const ENTRY_RE =
  /<a href=["'](?:https:\/\/2e\.aonprd\.com\/)?(Diseases|Curses|Equipment|Afflictions)\.aspx\?ID=(\d+)["']>([^<]+)<\/a>(.*?)-\s*<p>(.*?)<\/p>/gs;

function strip(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function parseAonAfflictionsHtml(html: string): AonAfflictionIndexEntry[] {
  const byKey = new Map<string, AonAfflictionIndexEntry>();
  for (const m of html.matchAll(ENTRY_RE)) {
    const page = m[1] as AonAfflictionIndexEntry["sourcePage"];
    const aonId = Number(m[2]);
    const name = strip(m[3]!);
    const summary = strip(m[5] ?? "");
    const key = `${page}:${aonId}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      aonId,
      name,
      summary,
      url: `https://2e.aonprd.com/${page}.aspx?ID=${aonId}`,
      sourcePage: page,
    });
  }
  return [...byKey.values()].sort(
    (a, b) => a.aonId - b.aonId || a.name.localeCompare(b.name),
  );
}
