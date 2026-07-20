import fs from "node:fs";
import path from "node:path";
import { buildChallenge } from "../encounters/buildChallenge.js";
import { THREAT_EXPECTATION, type ThreatLevel } from "../encounters/pf2eBudget.js";
import { living } from "../memory/combatMemory.js";
import { runEncounter } from "../orch/loop.js";
import {
  buildLoopBriefing,
  ensureLoopBriefing,
  formatBriefingHtml,
  type LoopBriefing,
} from "./loopBriefing.js";

export type { LoopBriefing } from "./loopBriefing.js";
export { buildLoopBriefing, ensureLoopBriefing };

export const MATRIX_THREATS: ThreatLevel[] = ["trivial", "moderate", "hard", "extreme"];
export const MATRIX_PARTY_SIZES = [3, 4, 5] as const;
export const MATRIX_SEEDS = [201, 202, 203];

export type MatrixRow = {
  partySize: number;
  threat: ThreatLevel;
  seed: number;
  budgetXp: number;
  actualXp: number;
  enemies: string[];
  winner: string;
  endReason: string;
  rounds: number;
  partyDowned: number;
  partyInjured: number;
  partyDamageTaken: number;
  enemyDowned: number;
  partyAlive: number;
  enemyAlive: number;
  expectationMet: boolean;
  expectationNotes: string[];
  /** Full mechanical walkthrough for this seed (shown in report modal). */
  log?: string;
};

export type MatrixCell = {
  partySize: number;
  threat: ThreatLevel;
  expect: string;
  budgetXp: number;
  actualXp: number;
  enemies: string[];
  wins: number;
  seeds: number;
  totalPartyDowned: number;
  seedsWithInjury: number;
  avgPartyDamage: number;
  bandOk: boolean;
  bandNotes: string[];
};

export type ChallengeMatrixReport = {
  generatedAt: string;
  pathfix: string;
  expectations: typeof THREAT_EXPECTATION;
  cells: MatrixCell[];
  rows: MatrixRow[];
  summary: {
    cellsOk: number;
    cellsTotal: number;
    trivialClean: number;
    extremeDeadly: number;
    tpkParty3Extreme: number;
  };
  /** Human-style best/worst + advice (always present on fresh runs). */
  briefing?: LoopBriefing;
};

export type MatrixProgress = {
  phase: "running" | "done" | "error";
  message: string;
  completed: number;
  total: number;
  report?: ChallengeMatrixReport;
  error?: string;
};

const ENEMY_LABEL: Record<string, string> = {
  goblin_weak: "cutpurse",
  goblin_warrior: "w",
  goblin_archer: "a",
  goblin_shaman: "shaman",
  hobgoblin: "hob",
  ogre: "ogre",
};

export function formatEnemyPack(keys: string[]): string {
  if (!keys.length) return "—";
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);

  // Classic patrol shorthand
  const w = counts.get("goblin_warrior") ?? 0;
  const a = counts.get("goblin_archer") ?? 0;
  const s = counts.get("goblin_shaman") ?? 0;
  const h = counts.get("hobgoblin") ?? 0;
  const o = counts.get("ogre") ?? 0;
  const weak = counts.get("goblin_weak") ?? 0;

  if (weak === 1 && keys.length === 1) return "1 cutpurse";
  if (o >= 1 && a >= 1 && keys.length === o + a)
    return `ogre+${a} archer${a === 1 ? "" : "s"}`;
  if (w >= 1 && a >= 1 && s >= 1 && h === 0 && o === 0 && weak === 0) {
    if (w === 2 && a === 1 && s === 1) return "2w+archer+shaman";
    if (w === 3 && a === 3 && s === 1) return "3w+3a+shaman";
    if (w === 2 && a === 2 && s === 1) return "classic patrol";
  }
  if (w >= 1 && a >= 1 && h >= 1) return "patrol+hob";
  if (w === 1 && a === 1 && keys.length === 2) return "warrior+archer";
  if (w === 1 && a === 3) return "w+3 archers";
  if (w === 3 && a === 3 && s === 0) return "3w+3a";

  return [...counts.entries()]
    .map(([k, n]) => {
      const label = ENEMY_LABEL[k] ?? k;
      return n > 1 ? `${n}${label}` : label;
    })
    .join("+");
}

