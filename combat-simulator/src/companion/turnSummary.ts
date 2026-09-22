import type { CombatMemory } from "../memory/combatMemory.js";
import type { BoardSnapshot } from "./session.js";

export type TurnActionLine = {
  slot: number;
  text: string;
};

export type TurnSummary = {
  actorId: string;
  actorName: string;
  side: "party" | "enemy";
  actions: TurnActionLine[];
};

const TURN_HEADER = /^---\s+(\S+)\s+\(([^)]+)\)\s+---$/;

const SKIP_PREFIXES = [
  "GM-LOOP",
  "GM-BUDGET",
  "BUILD:",
  "FEATS:",
  "Step 1:",
  "Step 2:",
  "Step 3:",
  "Step 4:",
  "Step 5:",
  "Step 6:",
  "MAP policy:",
  "3-ACTION BUDGET:",
  "REACTIONS:",
  "COMBAT STATE",
  "parser feed",
  "EOT decay:",
  "Real-Time Combat",
  "nodes:",
  "· ",
];

function isActionLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.startsWith("(")) return true;
  return /^(Stride|Step|Strike|Cast|Heal|Trip|Raise|Delay|HAZARD|REJECT|Shield|TACTICS)/.test(t);
}

/** Extract player-visible actions from a single turn log block. */
export function parseTurnSummary(
  actionLog: string,
  mem?: CombatMemory | null,
): TurnSummary | null {
  const lines = actionLog.trim().split("\n");
  let actorId = "";
  let actorName = "";
  const actions: TurnActionLine[] = [];
  let slot = 0;

  for (const line of lines) {
    const hdr = line.match(TURN_HEADER);
    if (hdr) {
      actorId = hdr[1]!;
      actorName = hdr[2]!;
      continue;
    }
    if (!actorId) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (SKIP_PREFIXES.some((p) => trimmed.startsWith(p))) continue;
    if (/^A\d+:/.test(trimmed)) continue;
    if (!isActionLine(line)) continue;
    slot++;
    actions.push({ slot, text: trimmed });
  }

  if (!actorId) return null;
  const side = mem?.combatants.get(actorId)?.side ?? "party";
  return { actorId, actorName, side, actions };
}

export function snapshotEnemyPositions(
  mem: CombatMemory,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  for (const c of mem.combatants.values()) {
    if (c.side === "enemy") out.set(c.id, { x: c.pos.x, y: c.pos.y });
  }
  return out;
}

/** Party tokens live; enemy tokens optionally held at pre-turn positions. */
export function buildDisplayBoard(
  live: BoardSnapshot,
  frozenEnemyPositions: Map<string, { x: number; y: number }> | null,
): BoardSnapshot {
  if (!frozenEnemyPositions) return live;
  return {
    ...live,
    tokens: live.tokens.map((t) => {
      if (t.side !== "enemy") return t;
      const pos = frozenEnemyPositions.get(t.id);
      return pos ? { ...t, x: pos.x, y: pos.y } : t;
    }),
  };
}
