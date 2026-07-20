import type { CombatantState, CombatMemory } from "../../memory/combatMemory.js";
import { occupiedKeys } from "../../memory/combatMemory.js";
import { cellId, type Position } from "../../memory/schemas.js";
import { isHazardous } from "../../map/grid.js";
import { findPath, moveAlongPath } from "../../map/pathfind.js";
import { HAZARD_DAMAGE_PER_CELL } from "../../ai/spatialThreat.js";

function applyHazardTraversal(
  mem: CombatMemory,
  actor: CombatantState,
  path: Position[],
  round: number,
): void {
  for (let i = 1; i < path.length; i++) {
    const p = path[i]!;
    if (!isHazardous(mem.grid, p)) continue;
    actor.hp = Math.max(0, actor.hp - HAZARD_DAMAGE_PER_CELL);
    mem.events.push({
      t: "hazard",
      round,
      actor: actor.id,
      cell: cellId(p),
      dmg: HAZARD_DAMAGE_PER_CELL,
      hpAfter: actor.hp,
    });
    if (actor.hp <= 0) actor.downed = true;
  }
}

export function resolveStride(
  mem: CombatMemory,
  actor: CombatantState,
  destination: Position,
  round: number,
): boolean {
  const blocked = occupiedKeys(mem, actor.id);
  const path = findPath(mem.grid, actor.pos, destination, actor.speedCells, blocked);
  if (!path.ok) {
    mem.events.push({ t: "reject", round, actor: actor.id, reason: path.reason });
    return false;
  }
  const from = cellId(actor.pos);
  // Never finish on an occupied cell (path may target a foe's square).
  let dest = moveAlongPath(path.path, actor.speedCells);
  for (let i = path.path.length - 1; i >= 1; i--) {
    const p = path.path[i]!;
    if (!blocked.has(cellId(p))) {
      dest = p;
      break;
    }
  }
  if (blocked.has(cellId(dest)) || cellId(dest) === from) {
    mem.events.push({
      t: "reject",
      round,
      actor: actor.id,
      reason: "Stride has no free cell along path",
    });
    return false;
  }
  // Truncate event path to the cells actually traversed.
  const destIdx = path.path.findIndex((p) => cellId(p) === cellId(dest));
  const traversed = destIdx >= 0 ? path.path.slice(0, destIdx + 1) : path.path;
  applyHazardTraversal(mem, actor, traversed, round);
  actor.pos = { ...dest };
  const to = cellId(actor.pos);
  mem.events.push({ t: "move", round, actor: actor.id, from, to, kind: "Stride" });
  actor.actionsLeft -= 1;
  return true;
}

export function resolveStep(
  mem: CombatMemory,
  actor: CombatantState,
  destination: Position,
  round: number,
): boolean {
  const blocked = occupiedKeys(mem, actor.id);
  if (blocked.has(cellId(destination))) {
    mem.events.push({
      t: "reject",
      round,
      actor: actor.id,
      reason: "Step destination occupied",
    });
    return false;
  }
  const path = findPath(mem.grid, actor.pos, destination, 1, blocked);
  if (!path.ok || path.cost > 1) {
    mem.events.push({
      t: "reject",
      round,
      actor: actor.id,
      reason: path.ok ? "Step farther than 1" : path.reason,
    });
    return false;
  }
  const from = cellId(actor.pos);
  applyHazardTraversal(mem, actor, [actor.pos, destination], round);
  actor.pos = { ...destination };
  mem.events.push({
    t: "move",
    round,
    actor: actor.id,
    from,
    to: cellId(actor.pos),
    kind: "Step",
  });
  actor.actionsLeft -= 1;
  return true;
}
