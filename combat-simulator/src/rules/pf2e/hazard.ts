/**
 * PF2e hazards (traps / haunts / environmental) — combat-scoped triggers.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ActiveHazard,
  CombatantState,
  CombatMemory,
} from "../../memory/combatMemory.js";
import {
  cellId,
  HazardSchema,
  type Hazard,
  type HazardPlacement,
  type Position,
} from "../../memory/schemas.js";
import { COMBAT_HAZARD_STUBS } from "../../ingest/hazards/combatStubs.js";
import { applyIncomingDamage } from "./dying.js";
import { exposeAffliction } from "./affliction.js";
import { rollDamage } from "./damage.js";
import type { SeededRng } from "./rng.js";

export type { ActiveHazard };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "../../..");

let cachedCatalog: Hazard[] | null = null;

export function loadHazardCatalog(forceReload = false): Hazard[] {
  if (cachedCatalog && !forceReload) return cachedCatalog;
  const candidates = [
    path.join(process.cwd(), "data", "hazards", "catalog.json"),
    path.join(PACKAGE_ROOT, "data", "hazards", "catalog.json"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as { hazards?: unknown[] };
      if (Array.isArray(raw.hazards) && raw.hazards.length > 0) {
        cachedCatalog = raw.hazards.map((h) => HazardSchema.parse(h));
        return cachedCatalog;
      }
    } catch {
      // fall through
    }
  }
  cachedCatalog = COMBAT_HAZARD_STUBS.map((s) => HazardSchema.parse(s));
  return cachedCatalog;
}

export function lookupHazard(idOrName: string): Hazard | undefined {
  const key = idOrName.trim().toLowerCase();
  return loadHazardCatalog().find(
    (h) => h.id === key || h.name.toLowerCase() === key,
  );
}

function paintHazardCells(mem: CombatMemory, cells: Position[], tags: string[]): void {
  for (const pos of cells) {
    const id = cellId(pos);
    const existing = mem.grid.walkable.get(id);
    if (!existing) continue;
    const merged = new Set([...existing.tags, ...tags]);
    mem.grid.walkable.set(id, { ...existing, tags: [...merged] as typeof existing.tags });
  }
}

/** Install fixture hazard placements onto combat memory. */
export function placeHazardsFromFixture(
  mem: CombatMemory,
  placements: HazardPlacement[],
): string[] {
  const log: string[] = [];
  let n = 0;
  for (const p of placements) {
    const def = lookupHazard(p.hazardId);
    if (!def) {
      log.push(`  Hazard unknown: ${p.hazardId}`);
      continue;
    }
    n += 1;
    const instanceId = `hz_${def.id}_${n}`;
    const cells = p.cells.map((c) => cellId(c));
    mem.activeHazards.push({
      instanceId,
      hazardId: def.id,
      name: def.name,
      cells,
      armed: !p.disabled,
      triggered: false,
      definition: def,
    });
    if (def.paintTags.length) {
      paintHazardCells(mem, p.cells, def.paintTags);
    }
    log.push(
      `  Placed ${def.name} @ ${cells.join(",")}` + (p.disabled ? " (disabled)" : ""),
    );
  }
  return log;
}