export type ChallengeMatrixOpts = {
  onProgress?: (p: MatrixProgress) => void;
  maxRounds?: number;
  /** Explicit seed list. Wins over seedCount/baseSeed when non-empty. */
  seeds?: number[];
  /** How many seeds per cell (default 3). Ignored if `seeds` is set. */
  seedCount?: number;
  /** First seed when generating a range (default 201). */
  baseSeed?: number;
  partySizes?: number[];
  threats?: ThreatLevel[];
  pathNote?: string;
};

export function resolveMatrixSeeds(opts?: Pick<ChallengeMatrixOpts, "seeds" | "seedCount" | "baseSeed">): number[] {
  if (opts?.seeds?.length) {
    return [...new Set(opts.seeds.map((n) => Math.floor(Number(n))).filter((n) => Number.isFinite(n)))];
  }
  const count = Math.min(20, Math.max(1, Math.floor(opts?.seedCount ?? MATRIX_SEEDS.length)));
  const base = Math.floor(opts?.baseSeed ?? MATRIX_SEEDS[0]!);
  return Array.from({ length: count }, (_, i) => base + i);
}

export function resolveMatrixPartySizes(sizes?: number[]): Array<3 | 4 | 5> {
  const allowed = new Set<number>(MATRIX_PARTY_SIZES);
  const picked = (sizes?.length ? sizes : [...MATRIX_PARTY_SIZES])
    .map((n) => Math.floor(Number(n)))
    .filter((n): n is 3 | 4 | 5 => allowed.has(n));
  const unique = [...new Set(picked.length ? picked : [...MATRIX_PARTY_SIZES])].sort(
    (a, b) => a - b,
  ) as Array<3 | 4 | 5>;
  return unique;
}

export function resolveMatrixThreats(threats?: ThreatLevel[]): ThreatLevel[] {
  const allowed = new Set<ThreatLevel>(MATRIX_THREATS);
  const picked = (threats?.length ? threats : [...MATRIX_THREATS]).filter((t) => allowed.has(t));
  return picked.length ? MATRIX_THREATS.filter((t) => picked.includes(t)) : [...MATRIX_THREATS];
}

