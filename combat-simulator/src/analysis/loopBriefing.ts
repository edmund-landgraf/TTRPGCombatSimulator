import type { ChallengeMatrixReport, MatrixCell, MatrixRow } from "./challengeMatrix.js";

export type LoopBriefingScenario = {
  label: string;
  detail: string;
  partySize: number;
  threat: string;
  seed?: number;
};

export type LoopBriefing = {
  headline: string;
  howItWent: string[];
  best: LoopBriefingScenario[];
  worst: LoopBriefingScenario[];
  advice: string[];
  /** Plain text for LLM / chat context. */
  text: string;
};

function cellLabel(c: Pick<MatrixCell, "partySize" | "threat">): string {
  return `party×${c.partySize} · ${c.threat}`;
}

function rowLabel(r: MatrixRow): string {
  return `party×${r.partySize} · ${r.threat} · seed ${r.seed}`;
}

function cellScoreBest(c: MatrixCell): number {
  const winRate = c.seeds ? c.wins / c.seeds : 0;
  return winRate * 100 - c.avgPartyDamage * 0.4 - c.totalPartyDowned * 8 + (c.bandOk ? 5 : -20);
}

function cellScoreWorst(c: MatrixCell): number {
  const winRate = c.seeds ? c.wins / c.seeds : 0;
  return (1 - winRate) * 100 + c.avgPartyDamage * 0.5 + c.totalPartyDowned * 10 + (c.bandOk ? 0 : 25);
}

function rowScoreBest(r: MatrixRow): number {
  const win = r.winner === "party" ? 50 : 0;
  return win - r.partyDamageTaken * 0.5 - r.partyDowned * 12 - r.rounds * 0.3;
}

function rowScoreWorst(r: MatrixRow): number {
  const loss = r.winner !== "party" ? 60 : 0;
  return loss + r.partyDamageTaken * 0.5 + r.partyDowned * 12 + r.rounds * 0.4;
}

function formatEnemyShort(enemies: string[]): string {
  if (!enemies.length) return "enemies";
  return enemies.slice(0, 4).join(", ") + (enemies.length > 4 ? "…" : "");
}

/**
 * Deterministic human-style briefing: best/worst, how it went, what to try next.
 */