function resolveHazardEffect(
  mem: CombatMemory,
  actor: CombatantState,
  hz: ActiveHazard,
  rng: SeededRng,
  log: string[],
): void {
  const def = hz.definition;
  let dmg = 0;
  let hit = true;
  let saved = false;

  if (def.attackBonus != null) {
    const d20 = rng.d20();
    const total = d20 + def.attackBonus;
    const crit = d20 === 20 || total >= actor.ac + 10;
    hit = crit || total >= actor.ac;
    log.push(
      `  ${def.name}: attack ${total} vs AC ${actor.ac} — ${hit ? (crit ? "crit" : "hit") : "miss"}`,
    );
    if (hit && def.damageDice > 0 && def.damageDie) {
      const roll = rollDamage(rng, def.damageDice, def.damageDie, def.damageBonus, crit);
      dmg = roll.total;
    }
  } else if (def.saveDc != null) {
    const d20 = rng.d20();
    const total = d20 + actor.saveBonus;
    const success = d20 === 20 || total >= def.saveDc;
    saved = success;
    log.push(
      `  ${def.name}: save ${total} vs DC ${def.saveDc} — ${saved ? "success" : "fail"}`,
    );
    if (def.damageDice > 0 && def.damageDie) {
      const roll = rollDamage(rng, def.damageDice, def.damageDie, def.damageBonus, false);
      dmg = saved && def.halfOnSave !== false ? Math.floor(roll.total / 2) : roll.total;
      if (saved && def.halfOnSave === false) dmg = 0;
    }
    if (!saved && def.applyCondition) {
      if (!actor.conditions.some((c) => c.name === def.applyCondition)) {
        actor.conditions.push({ id: def.applyCondition, name: def.applyCondition });
      }
    }
    if (!saved && def.applyAffliction) {
      exposeAffliction(mem, actor, def.applyAffliction, rng, log);
    }
  } else if (def.damageDice > 0 && def.damageDie) {
    const roll = rollDamage(rng, def.damageDice, def.damageDie, def.damageBonus, false);
    dmg = roll.total;
  }

  if (def.attackBonus != null && hit && def.applyCondition) {
    if (!actor.conditions.some((c) => c.name === def.applyCondition)) {
      actor.conditions.push({ id: def.applyCondition!, name: def.applyCondition! });
    }
  }
  if (def.attackBonus != null && hit && def.applyAffliction) {
    exposeAffliction(mem, actor, def.applyAffliction, rng, log);
  }

  if (dmg > 0) applyIncomingDamage(actor, dmg, { critical: false });

  mem.events.push({
    t: "hazard_trigger",
    round: mem.round,
    actor: actor.id,
    hazard: def.id,
    hazardName: def.name,
    instanceId: hz.instanceId,
    cell: cellId(actor.pos),
    dmg,
    hpAfter: actor.hp,
    hit,
    saved: def.saveDc != null ? saved : undefined,
  });
  log.push(`  ${def.name} deals ${dmg} to ${actor.id} (hp ${actor.hp}/${actor.maxHp})`);

  hz.triggered = true;
  if (def.once) hz.armed = false;
}

/** Trigger armed enter_square hazards when actor steps onto their cells. */
export function triggerHazardsOnEnter(
  mem: CombatMemory,
  actor: CombatantState,
  entered: Position[],
  rng: SeededRng,
  log: string[],
): void {
  const enteredIds = new Set(entered.map((p) => cellId(p)));
  for (const hz of mem.activeHazards) {
    if (!hz.armed) continue;
    if (hz.definition.trigger !== "enter_square") continue;
    if (!hz.cells.some((c) => enteredIds.has(c))) continue;
    resolveHazardEffect(mem, actor, hz, rng, log);
  }
}

/** End-of-turn triggers for complex / lingering hazards. */
export function triggerHazardsEndOfTurn(
  mem: CombatMemory,
  actor: CombatantState,
  rng: SeededRng,
  log: string[],
): void {
  const here = cellId(actor.pos);
  for (const hz of mem.activeHazards) {
    if (!hz.armed) continue;
    if (hz.definition.trigger !== "end_turn_in") continue;
    if (!hz.cells.includes(here)) continue;
    resolveHazardEffect(mem, actor, hz, rng, log);
  }
}

/** Attempt to disable a hazard (simplified: Thievery vs disableDc using saveBonus as proxy). */
export function tryDisableHazard(
  mem: CombatMemory,
  actor: CombatantState,
  instanceId: string,
  rng: SeededRng,
  log: string[],
): boolean {
  const hz = mem.activeHazards.find((h) => h.instanceId === instanceId);
  if (!hz) {
    log.push(`  No hazard instance ${instanceId}`);
    return false;
  }
  if (!hz.armed) {
    log.push(`  ${hz.name} already disarmed`);
    return false;
  }
  const dc = hz.definition.disableDc ?? 15;
  const d20 = rng.d20();
  const total = d20 + actor.saveBonus; // proxy skill until skills exist
  const ok = total >= dc;
  log.push(
    `  Disable ${hz.name}: ${hz.definition.disableSkill ?? "Thievery"} ${total} vs DC ${dc} — ${ok ? "success" : "fail"}`,
  );
  if (ok) {
    hz.armed = false;
    mem.events.push({
      t: "hazard_disable",
      round: mem.round,
      actor: actor.id,
      hazard: hz.hazardId,
      hazardName: hz.name,
      instanceId: hz.instanceId,
      success: true,
    });
  }
  return ok;
}