export async function runChallengeMatrix(opts?: ChallengeMatrixOpts): Promise<ChallengeMatrixReport> {
  const seeds = resolveMatrixSeeds(opts);
  const partySizes = resolveMatrixPartySizes(opts?.partySizes);
  const threats = resolveMatrixThreats(opts?.threats);
  const total = partySizes.length * threats.length * seeds.length;
  let completed = 0;
  const rows: MatrixRow[] = [];

  const notify = (message: string, extra?: Partial<MatrixProgress>) => {
    opts?.onProgress?.({
      phase: "running",
      message,
      completed,
      total,
      ...extra,
    });
  };

  notify(
    `Starting challenge matrix (${total} fights: party ${partySizes.join("/")} × ${threats.join("/")} × ${seeds.length} seeds)…`,
  );

  for (const partySize of partySizes) {
    for (const threat of threats) {
      const built = buildChallenge({ partySize, threat, partyLevel: 1 });
      notify(
        `party×${partySize} ${threat} budget=${built.budgetXp} actual=${built.actualXp}`,
      );

      for (const seed of seeds) {
        notify(`party×${partySize} ${threat} seed ${seed}`);
        const result = await runEncounter(built.fixture, {
          seed,
          maxRounds: opts?.maxRounds ?? 20,
          save: false,
        });
        const { mem } = result;
        const end = [...mem.events].reverse().find((e) => e.t === "combat_end");
        const party = [...mem.combatants.values()].filter((c) => c.side === "party");
        const enemies = [...mem.combatants.values()].filter((c) => c.side === "enemy");

        const partyDowned = party.filter((c) => c.downed).length;
        const enemyDowned = enemies.filter((c) => c.downed).length;
        const partyDamageTaken = party.reduce((s, c) => s + (c.maxHp - Math.max(0, c.hp)), 0);
        const partyInjured = party.filter((c) => c.hp < c.maxHp).length;

        const notes: string[] = [];
        let ok = true;

        if (threat === "trivial") {
          if (partyDowned > 0) {
            ok = false;
            notes.push(`expected no deaths, got ${partyDowned} downed`);
          }
          if (partyDamageTaken > 0) {
            ok = false;
            notes.push(`expected no injuries, party took ${partyDamageTaken} dmg`);
          }
          if (end && end.t === "combat_end" && end.winner !== "party") {
            ok = false;
            notes.push(`expected party win, got ${end.winner}`);
          }
        } else if (threat === "extreme") {
          if (partyDowned === 0) {
            ok = false;
            notes.push("expected some death on extreme");
          } else if (partyDowned === 0 && end && end.t === "combat_end" && end.winner === "party") {
            notes.push("no PC deaths this seed (ok if rare across seeds)");
          }
        } else {
          if (end && end.t === "combat_end" && end.winner === "enemy") {
            ok = false;
            notes.push("party wiped (unexpected for this band)");
          }
          if (threat === "moderate" && partyDowned > 1) {
            ok = false;
            notes.push(`moderate with ${partyDowned} deaths`);
          }
        }

        if (notes.length === 0) notes.push("within band");

        rows.push({
          partySize,
          threat,
          seed,
          budgetXp: built.budgetXp,
          actualXp: built.actualXp,
          enemies: built.enemyKeys,
          winner: end && end.t === "combat_end" ? end.winner : "?",
          endReason: end && end.t === "combat_end" ? end.reason : "?",
          rounds: mem.round,
          partyDowned,
          partyInjured,
          partyDamageTaken,
          enemyDowned,
          partyAlive: living(mem, "party").length,
          enemyAlive: living(mem, "enemy").length,
          expectationMet: ok,
          expectationNotes: notes,
          log: result.output,
        });
        completed++;
        notify(`done party×${partySize} ${threat} seed ${seed}`);
      }
    }
  }

  const cells: MatrixCell[] = [];
  for (const partySize of partySizes) {
    for (const threat of threats) {
      const subset = rows.filter((r) => r.partySize === partySize && r.threat === threat);
      if (!subset.length) continue;
      const deaths = subset.reduce((s, r) => s + r.partyDowned, 0);
      const injSeeds = subset.filter((r) => r.partyDamageTaken > 0).length;
      const wins = subset.filter((r) => r.winner === "party").length;
      const avgDmg = subset.reduce((s, r) => s + r.partyDamageTaken, 0) / subset.length;
      const expect = THREAT_EXPECTATION[threat];
      let bandOk = true;
      const bandNotes: string[] = [];
      if (threat === "trivial") {
        bandOk = deaths === 0 && avgDmg <= 5 && wins === subset.length;
        if (!bandOk) {
          bandNotes.push(
            `want ~0 dmg, 0 deaths, all wins; dmg=${avgDmg.toFixed(1)} deaths=${deaths} wins=${wins}/${subset.length}`,
          );
        } else bandNotes.push(`clean: avg dmg ${avgDmg.toFixed(1)}, deaths 0`);
      } else if (threat === "extreme") {
        bandOk = deaths > 0;
        if (!bandOk) bandNotes.push("want some PC deaths across seeds");
        else bandNotes.push(`${deaths} PC downs across ${subset.length} seeds`);
      } else {
        bandOk = wins >= Math.ceil(subset.length * 0.5);
        if (!bandOk) bandNotes.push(`party win rate low: ${wins}/${subset.length}`);
        else
          bandNotes.push(
            `wins ${wins}/${subset.length}, avg dmg ${avgDmg.toFixed(1)}, deaths ${deaths}`,
          );
      }
      cells.push({
        partySize,
        threat,
        expect: expect.note,
        budgetXp: subset[0]?.budgetXp ?? 0,
        actualXp: subset[0]?.actualXp ?? 0,
        enemies: subset[0]?.enemies ?? [],
        wins,
        seeds: subset.length,
        totalPartyDowned: deaths,
        seedsWithInjury: injSeeds,
        avgPartyDamage: Number(avgDmg.toFixed(1)),
        bandOk,
        bandNotes,
      });
    }
  }

  const extremeP3 = cells.find((c) => c.partySize === 3 && c.threat === "extreme");
  const reportBase: ChallengeMatrixReport = {
    generatedAt: new Date().toISOString(),
    pathfix:
      opts?.pathNote ??
      `party ${partySizes.join("/")} × ${threats.join("/")} × seeds [${seeds.join(", ")}] · maxRounds ${opts?.maxRounds ?? 20}`,
    expectations: THREAT_EXPECTATION,
    cells,
    rows,
    summary: {
      cellsOk: cells.filter((c) => c.bandOk).length,
      cellsTotal: cells.length,
      trivialClean: cells.filter((c) => c.threat === "trivial" && c.bandOk).length,
      extremeDeadly: cells.filter((c) => c.threat === "extreme" && c.bandOk).length,
      tpkParty3Extreme: extremeP3 && extremeP3.wins === 0 ? extremeP3.seeds : 0,
    },
  };
  const report = ensureLoopBriefing(reportBase);

  opts?.onProgress?.({
    phase: "done",
    message: "Matrix complete",
    completed: total,
    total,
    report,
  });

  return report;
}

