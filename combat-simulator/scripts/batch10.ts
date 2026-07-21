/**
 * Ten classic-four runs with slight tactic note changes; writes analysis JSON + pretty HTML.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EncounterFixtureSchema } from "../src/memory/schemas.js";
import { buildClassicFourCells } from "../src/map/buildClassicMap.js";
import { runEncounter } from "../src/orch/loop.js";
import { living } from "../src/memory/combatMemory.js";
import {
  prettyReportFromBatch10Json,
  renderPrettyBatchHtml,
  type PrettyReject,
} from "../src/analysis/prettyLoopReport.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const TACTICS = [
  { id: 1, seed: 101, notes: "" },
  { id: 2, seed: 102, notes: "rogue close first" },
  { id: 3, seed: 103, notes: "rogue stealth and hide" },
  { id: 4, seed: 104, notes: "fighter press the shaman" },
  { id: 5, seed: 105, notes: "wizard stay back" },
  { id: 6, seed: 106, notes: "archers focus fire" },
  { id: 7, seed: 107, notes: "rogue close; fighter shaman" },
  { id: 8, seed: 108, notes: "wizard back; rogue melee" },
  { id: 9, seed: 109, notes: "protect the wizard" },
  { id: 10, seed: 110, notes: "rush the archers focus" },
];

type Finding = {
  severity: "error" | "warn" | "info";
  runId: number;
  code: string;
  detail: string;
};

function analyzeRun(
  runId: number,
  notes: string,
  result: Awaited<ReturnType<typeof runEncounter>>,
): { summary: Record<string, unknown>; findings: Finding[] } {
  const { mem, output, runDir } = result;
  const end = [...mem.events].reverse().find((e) => e.t === "combat_end");
  const attacks = mem.events.filter((e) => e.t === "attack");
  const moves = mem.events.filter((e) => e.t === "move");
  const findings: Finding[] = [];

  // HP invariants
  for (const c of mem.combatants.values()) {
    if (c.hp < 0) {
      findings.push({
        severity: "error",
        runId,
        code: "hp_negative",
        detail: `${c.id} ended with hp ${c.hp}`,
      });
    }
    if (c.hp > c.maxHp) {
      findings.push({
        severity: "error",
        runId,
        code: "hp_over_max",
        detail: `${c.id} hp ${c.hp} > max ${c.maxHp}`,
      });
    }
    if (c.downed && c.hp > 0) {
      findings.push({
        severity: "error",
        runId,
        code: "downed_with_hp",
        detail: `${c.id} downed but hp ${c.hp}`,
      });
    }
    if (!c.downed && c.hp <= 0) {
      findings.push({
        severity: "error",
        runId,
        code: "alive_at_0",
        detail: `${c.id} hp ${c.hp} but not downed`,
      });
    }
  }

  // Attack consistency
  for (const a of attacks) {
    if (a.t !== "attack") continue;
    if (a.hit && a.dmg <= 0 && !a.crit) {
      findings.push({
        severity: "warn",
        runId,
        code: "hit_zero_dmg",
        detail: `R${a.round} ${a.actor}→${a.target} hit with dmg ${a.dmg}`,
      });
    }
    if (!a.hit && a.dmg > 0) {
      findings.push({
        severity: "error",
        runId,
        code: "miss_with_dmg",
        detail: `R${a.round} ${a.actor}→${a.target} miss but dmg ${a.dmg}`,
      });
    }
    const total = a.d20 + a.mod;
    if (a.total !== total) {
      findings.push({
        severity: "error",
        runId,
        code: "attack_total_mismatch",
        detail: `R${a.round} ${a.actor}: total ${a.total} != ${a.d20}+${a.mod}`,
      });
    }
  }

  // Oscillation / thrashing: same actor move A→B then B→A same round
  const byRoundActor = new Map<string, string[]>();
  for (const m of moves) {
    if (m.t !== "move") continue;
    const key = `${m.round}|${m.actor}`;
    const arr = byRoundActor.get(key) ?? [];
    arr.push(`${m.from}->${m.to}`);
    byRoundActor.set(key, arr);
  }
  for (const [key, path] of byRoundActor) {
    if (path.length < 2) continue;
    const cells = path.flatMap((p) => p.split("->"));
    // detect immediate reverse
    for (let i = 0; i + 1 < path.length; i++) {
      const [aFrom, aTo] = path[i]!.split("->");
      const [bFrom, bTo] = path[i + 1]!.split("->");
      if (aFrom === bTo && aTo === bFrom) {
        findings.push({
          severity: "warn",
          runId,
          code: "move_oscillation",
          detail: `${key}: ${path[i]} then ${path[i + 1]}`,
        });
      }
    }
    if (new Set(cells).size === 2 && path.length >= 2) {
      findings.push({
        severity: "info",
        runId,
        code: "two_cell_shuffle",
        detail: `${key}: ${path.join("; ")}`,
      });
    }
  }

  // Notes that matched nothing useful
  if (notes && mem.weightDeltas.length === 0) {
    findings.push({
      severity: "warn",
      runId,
      code: "notes_no_deltas",
      detail: `notes produced no weight deltas: "${notes}"`,
    });
  }
  // Short-lived deltas (expire after round 1)
  for (const d of mem.weightDeltas) {
    if (d.until && d.until.round <= 1) {
      findings.push({
        severity: "warn",
        runId,
        code: "delta_expires_r1",
        detail: `${d.combatantId} delta expires round ${d.until.round}: ${JSON.stringify(d.delta)}`,
      });
    }
  }

  // Party "protect wizard" should have matched something — generic only boosts FTR
  if (notes.toLowerCase().includes("protect") && !notes.toLowerCase().includes("wizard back")) {
    const wizDelta = mem.weightDeltas.some((d) => d.combatantId === "WIZ");
    if (!wizDelta) {
      findings.push({
        severity: "info",
        runId,
        code: "protect_wizard_weak",
        detail: "protect the wizard fell through to generic FTR Stride_close +0.5",
      });
    }
  }

  // Downed before acting wording vs empty turns
  const held = (output.match(/held position/g) ?? []).length;
  const dropped = (output.match(/was dropped before acting/g) ?? []).length;

  const partyAlive = living(mem, "party").length;
  const enemyAlive = living(mem, "enemy").length;
  const hitRate =
    attacks.length === 0
      ? 0
      : attacks.filter((a) => a.t === "attack" && a.hit).length / attacks.length;

  const partyDmg = attacks
    .filter((a) => a.t === "attack" && mem.combatants.get(a.actor)?.side === "party" && a.hit)
    .reduce((s, a) => s + (a.t === "attack" ? a.dmg : 0), 0);
  const enemyDmg = attacks
    .filter((a) => a.t === "attack" && mem.combatants.get(a.actor)?.side === "enemy" && a.hit)
    .reduce((s, a) => s + (a.t === "attack" ? a.dmg : 0), 0);

  // Final positions overlap?
  const posMap = new Map<string, string[]>();
  for (const c of mem.combatants.values()) {
    if (c.downed) continue;
    const k = `${c.pos.x},${c.pos.y}`;
    const arr = posMap.get(k) ?? [];
    arr.push(c.id);
    posMap.set(k, arr);
  }
  for (const [pos, ids] of posMap) {
    if (ids.length > 1) {
      findings.push({
        severity: "error",
        runId,
        code: "stack_overlap",
        detail: `living units share ${pos}: ${ids.join(",")}`,
      });
    }
  }

  return {
    summary: {
      runId,
      seed: mem.seed,
      notes,
      weightDeltas: mem.weightDeltas,
      rounds: mem.round,
      winner: end && end.t === "combat_end" ? end.winner : "?",
      endReason: end && end.t === "combat_end" ? end.reason : "?",
      partyAlive,
      enemyAlive,
      attacks: attacks.length,
      hits: attacks.filter((a) => a.t === "attack" && a.hit).length,
      hitRate: Number(hitRate.toFixed(3)),
      moves: moves.length,
      partyDmg,
      enemyDmg,
      heldMentions: held,
      droppedMentions: dropped,
      runDir,
      partyHp: Object.fromEntries(
        [...mem.combatants.values()]
          .filter((c) => c.side === "party")
          .map((c) => [c.id, `${c.hp}/${c.maxHp}${c.downed ? "↓" : ""}`]),
      ),
      enemyHp: Object.fromEntries(
        [...mem.combatants.values()]
          .filter((c) => c.side === "enemy")
          .map((c) => [c.id, `${c.hp}/${c.maxHp}${c.downed ? "↓" : ""}`]),
      ),
    },
    findings,
  };
}

async function main() {
  const fixtureCandidates = [
    path.join(root, "examples", "classic-four-vs-goblins.json"),
    path.join(root, "..", "examples", "classic-four-vs-goblins.json"),
  ];
  const fixturePath = fixtureCandidates.find((p) => fs.existsSync(p));
  if (!fixturePath) throw new Error(`Fixture not found in ${fixtureCandidates.join(", ")}`);
  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  if (!raw.cells || raw.cells.length === 0) {
    raw.cells = buildClassicFourCells(raw.width ?? 12, raw.height ?? 10);
  }
  const fixture = EncounterFixtureSchema.parse(raw);
  const runsDir = path.join(root, "runs", "batch10");
  fs.mkdirSync(runsDir, { recursive: true });

  const summaries: Record<string, unknown>[] = [];
  const findings: Finding[] = [];

  for (const t of TACTICS) {
    process.stderr.write(`Run ${t.id}/10 seed=${t.seed} notes="${t.notes}"...\n`);
    const result = await runEncounter(fixture, {
      seed: t.seed,
      notes: t.notes,
      maxRounds: 20,
      save: true,
      runsDir,
    });
    const { summary, findings: f } = analyzeRun(t.id, t.notes, result);
    summaries.push(summary);
    findings.push(...f);
    process.stderr.write(
      `  → ${summary.winner} in ${summary.rounds}r (${summary.endReason}) partyDmg=${summary.partyDmg} enemyDmg=${summary.enemyDmg}\n`,
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    encounter: fixture.id,
    tactics: TACTICS,
    summaries,
    findings,
    findingCounts: {
      error: findings.filter((f) => f.severity === "error").length,
      warn: findings.filter((f) => f.severity === "warn").length,
      info: findings.filter((f) => f.severity === "info").length,
    },
  };

  const outPath = path.join(runsDir, `batch10-report.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  process.stderr.write(`Wrote ${outPath}\n`);

  const { rejects, total, sourceHint } = tallyTacticsRejects(
    summaries.map((s) => String((s as { runDir?: string }).runDir ?? "")),
  );
  const pretty = prettyReportFromBatch10Json(report, {
    rejects,
    totalRejects: total,
    rejectSource: sourceHint,
    footer: `Report: ${outPath}`,
  });
  const htmlPath = path.join(runsDir, "batch10-results.html");
  fs.writeFileSync(htmlPath, renderPrettyBatchHtml(pretty));
  process.stderr.write(`Wrote ${htmlPath}\n`);

  console.log(JSON.stringify(report, null, 2));
}

function tallyTacticsRejects(runDirs: string[]): {
  rejects: PrettyReject[];
  total: number;
  sourceHint: string;
} {
  const counts = new Map<string, number>();
  let total = 0;
  const re = /TACTICS reject \[([^\]]+)\]/g;
  for (const dir of runDirs) {
    if (!dir) continue;
    const walk = path.join(dir, "walkthrough.md");
    if (!fs.existsSync(walk)) continue;
    const text = fs.readFileSync(walk, "utf8");
    for (const m of text.matchAll(re)) {
      const skill = m[1] ?? "unknown";
      counts.set(skill, (counts.get(skill) ?? 0) + 1);
      total += 1;
    }
  }
  const rejects = [...counts.entries()]
    .map(([skill, count]) => ({ skill, count }))
    .sort((a, b) => b.count - a.count);
  return {
    rejects,
    total,
    sourceHint: "walkthrough.md under runs/batch10/classic-four-vs-goblins/*",
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