export function buildLoopBriefing(report: ChallengeMatrixReport): LoopBriefing {
  const { cells, rows, summary } = report;
  const bandOff = cells.filter((c) => !c.bandOk);
  const partyWins = rows.filter((r) => r.winner === "party").length;
  const winRate = rows.length ? partyWins / rows.length : 0;

  const headline = [
    `Band OK ${summary.cellsOk}/${summary.cellsTotal}`,
    `party win ${partyWins}/${rows.length} (${Math.round(winRate * 100)}%)`,
    bandOff.length ? `${bandOff.length} cell${bandOff.length === 1 ? "" : "s"} OFF band` : "all cells on band",
  ].join(" · ");

  const howItWent: string[] = [];
  howItWent.push(
    `Ran ${rows.length} fight${rows.length === 1 ? "" : "s"} across ${cells.length} party×threat cell${cells.length === 1 ? "" : "s"}.`,
  );
  if (summary.trivialClean > 0 || cells.some((c) => c.threat === "trivial")) {
    const trivialCells = cells.filter((c) => c.threat === "trivial").length;
    howItWent.push(
      `Trivial: ${summary.trivialClean}/${trivialCells || 0} cells clean (expect curb-stomps, ~0 PC damage).`,
    );
  }
  if (cells.some((c) => c.threat === "extreme")) {
    const extremeCells = cells.filter((c) => c.threat === "extreme").length;
    howItWent.push(
      `Extreme: ${summary.extremeDeadly}/${extremeCells} cells showed PC downs (expect someone to drop).`,
    );
  }
  if (summary.tpkParty3Extreme > 0) {
    howItWent.push(
      `Party×3 vs extreme wiped ${summary.tpkParty3Extreme} seed${summary.tpkParty3Extreme === 1 ? "" : "s"} (TPK).`,
    );
  }
  if (bandOff.length) {
    howItWent.push(
      `Off-band: ${bandOff.map((c) => cellLabel(c)).join("; ")}.`,
    );
  } else if (cells.length) {
    howItWent.push("Every cell matched its threat-band expectation.");
  }

  const bestCells = [...cells].sort((a, b) => cellScoreBest(b) - cellScoreBest(a)).slice(0, 3);
  const worstCells = [...cells].sort((a, b) => cellScoreWorst(b) - cellScoreWorst(a)).slice(0, 3);
  const bestRows = [...rows].sort((a, b) => rowScoreBest(b) - rowScoreBest(a)).slice(0, 2);
  const worstRows = [...rows].sort((a, b) => rowScoreWorst(b) - rowScoreWorst(a)).slice(0, 2);

  const best: LoopBriefingScenario[] = [
    ...bestCells.map((c) => ({
      label: cellLabel(c),
      detail: `${c.wins}/${c.seeds} wins · avg PC dmg ${c.avgPartyDamage} · downs ${c.totalPartyDowned} · band ${c.bandOk ? "OK" : "OFF"} · ${formatEnemyShort(c.enemies)}`,
      partySize: c.partySize,
      threat: c.threat,
    })),
    ...bestRows.map((r) => ({
      label: rowLabel(r),
      detail: `${r.winner} in ${r.rounds}r · PC dmg ${r.partyDamageTaken} · downs ${r.partyDowned} · party alive ${r.partyAlive}`,
      partySize: r.partySize,
      threat: r.threat,
      seed: r.seed,
    })),
  ].slice(0, 4);

  const worst: LoopBriefingScenario[] = [
    ...worstCells.map((c) => ({
      label: cellLabel(c),
      detail: `${c.wins}/${c.seeds} wins · avg PC dmg ${c.avgPartyDamage} · downs ${c.totalPartyDowned} · band ${c.bandOk ? "OK" : "OFF"} · ${c.bandNotes[0] ?? formatEnemyShort(c.enemies)}`,
      partySize: c.partySize,
      threat: c.threat,
    })),
    ...worstRows.map((r) => ({
      label: rowLabel(r),
      detail: `${r.winner} in ${r.rounds}r · PC dmg ${r.partyDamageTaken} · downs ${r.partyDowned}${r.expectationNotes[0] ? ` · ${r.expectationNotes[0]}` : ""}`,
      partySize: r.partySize,
      threat: r.threat,
      seed: r.seed,
    })),
  ].slice(0, 4);

  const advice: string[] = [];
  for (const c of bandOff) {
    if (c.threat === "trivial") {
      advice.push(
        `${cellLabel(c)} was too bloody for trivial — try a smaller enemy pack, or check tactics (wizard positioning / focus fire).`,
      );
    } else if (c.threat === "extreme" && c.totalPartyDowned === 0) {
      advice.push(
        `${cellLabel(c)} never dropped a PC — raise pressure (ogre/hob packs) or shrink the party to stress the band.`,
      );
    } else if (c.wins < Math.ceil(c.seeds * 0.5)) {
      advice.push(
        `${cellLabel(c)} win rate ${c.wins}/${c.seeds} is soft — try party×${Math.min(5, c.partySize + 1)}, or director notes that press the shaman / protect the wizard.`,
      );
    } else {
      advice.push(
        `${cellLabel(c)} missed band (${c.bandNotes[0] ?? "see matrix"}). Re-run that cell with different seeds or tactics notes.`,
      );
    }
  }

  const cleanModerate = cells.filter(
    (c) => c.threat === "moderate" && c.bandOk && c.wins === c.seeds && c.totalPartyDowned === 0,
  );
  for (const c of cleanModerate.slice(0, 2)) {
    advice.push(
      `${cellLabel(c)} was clean — try hard/extreme next, or drop to party×${Math.max(3, c.partySize - 1)} to find the edge.`,
    );
  }

  const bloodyWins = rows.filter(
    (r) => r.winner === "party" && (r.partyDowned >= 2 || r.partyDamageTaken >= 60),
  );
  if (bloodyWins.length) {
    const r = bloodyWins.sort((a, b) => b.partyDamageTaken - a.partyDamageTaken)[0]!;
    advice.push(
      `${rowLabel(r)} won but bled (${r.partyDamageTaken} PC dmg, ${r.partyDowned} downs) — try “protect the wizard” / “fighter press the shaman” style notes.`,
    );
  }

  if (!advice.length) {
    advice.push(
      "Bands look healthy. Vary director notes (rogue close first, archers focus fire) or bump seed count to stress-test consistency.",
    );
  }

  const text = formatLoopBriefingText({
    headline,
    howItWent,
    best,
    worst,
    advice,
  });

  return { headline, howItWent, best, worst, advice, text };
}

function formatLoopBriefingText(b: Omit<LoopBriefing, "text">): string {
  const lines = [
    `LOOP MATRIX BRIEFING`,
    `Headline: ${b.headline}`,
    "",
    "How it went:",
    ...b.howItWent.map((l) => `- ${l}`),
    "",
    "Best scenarios:",
    ...b.best.map((s) => `- ${s.label}: ${s.detail}`),
    "",
    "Worst scenarios:",
    ...b.worst.map((s) => `- ${s.label}: ${s.detail}`),
    "",
    "Try differently:",
    ...b.advice.map((a) => `- ${a}`),
  ];
  return lines.join("\n");
}

/** Attach or refresh briefing on a report (e.g. after loading older JSON from disk). */
export function ensureLoopBriefing(report: ChallengeMatrixReport): ChallengeMatrixReport {
  const briefing = buildLoopBriefing(report);
  return { ...report, briefing };
}

export function formatBriefingHtml(briefing: LoopBriefing): string {
  const li = (items: string[]) => items.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  const scen = (items: LoopBriefingScenario[]) =>
    items
      .map(
        (s) =>
          `<li><strong>${escapeHtml(s.label)}</strong> — ${escapeHtml(s.detail)}</li>`,
      )
      .join("");
  return `
  <section class="briefing">
    <h2>Analysis briefing</h2>
    <div class="callout">
      <div class="title">${escapeHtml(briefing.headline)}</div>
    </div>
    <h3>How it went</h3>
    <ul>${li(briefing.howItWent)}</ul>
    <div class="briefing-cols">
      <div>
        <h3>Best scenarios</h3>
        <ul>${scen(briefing.best)}</ul>
      </div>
      <div>
        <h3>Worst scenarios</h3>
        <ul>${scen(briefing.worst)}</ul>
      </div>
    </div>
    <h3>Try differently</h3>
    <ul>${li(briefing.advice)}</ul>
  </section>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