export function writeChallengeMatrixArtifacts(
  report: ChallengeMatrixReport,
  outDir: string,
): { jsonPath: string; htmlPath: string } {
  const withBriefing = ensureLoopBriefing(report);
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "challenge-matrix-report.json");
  const htmlPath = path.join(outDir, "challenge-matrix-report.html");
  fs.writeFileSync(jsonPath, JSON.stringify(withBriefing, null, 2));
  fs.writeFileSync(htmlPath, renderChallengeMatrixHtml(withBriefing));
  return { jsonPath, htmlPath };
}

const THREAT_COLORS: Record<string, string> = {
  trivial: "#3d9b7a",
  moderate: "#6aa8c8",
  hard: "#4a7ab5",
  extreme: "#d4894a",
};

function barChartSvg(
  values: number[],
  labels: string[],
  colorFor: (i: number) => string,
): string {
  const w = 420;
  const h = 200;
  const pad = { t: 28, r: 16, b: 40, l: 40 };
  const max = Math.max(...values, 1);
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const gap = 14;
  const n = Math.max(values.length, 1);
  const barW = (innerW - gap * (n - 1)) / n;
  const baseline = pad.t + innerH;
  const grid = [0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = pad.t + innerH * (1 - f);
      return `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="#2e3746" stroke-width="1"/>`;
    })
    .join("");
  const bars = values
    .map((v, i) => {
      const bh = Math.max((v / max) * innerH, v > 0 ? 3 : 0);
      const x = pad.l + i * (barW + gap);
      const y = baseline - bh;
      const label = Number.isInteger(v) ? String(v) : v.toFixed(1);
      return `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" fill="${colorFor(i)}" rx="4"/>
        <text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" fill="#e7ecf3" font-size="12" font-weight="600">${label}</text>
        <text x="${x + barW / 2}" y="${h - 14}" text-anchor="middle" fill="#9aa6b8" font-size="12">${labels[i]}</text>`;
    })
    .join("\n");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="bar chart">
    ${grid}
    <line x1="${pad.l}" y1="${baseline}" x2="${w - pad.r}" y2="${baseline}" stroke="#3a4556" stroke-width="1.5"/>
    ${bars}
  </svg>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderChallengeMatrixHtml(report: ChallengeMatrixReport): string {
  const reportWith = ensureLoopBriefing(report);
  const briefing = reportWith.briefing!;
  const partySizes = [...new Set(reportWith.cells.map((c) => c.partySize))].sort((a, b) => a - b);
  const threats = MATRIX_THREATS.filter((t) => reportWith.cells.some((c) => c.threat === t));
  const seedsPerCell = reportWith.cells[0]?.seeds ?? 0;
  const seedRowsPerThreat = reportWith.rows.filter((r) => r.threat === threats[0]).length || 0;

  const avgDmgByThreat = threats.map((t) => {
    const rows = reportWith.cells.filter((c) => c.threat === t);
    if (!rows.length) return 0;
    return Number((rows.reduce((s, r) => s + r.avgPartyDamage, 0) / rows.length).toFixed(1));
  });
  const deathsByThreat = threats.map((t) =>
    reportWith.cells.filter((c) => c.threat === t).reduce((s, r) => s + r.totalPartyDowned, 0),
  );

  const trivialCells = reportWith.cells.filter((c) => c.threat === "trivial").length;
  const extremeCells = reportWith.cells.filter((c) => c.threat === "extreme").length;
  const extremeP3 = reportWith.cells.find((c) => c.partySize === 3 && c.threat === "extreme");
  const tpk = Number(
    reportWith.summary.tpkParty3Extreme ??
      (extremeP3 && extremeP3.wins === 0 ? extremeP3.seeds : 0),
  );

  const tableRows = reportWith.cells
    .map((c) => {
      const tone =
        c.threat === "trivial" && c.bandOk
          ? "ok"
          : c.threat === "extreme"
            ? "warn"
            : c.bandOk
              ? ""
              : "off";
      const bandClass = c.bandOk ? "band-ok" : "band-off";
      const key = `${c.partySize}|${c.threat}`;
      return `<tr class="matrix-row ${tone}" data-key="${escapeHtml(key)}" tabindex="0" role="button" title="View combat logs">
        <td class="party">${c.partySize}</td>
        <td><span class="threat threat-${c.threat}">${c.threat}</span></td>
        <td>${c.actualXp}/${c.budgetXp}</td>
        <td>${escapeHtml(formatEnemyPack(c.enemies))}</td>
        <td class="wins">${c.wins}/${c.seeds}</td>
        <td>${c.avgPartyDamage}</td>
        <td>${c.totalPartyDowned}</td>
        <td class="${bandClass}">${c.bandOk ? "OK" : "OFF"}</td>
      </tr>`;
    })
    .join("\n");

  type LogEntry = {
    seed: number;
    winner: string;
    endReason: string;
    rounds: number;
    log: string;
  };
  const logsByCell: Record<string, LogEntry[]> = {};
  for (const r of reportWith.rows) {
    const key = `${r.partySize}|${r.threat}`;
    (logsByCell[key] ??= []).push({
      seed: r.seed,
      winner: r.winner,
      endReason: r.endReason,
      rounds: r.rounds,
      log: r.log ?? "",
    });
  }
  const logsJson = JSON.stringify(logsByCell).replace(/</g, "\\u003c");

  const pathfix = escapeHtml(report.pathfix || "challenge matrix");
  const when = escapeHtml(new Date(reportWith.generatedAt).toLocaleString());
  const threatLabel = threats.map((t) => (t === "hard" ? "hard(severe)" : t)).join(" / ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>PF2e challenge ladder × party size</title>
<style>
:root {
  --bg: #14181f; --panel: #1c222c; --border: #2e3746; --text: #e7ecf3;
  --muted: #9aa6b8; --ok: #3d9b7a; --warn: #d4894a; --accent: #c4a35a;
  --font: "IBM Plex Sans", "Segoe UI", sans-serif;
  --mono: "IBM Plex Mono", "Consolas", monospace;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); padding: 1.5rem; }
h1 { margin: 0 0 0.25rem; font-size: 1.5rem; }
h2 { margin: 1.5rem 0 0.75rem; font-size: 1.1rem; color: var(--accent); }
h3 { margin: 0 0 0.65rem; font-size: 0.95rem; color: var(--muted); font-weight: 600; }
.sub { color: var(--muted); font-size: 0.85rem; margin-bottom: 1.25rem; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; }
.stat { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 0.9rem 1rem; }
.stat .v { font-size: 1.6rem; font-weight: 700; }
.stat .v.ok { color: var(--ok); }
.stat .v.warn { color: var(--warn); }
.stat .l { color: var(--muted); font-size: 0.8rem; margin-top: 0.25rem; }
.callout { background: var(--panel); border: 1px solid var(--border); border-left: 3px solid #6aa8c8; border-radius: 8px; padding: 0.85rem 1rem; margin: 1rem 0; color: #d5dde8; font-size: 0.92rem; line-height: 1.45; }
.callout strong { color: var(--text); }
.briefing { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.1rem; margin: 1.25rem 0; }
.briefing-headline { color: var(--accent); font-weight: 600; margin: 0 0 0.75rem; }
.briefing h3 { margin: 0.85rem 0 0.4rem; }
.briefing ul { margin: 0; padding-left: 1.2rem; color: #d5dde8; font-size: 0.9rem; line-height: 1.45; }
.briefing-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
@media (max-width: 900px) { .briefing-cols { grid-template-columns: 1fr; } }
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
table { width: 100%; border-collapse: collapse; font-size: 0.88rem; background: var(--panel); }
th, td { padding: 0.55rem 0.7rem; text-align: left; border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-weight: 600; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; background: #181e27; }
tbody tr:last-child td { border-bottom: none; }
tr.ok td.party { box-shadow: inset 3px 0 0 var(--ok); }
tr.warn td.party { box-shadow: inset 3px 0 0 var(--warn); }
tr.off td.party { box-shadow: inset 3px 0 0 #c45c5c; }
.matrix-row { cursor: pointer; }
.matrix-row:hover { background: #232a36; }
.matrix-row:focus { outline: 1px solid var(--accent-dim); outline-offset: -1px; }
.wins { color: var(--accent); font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }
.threat { text-transform: lowercase; }
.band-ok { color: var(--ok); font-weight: 600; }
.band-off { color: #c45c5c; font-weight: 600; }
.hint-row { color: var(--muted); font-size: 0.8rem; margin: -0.35rem 0 0.65rem; }
.charts { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1.25rem; }
.chart { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 0.95rem 1rem 0.75rem; }
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(8, 10, 14, 0.72);
  display: none; align-items: center; justify-content: center;
  padding: 1.25rem; z-index: 40;
}
.modal-backdrop.open { display: flex; }
.modal {
  width: min(920px, 100%);
  max-height: min(88vh, 900px);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  display: flex; flex-direction: column;
  box-shadow: 0 16px 48px rgba(0,0,0,0.45);
}
.modal-head {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 1rem; padding: 0.9rem 1rem; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.modal-head h3 { margin: 0; color: var(--accent); font-size: 1rem; text-transform: none; letter-spacing: 0; }
.modal-head .meta { margin: 0.25rem 0 0; color: var(--muted); font-size: 0.8rem; }
.modal-close {
  background: transparent; color: var(--muted); border: 1px solid var(--border);
  border-radius: 6px; padding: 0.35rem 0.7rem; cursor: pointer; font-weight: 600;
}
.modal-close:hover { color: var(--text); border-color: var(--accent-dim); }
.seed-tabs {
  display: flex; flex-wrap: wrap; gap: 0.4rem;
  padding: 0.65rem 1rem; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.seed-tab {
  background: #181e27; color: var(--muted); border: 1px solid var(--border);
  border-radius: 999px; padding: 0.3rem 0.75rem; font-size: 0.8rem; cursor: pointer; font-weight: 600;
}
.seed-tab.active { color: #1a1408; background: var(--accent); border-color: var(--accent); }
.modal-body {
  margin: 0; padding: 1rem; overflow: auto; flex: 1; min-height: 0;
  font-family: var(--mono); font-size: 0.78rem; line-height: 1.45;
  white-space: pre-wrap; color: #d5dde8; background: #12161d;
}
.modal-empty { color: var(--muted); font-family: var(--font); font-size: 0.9rem; }
@media (max-width: 900px) {
  .stats, .charts { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
  <h1>PF2e challenge ladder × party size</h1>
  <p class="sub">${reportWith.rows.length} fights · party ${partySizes.join("/")} · ${threatLabel} · ${seedsPerCell} seed${seedsPerCell === 1 ? "" : "s"} each · ${when}<br/>${pathfix}</p>

  <div class="stats">
    <div class="stat"><div class="v ok">${reportWith.summary.cellsOk} / ${reportWith.summary.cellsTotal}</div><div class="l">Band cells OK</div></div>
    <div class="stat"><div class="v ok">${reportWith.summary.trivialClean} / ${trivialCells || 0}</div><div class="l">Trivial: no deaths</div></div>
    <div class="stat"><div class="v ok">${reportWith.summary.extremeDeadly} / ${extremeCells || 0}</div><div class="l">Extreme: PC deaths</div></div>
    <div class="stat"><div class="v warn">TPK×${Number.isFinite(tpk) ? tpk : 0}</div><div class="l">Party×3 vs ogre</div></div>
  </div>

  <div class="callout">
    <strong>Expectation check</strong><br/>
    Trivial should be curb-stomps (no PC deaths, ~0 damage). Extreme should kill someone.
    Hard maps to PF2e Severe (120 XP @ 4 PCs). Budgets scale ±40 XP per PC vs party of 4.
  </div>

  ${formatBriefingHtml(briefing)}

  <h2>Results matrix</h2>
  <p class="hint-row">Click a row (or Wins) to open combat logs for each seed in that cell.</p>
  <div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Party</th><th>Threat</th><th>XP actual/budget</th><th>Enemies</th>
        <th>Wins</th><th>Avg PC dmg</th><th>PC downs</th><th>Band</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
  </div>

  <div class="charts">
    <div class="chart">
      <h3>Avg PC damage by threat (all party sizes)</h3>
      ${barChartSvg(avgDmgByThreat, threats, (i) => THREAT_COLORS[threats[i]!] ?? "#6aa8c8")}
    </div>
    <div class="chart">
      <h3>Total PC downs by threat (${seedRowsPerThreat || partySizes.length * seedsPerCell} seeds)</h3>
      ${barChartSvg(deathsByThreat, threats, (i) => THREAT_COLORS[threats[i]!] ?? "#6aa8c8")}
    </div>
  </div>

  <div class="modal-backdrop" id="logModal" aria-hidden="true">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="logModalTitle">
      <div class="modal-head">
        <div>
          <h3 id="logModalTitle">Combat logs</h3>
          <p class="meta" id="logModalMeta"></p>
        </div>
        <button type="button" class="modal-close" id="logModalClose">Close</button>
      </div>
      <div class="seed-tabs" id="seedTabs"></div>
      <pre class="modal-body" id="logBody"></pre>
    </div>
  </div>

  <script type="application/json" id="matrix-logs">${logsJson}</script>
  <script>
  (function () {
    const logs = JSON.parse(document.getElementById("matrix-logs").textContent || "{}");
    const backdrop = document.getElementById("logModal");
    const titleEl = document.getElementById("logModalTitle");
    const metaEl = document.getElementById("logModalMeta");
    const tabsEl = document.getElementById("seedTabs");
    const bodyEl = document.getElementById("logBody");
    const closeBtn = document.getElementById("logModalClose");
    let current = [];

    function showSeed(i) {
      const entry = current[i];
      if (!entry) {
        bodyEl.textContent = "No combat log for this cell. Re-run the loop matrix to capture walkthroughs.";
        bodyEl.classList.add("modal-empty");
        return;
      }
      bodyEl.classList.remove("modal-empty");
      metaEl.textContent = "seed " + entry.seed + " · " + entry.winner + " · " + entry.endReason + " · " + entry.rounds + " rounds";
      [...tabsEl.querySelectorAll(".seed-tab")].forEach(function (btn, idx) {
        btn.classList.toggle("active", idx === i);
      });
      bodyEl.textContent = entry.log && entry.log.trim()
        ? entry.log
        : "No combat log stored for seed " + entry.seed + ". Re-run the loop matrix to capture walkthroughs.";
      if (!entry.log || !entry.log.trim()) bodyEl.classList.add("modal-empty");
    }

    function openCell(key) {
      current = logs[key] || [];
      const parts = key.split("|");
      titleEl.textContent = "Party ×" + parts[0] + " · " + parts[1];
      tabsEl.innerHTML = "";
      if (!current.length) {
        metaEl.textContent = "";
        bodyEl.classList.add("modal-empty");
        bodyEl.textContent = "No combat log for this cell. Re-run the loop matrix to capture walkthroughs.";
      } else {
        current.forEach(function (entry, i) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "seed-tab" + (i === 0 ? " active" : "");
          btn.textContent = "Seed " + entry.seed + " (" + entry.winner + ")";
          btn.addEventListener("click", function () { showSeed(i); });
          tabsEl.appendChild(btn);
        });
        showSeed(0);
      }
      backdrop.classList.add("open");
      backdrop.setAttribute("aria-hidden", "false");
      closeBtn.focus();
    }

    function closeModal() {
      backdrop.classList.remove("open");
      backdrop.setAttribute("aria-hidden", "true");
    }

    document.querySelectorAll(".matrix-row").forEach(function (row) {
      row.addEventListener("click", function () { openCell(row.getAttribute("data-key")); });
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openCell(row.getAttribute("data-key"));
        }
      });
    });
    closeBtn.addEventListener("click", closeModal);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && backdrop.classList.contains("open")) closeModal();
    });
  })();
  </script>
</body>
</html>`;
}
