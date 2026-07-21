/**
 * Dark dashboard HTML for loop / batch analysis — matches the batch10 canvas layout:
 * KPI strip → status callout → outcomes table → charts → rejects → notable fights.
 */

export type PrettyRunRow = {
  id: number;
  seed: number;
  notes: string;
  rounds: number;
  partyAlive: number;
  partyDmg: number;
  enemyDmg: number;
  hitRate: number;
  /** e.g. "F15 W14 R12 C15" */
  partyHp: string;
  winner?: string;
  endReason?: string;
};

export type PrettyReject = {
  skill: string;
  count: number;
};

export type PrettyNotable = {
  seed: number | string;
  takeaway: string;
};

export type PrettyBatchReport = {
  title: string;
  subtitle: string;
  generatedAt: string;
  runs: PrettyRunRow[];
  rejects?: PrettyReject[];
  rejectSource?: string;
  notables?: PrettyNotable[];
  footer?: string;
  /** Extra veto count override (defaults to sum of rejects). */
  totalRejects?: number;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatPartyHpShort(partyHp: Record<string, string> | undefined): string {
  if (!partyHp) return "—";
  const order = ["FTR", "WIZ", "ROG", "CLR", "CHP"];
  const abbr: Record<string, string> = {
    FTR: "F",
    WIZ: "W",
    ROG: "R",
    CLR: "C",
    CHP: "C",
  };
  const parts: string[] = [];
  for (const id of order) {
    const v = partyHp[id];
    if (!v) continue;
    const cur = v.split("/")[0]?.replace("↓", "") ?? "?";
    parts.push(`${abbr[id] ?? id[0]}${cur}`);
  }
  if (parts.length) return parts.join(" ");
  return Object.entries(partyHp)
    .map(([id, v]) => `${id[0]}${v.split("/")[0]?.replace("↓", "") ?? "?"}`)
    .join(" ");
}

export function partyHpFromSummary(partyHp: Record<string, string> | undefined): string {
  return formatPartyHpShort(partyHp);
}

/** Shared dark-dashboard stylesheet (batch10 canvas look). */
export function prettyReportCss(): string {
  return `
:root {
  --bg: #121212; --panel: #1a1a1a; --border: #2a2a2a; --text: #f0f0f0;
  --muted: #9a9a9a; --ok: #4ade80; --warn: #f59e0b; --danger: #f87171;
  --info: #7dd3fc; --accent: #e5e5e5;
  --font: "Segoe UI", "IBM Plex Sans", system-ui, sans-serif;
  --mono: "IBM Plex Mono", "Consolas", monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: var(--font); padding: 1.5rem 1.75rem 2.5rem;
  max-width: 1100px;
}
h1 { margin: 0 0 0.35rem; font-size: 1.55rem; font-weight: 700; letter-spacing: -0.02em; }
h2 { margin: 1.75rem 0 0.75rem; font-size: 1.15rem; font-weight: 650; color: var(--accent); }
h3 { margin: 0 0 0.55rem; font-size: 0.92rem; color: var(--muted); font-weight: 600; }
.sub { color: var(--muted); font-size: 0.85rem; margin: 0 0 1.35rem; line-height: 1.45; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.85rem; margin-bottom: 1.1rem; }
.stat { padding: 0.15rem 0; }
.stat .v { font-size: 1.75rem; font-weight: 700; line-height: 1.15; letter-spacing: -0.02em; }
.stat .v.ok { color: var(--ok); }
.stat .v.warn { color: var(--warn); }
.stat .v.danger { color: var(--danger); }
.stat .l { color: var(--muted); font-size: 0.8rem; margin-top: 0.3rem; }
.callout {
  border-left: 3px solid var(--ok); padding: 0.65rem 0 0.65rem 0.9rem;
  margin: 0.25rem 0 1.25rem; color: #d4d4d4; font-size: 0.92rem; line-height: 1.5;
}
.callout.warn { border-left-color: var(--warn); }
.callout.danger { border-left-color: var(--danger); }
.callout .title { color: var(--ok); font-weight: 700; margin-bottom: 0.25rem; }
.callout.warn .title { color: var(--warn); }
.callout.danger .title { color: var(--danger); }
.table-wrap { overflow-x: auto; margin-bottom: 0.5rem; }
table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
th, td { padding: 0.5rem 0.6rem; text-align: left; border-bottom: 1px solid var(--border); }
th {
  color: var(--muted); font-weight: 600; font-size: 0.72rem;
  text-transform: uppercase; letter-spacing: 0.04em;
}
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tbody tr.warn td:first-child { position: relative; padding-left: 1.1rem; }
tbody tr.warn td:first-child::before {
  content: ""; position: absolute; left: 0.2rem; top: 50%; transform: translateY(-50%);
  width: 6px; height: 6px; border-radius: 50%; background: var(--warn);
}
.charts { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; margin-top: 1.35rem; }
.chart-note { color: var(--muted); font-size: 0.8rem; margin: 0.45rem 0 0; line-height: 1.4; }
.legend { display: flex; gap: 1rem; margin-top: 0.4rem; font-size: 0.78rem; color: var(--muted); }
.legend span::before {
  content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%;
  margin-right: 0.35rem; vertical-align: middle;
}
.legend .party::before { background: var(--ok); }
.legend .enemy::before { background: var(--danger); }
.divider { border: none; border-top: 1px solid var(--border); margin: 1.75rem 0; }
.reject-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; align-items: start; }
.footer { margin-top: 1.75rem; color: var(--muted); font-size: 0.78rem; line-height: 1.45; }
@media (max-width: 900px) {
  .stats, .charts, .reject-grid { grid-template-columns: 1fr; }
}
`.trim();
}

function barChartSvg(
  values: number[],
  labels: string[],
  color: string,
  opts?: { height?: number; width?: number },
): string {
  const w = opts?.width ?? 420;
  const h = opts?.height ?? 200;
  const pad = { t: 24, r: 12, b: 36, l: 36 };
  const max = Math.max(...values, 1);
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const gap = 10;
  const n = Math.max(values.length, 1);
  const barW = Math.max(8, (innerW - gap * (n - 1)) / n);
  const baseline = pad.t + innerH;
  const ticks = [0, 0.5, 1];
  const grid = ticks
    .map((f) => {
      const y = pad.t + innerH * (1 - f);
      const label = Math.round(max * f);
      return `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="#2a2a2a" stroke-width="1"/>
        <text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" fill="#9a9a9a" font-size="10">${label}</text>`;
    })
    .join("");
  const bars = values
    .map((v, i) => {
      const bh = Math.max((v / max) * innerH, v > 0 ? 2 : 0);
      const x = pad.l + i * (barW + gap);
      const y = baseline - bh;
      const showLabel = n <= 12 || i % Math.ceil(n / 8) === 0 || i === n - 1;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" fill="${color}" rx="2"/>
        ${showLabel ? `<text x="${x + barW / 2}" y="${h - 12}" text-anchor="middle" fill="#9a9a9a" font-size="10">${escapeHtml(labels[i] ?? "")}</text>` : ""}`;
    })
    .join("\n");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img">${grid}
    <line x1="${pad.l}" y1="${baseline}" x2="${w - pad.r}" y2="${baseline}" stroke="#3a3a3a" stroke-width="1.5"/>
    ${bars}</svg>`;
}

function groupedBarChartSvg(
  categories: string[],
  series: { name: string; data: number[]; color: string }[],
  opts?: { height?: number; width?: number },
): string {
  const w = opts?.width ?? 420;
  const h = opts?.height ?? 200;
  const pad = { t: 24, r: 12, b: 36, l: 36 };
  const all = series.flatMap((s) => s.data);
  const max = Math.max(...all, 1);
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const n = Math.max(categories.length, 1);
  const groupGap = 8;
  const groupW = (innerW - groupGap * (n - 1)) / n;
  const barGap = 2;
  const barW = Math.max(4, (groupW - barGap * (series.length - 1)) / series.length);
  const baseline = pad.t + innerH;
  const ticks = [0, 0.5, 1];
  const grid = ticks
    .map((f) => {
      const y = pad.t + innerH * (1 - f);
      const label = Math.round(max * f);
      return `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="#2a2a2a" stroke-width="1"/>
        <text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" fill="#9a9a9a" font-size="10">${label}</text>`;
    })
    .join("");
  const bars = categories
    .map((_, i) => {
      const gx = pad.l + i * (groupW + groupGap);
      const rects = series
        .map((s, si) => {
          const v = s.data[i] ?? 0;
          const bh = Math.max((v / max) * innerH, v > 0 ? 2 : 0);
          const x = gx + si * (barW + barGap);
          const y = baseline - bh;
          return `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" fill="${s.color}" rx="2"/>`;
        })
        .join("");
      const showLabel = n <= 12 || i % Math.ceil(n / 8) === 0 || i === n - 1;
      return `${rects}${
        showLabel
          ? `<text x="${gx + groupW / 2}" y="${h - 12}" text-anchor="middle" fill="#9a9a9a" font-size="10">${escapeHtml(categories[i] ?? "")}</text>`
          : ""
      }`;
    })
    .join("\n");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img">${grid}
    <line x1="${pad.l}" y1="${baseline}" x2="${w - pad.r}" y2="${baseline}" stroke="#3a3a3a" stroke-width="1.5"/>
    ${bars}</svg>`;
}

function horizontalBarChartSvg(
  labels: string[],
  values: number[],
  color: string,
  opts?: { height?: number; width?: number },
): string {
  const w = opts?.width ?? 420;
  const h = opts?.height ?? Math.max(160, labels.length * 36 + 24);
  const pad = { t: 8, r: 40, b: 8, l: 120 };
  const max = Math.max(...values, 1);
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const n = Math.max(labels.length, 1);
  const rowH = innerH / n;
  const rows = values
    .map((v, i) => {
      const bw = Math.max((v / max) * innerW, v > 0 ? 2 : 0);
      const y = pad.t + i * rowH + rowH * 0.2;
      const bh = rowH * 0.55;
      return `<text x="${pad.l - 8}" y="${y + bh * 0.75}" text-anchor="end" fill="#d4d4d4" font-size="11">${escapeHtml(labels[i] ?? "")}</text>
        <rect x="${pad.l}" y="${y}" width="${bw}" height="${bh}" fill="${color}" rx="2"/>
        <text x="${pad.l + bw + 6}" y="${y + bh * 0.75}" fill="#9a9a9a" font-size="11">${v}</text>`;
    })
    .join("\n");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img">${rows}</svg>`;
}

function buildCallout(runs: PrettyRunRow[]): { tone: string; title: string; body: string } {
  const partyWins = runs.filter((r) => (r.winner ?? "party") === "party").length;
  const allParty = partyWins === runs.length;
  const roundCaps = runs.filter((r) => (r.endReason ?? "").toLowerCase().includes("round")).length;
  const errs = 0;
  if (allParty && roundCaps === 0 && errs === 0) {
    return {
      tone: "",
      title: "Clean batch",
      body: `Every encounter ended with enemies defeated. No round-cap draws.${
        runs.length ? " Director-note tactics were active across the seed set." : ""
      }`,
    };
  }
  if (!allParty) {
    return {
      tone: "warn",
      title: "Mixed batch",
      body: `Party won ${partyWins}/${runs.length}. Review bloody or lost seeds below.`,
    };
  }
  return {
    tone: "warn",
    title: "Batch complete",
    body: `${partyWins}/${runs.length} party wins. Check highlighted rows for survivors ≤2.`,
  };
}

function buildNotables(runs: PrettyRunRow[]): PrettyNotable[] {
  if (!runs.length) return [];
  const byDamage = [...runs].sort((a, b) => b.partyDmg - a.partyDmg);
  const byEnemy = [...runs].sort((a, b) => b.enemyDmg - a.enemyDmg);
  const byAlive = [...runs].sort((a, b) => a.partyAlive - b.partyAlive || b.rounds - a.rounds);
  const efficient = [...runs]
    .filter((r) => r.partyAlive >= 4)
    .sort((a, b) => b.partyDmg / Math.max(b.enemyDmg, 1) - a.partyDmg / Math.max(a.enemyDmg, 1));

  const out: PrettyNotable[] = [];
  const seen = new Set<number>();
  const push = (r: PrettyRunRow | undefined, takeaway: string) => {
    if (!r || seen.has(r.seed)) return;
    seen.add(r.seed);
    out.push({ seed: r.seed, takeaway });
  };

  const bloody = byAlive[0];
  if (bloody && bloody.partyAlive <= 2) {
    push(
      bloody,
      `${bloody.notes || "default"} stretched / bled the fight; ${bloody.partyAlive} survivor${bloody.partyAlive === 1 ? "" : "s"} (enemy dmg ${bloody.enemyDmg}${bloody.enemyDmg > bloody.partyDmg ? ` > party ${bloody.partyDmg}` : ""}).`,
    );
  }
  const topOff = byDamage[0];
  if (topOff) {
    push(
      topOff,
      `Highest party damage (${topOff.partyDmg})${topOff.partyAlive >= 4 ? "; full party alive — strong offensive note." : "."}`,
    );
  }
  const topEnemy = byEnemy[0];
  if (topEnemy && topEnemy.seed !== topOff?.seed) {
    push(
      topEnemy,
      `${topEnemy.notes || "default"} took most enemy damage (${topEnemy.enemyDmg})${topEnemy.partyAlive < 4 ? "; party incomplete." : "."}`,
    );
  }
  const tidy = efficient[0];
  if (tidy) {
    push(
      tidy,
      `Clean efficiency among high-damage wins: ${tidy.partyDmg} party / ${tidy.enemyDmg} enemy, ${tidy.partyAlive} alive.`,
    );
  }
  return out.slice(0, 5);
}

function chartCaptions(runs: PrettyRunRow[]): { rounds: string; damage: string } {
  if (!runs.length) return { rounds: "", damage: "" };
  const fastest = [...runs].sort((a, b) => a.rounds - b.rounds || a.seed - b.seed)[0]!;
  const longest = [...runs].sort((a, b) => b.rounds - a.rounds || a.partyAlive - b.partyAlive)[0]!;
  const tidy = [...runs]
    .filter((r) => r.partyAlive >= 4)
    .sort((a, b) => b.partyDmg / Math.max(b.enemyDmg, 1) - a.partyDmg / Math.max(a.enemyDmg, 1))
    .slice(0, 2);
  return {
    rounds: `Fastest: seed ${fastest.seed} (${fastest.rounds}). Longest / bloodiest: seed ${longest.seed}${
      longest.notes ? ` ${longest.notes}` : ""
    } (${longest.rounds} rounds, ${longest.partyAlive} survivor${longest.partyAlive === 1 ? "" : "s"}).`,
    damage: tidy.length
      ? `Best tidy wins: ${tidy.map((r) => `${r.seed} (${r.partyDmg}/${r.enemyDmg})`).join(" and ")}.`
      : `Party vs enemy damage by seed.`,
  };
}

/**
 * Render the full pretty loop / batch dashboard HTML.
 */
export function renderPrettyBatchHtml(report: PrettyBatchReport): string {
  const runs = report.runs;
  const partyWins = runs.filter((r) => (r.winner ?? "party") === "party").length;
  const fullSurvivors = runs.filter((r) => r.partyAlive >= 4).length;
  const avgRounds = runs.length
    ? (runs.reduce((s, r) => s + r.rounds, 0) / runs.length).toFixed(1)
    : "0";
  const errorWarns = 0; // findings injected by caller via subtitle if needed
  const callout = buildCallout(runs);
  const captions = chartCaptions(runs);
  const notables = report.notables?.length ? report.notables : buildNotables(runs);
  const rejects = report.rejects ?? [];
  const totalRejects =
    report.totalRejects ?? rejects.reduce((s, r) => s + r.count, 0);

  const tableRows = runs
    .map((r) => {
      const warn = r.partyAlive <= 2 ? ' class="warn"' : "";
      const notes = r.notes?.trim() ? r.notes : "(default)";
      return `<tr${warn}>
        <td>${r.id}</td>
        <td>${r.seed}</td>
        <td>${escapeHtml(notes)}</td>
        <td class="num">${r.rounds}</td>
        <td class="num">${r.partyAlive}</td>
        <td class="num">${r.partyDmg}</td>
        <td class="num">${r.enemyDmg}</td>
        <td class="num">${Math.round(r.hitRate * 100)}%</td>
        <td>${escapeHtml(r.partyHp)}</td>
      </tr>`;
    })
    .join("\n");

  const rejectSection =
    rejects.length > 0
      ? `
  <hr class="divider"/>
  <h2>Tactics agent rejects</h2>
  <div class="reject-grid">
    <div>
      <div class="stat" style="margin-bottom:0.75rem">
        <div class="v warn">${totalRejects}</div>
        <div class="l">Total vetoes this batch</div>
      </div>
      <h3>Rejects by skill</h3>
      ${horizontalBarChartSvg(
        rejects.map((r) => r.skill),
        rejects.map((r) => r.count),
        "#f59e0b",
        { height: Math.max(180, rejects.length * 36 + 24) },
      )}
    </div>
    <div>
      <h3>What the agent blocked</h3>
      <div class="table-wrap">
      <table>
        <thead><tr><th>Skill</th><th class="num">Count</th><th class="num">Share</th></tr></thead>
        <tbody>
          ${rejects
            .map(
              (r) => `<tr>
            <td>${escapeHtml(r.skill)}</td>
            <td class="num">${r.count}</td>
            <td class="num">${totalRejects ? Math.round((r.count / totalRejects) * 100) : 0}%</td>
          </tr>`,
            )
            .join("\n")}
        </tbody>
      </table>
      </div>
      ${
        report.rejectSource
          ? `<p class="chart-note">Source: ${escapeHtml(report.rejectSource)}</p>`
          : ""
      }
    </div>
  </div>`
      : "";

  const notableSection =
    notables.length > 0
      ? `
  <h2>Notable fights</h2>
  <div class="table-wrap">
  <table>
    <thead><tr><th>Seed</th><th>Takeaway</th></tr></thead>
    <tbody>
      ${notables
        .map(
          (n) =>
            `<tr><td>${escapeHtml(String(n.seed))}</td><td>${escapeHtml(n.takeaway)}</td></tr>`,
        )
        .join("\n")}
    </tbody>
  </table>
  </div>`
      : "";

  // Parse error/warn from subtitle if present like "0 errors / 0 warns"
  const ewMatch = report.subtitle.match(/(\d+)\s*errors?\s*\/\s*(\d+)\s*warns?/i);
  const ewLabel = ewMatch
    ? String(Number(ewMatch[1]) + Number(ewMatch[2]))
    : String(errorWarns);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(report.title)}</title>
<style>
${prettyReportCss()}
</style>
</head>
<body>
  <h1>${escapeHtml(report.title)}</h1>
  <p class="sub">${escapeHtml(report.subtitle)}</p>

  <div class="stats">
    <div class="stat"><div class="v ok">${partyWins} / ${runs.length}</div><div class="l">Party wins</div></div>
    <div class="stat"><div class="v">${fullSurvivors}</div><div class="l">Full-party survivor runs</div></div>
    <div class="stat"><div class="v">${avgRounds}</div><div class="l">Avg rounds</div></div>
    <div class="stat"><div class="v">${ewLabel}</div><div class="l">Errors / warns</div></div>
  </div>

  <div class="callout ${callout.tone}">
    <div class="title">${escapeHtml(callout.title)}</div>
    ${escapeHtml(callout.body)}${
      totalRejects > 0
        ? ` Tactics agent veto/retry was active throughout (${totalRejects} rejects across walkthroughs).`
        : ""
    }
  </div>

  <h2>Outcomes by director note</h2>
  <div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>#</th><th>Seed</th><th>Notes</th>
        <th class="num">Rounds</th><th class="num">Alive</th>
        <th class="num">Party dmg</th><th class="num">Enemy dmg</th>
        <th class="num">Hit rate</th><th>End HP (F/W/R/C)</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
  </div>

  <div class="charts">
    <div>
      <h3>Rounds to finish</h3>
      ${barChartSvg(
        runs.map((r) => r.rounds),
        runs.map((r) => String(r.seed)),
        "#7dd3fc",
      )}
      <p class="chart-note">${escapeHtml(captions.rounds)}</p>
    </div>
    <div>
      <h3>Damage dealt</h3>
      ${groupedBarChartSvg(
        runs.map((r) => String(r.seed)),
        [
          { name: "Party damage", data: runs.map((r) => r.partyDmg), color: "#4ade80" },
          { name: "Enemy damage", data: runs.map((r) => r.enemyDmg), color: "#f87171" },
        ],
      )}
      <div class="legend"><span class="party">Party damage</span><span class="enemy">Enemy damage</span></div>
      <p class="chart-note">${escapeHtml(captions.damage)}</p>
    </div>
  </div>

  ${rejectSection}
  ${notableSection}

  ${report.footer ? `<p class="footer">${escapeHtml(report.footer)}</p>` : ""}
</body>
</html>`;
}

/** Build PrettyBatchReport from batch10-report.json shape. */
export function prettyReportFromBatch10Json(
  json: {
    generatedAt?: string;
    encounter?: string;
    summaries?: Array<Record<string, unknown>>;
    findingCounts?: { error?: number; warn?: number; info?: number };
  },
  opts?: {
    rejects?: PrettyReject[];
    rejectSource?: string;
    totalRejects?: number;
    footer?: string;
  },
): PrettyBatchReport {
  const summaries = json.summaries ?? [];
  const runs: PrettyRunRow[] = summaries.map((s, i) => ({
    id: Number(s.runId ?? i + 1),
    seed: Number(s.seed ?? 0),
    notes: String(s.notes ?? ""),
    rounds: Number(s.rounds ?? 0),
    partyAlive: Number(s.partyAlive ?? 0),
    partyDmg: Number(s.partyDmg ?? 0),
    enemyDmg: Number(s.enemyDmg ?? 0),
    hitRate: Number(s.hitRate ?? 0),
    partyHp: partyHpFromSummary(s.partyHp as Record<string, string> | undefined),
    winner: String(s.winner ?? "party"),
    endReason: String(s.endReason ?? ""),
  }));
  const seeds = runs.map((r) => r.seed);
  const seedRange =
    seeds.length > 0 ? `seeds ${Math.min(...seeds)}–${Math.max(...seeds)}` : "no seeds";
  const err = json.findingCounts?.error ?? 0;
  const warn = json.findingCounts?.warn ?? 0;
  return {
    title: "10-loop combat with tactics agent",
    subtitle: `${json.encounter ?? "encounter"} · ${seedRange} · generated ${json.generatedAt ?? ""} · ${err} errors / ${warn} warns`,
    generatedAt: json.generatedAt ?? new Date().toISOString(),
    runs,
    rejects: opts?.rejects,
    rejectSource: opts?.rejectSource,
    totalRejects: opts?.totalRejects,
    footer: opts?.footer,
  };
}
