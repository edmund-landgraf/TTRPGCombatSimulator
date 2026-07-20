/**
 * Real-Time Combat State Parser — builds live snapshots from CombatMemory
 * to feed the Grandmaster Combat Loop. Never uses hardcoded demo values.
 */
import parserMeta from "./modules/realtime-combat-state-parser.json" with { type: "json" };
import type { CombatantState, CombatMemory, Condition } from "../memory/combatMemory.js";
import { living } from "../memory/combatMemory.js";
import { cellId, isCoverTags, type Position } from "../memory/schemas.js";
import { chebyshev, hasCover } from "../map/grid.js";
import { findPath } from "../map/pathfind.js";
import { occupiedKeys } from "../memory/combatMemory.js";
import { isAdjacent, isFlanking } from "./flank.js";
import { isAgainstWall, isFlankedBy } from "./spatialThreat.js";
import { groupFlags } from "./tacticsGroups.js";
import { isBruteRole, isCasterSquishRole, isMindlessRole } from "./combatLoop.js";

export const COMBAT_STATE_PARSER = parserMeta;

export const TOTAL_ACTIONS = 3;
/** PF2e: 1 grid square = 5 feet. */
export const FEET_PER_CELL = 5;

export type PersistentDamageEntry = {
  type: string;
  value: number;
  durationRounds: number;
};

export type StatusDebuffEntry = {
  name: string;
  value: number | boolean;
};

export type EnemyRegistryEntry = {
  enemyID: string;
  name: string;
  gridSquare: string;
  cellId: string;
  distanceInFeet: number;
  distanceCells: number;
  suspectedWeakSave: "Fortitude" | "Reflex" | "Will" | "Unknown";
  hasReactiveStrike: boolean;
  isOffGuard: boolean;
  hp: number;
  maxHp: number;
  ac: number;
  saveBonus: number;
};

export type CombatStateSnapshot = {
  parserName: string;
  version: string;
  roundTracking: {
    currentRound: number;
    currentTurnActive: boolean;
    activeActorId: string;
  };
  characterVitals: {
    maxHP: number;
    currentHP: number;
    shieldHardness: number;
    shieldHP: number;
    isShieldRaised: boolean;
    baseSpeedFeet: number;
    baseSpeedCells: number;
    ac: number;
    effectiveAc: number;
  };
  actionBudgetTracker: {
    totalActions: number;
    remainingActions: number;
    reactionAvailable: boolean;
    /** Number of attack-trait actions taken this turn. */
    attackCount: number;
    /** Numeric MAP penalty applied to the next attack (0, −4/−5, −8/−10). */
    currentMAP: number;
    agileWeaponEquipped: boolean;
  };
  spatialCoordinates: {
    currentGridSquare: string;
    cellId: string;
    adjacentEnemies: string[];
    isFlanked: boolean;
    isAnchoredToWall: boolean;
    nearestCoverSquare: string | null;
    nearestCoverCellId: string | null;
    distanceToNearestCoverFeet: number | null;
    distanceToNearestCoverCells: number | null;
  };
  activeStatusEffects: {
    persistentDamage: PersistentDamageEntry[];
    statusDebuffs: StatusDebuffEntry[];
  };
  knownEnemyRegistry: EnemyRegistryEntry[];
};

/** Algebraic grid label from 1-based coords (x=1→A, y=1→1 → "A1"). */
export function toGridSquare(pos: Position): string {
  const col =
    pos.x <= 26 ? String.fromCharCode(64 + pos.x) : `X${pos.x}`;
  return `${col}${pos.y}`;
}

export function agileWeaponEquipped(actor: CombatantState): boolean {
  return actor.weapons.some((w) => w.agile === true);
}

/**
 * MAP penalty from attack-trait count (not remaining actions alone).
 * Agile: 0 / −4 / −8; normal: 0 / −5 / −10.
 */
export function currentMapPenalty(attackCount: number, agile: boolean): number {
  if (attackCount <= 0) return 0;
  if (attackCount === 1) return agile ? -4 : -5;
  return agile ? -8 : -10;
}

function condValue(c: Condition): number {
  return c.value ?? 1;
}

function suspectedWeakSave(
  foe: CombatantState,
): EnemyRegistryEntry["suspectedWeakSave"] {
  if (isMindlessRole(foe.role)) return "Will";
  if (isCasterSquishRole(foe.role)) return "Fortitude";
  if (isBruteRole(foe.role)) return "Reflex";
  // Lowest saveBonus → treat as general soft defense (Reflex proxy when tied).
  return "Unknown";
}

function enemyLikelyHasReactiveStrike(foe: CombatantState): boolean {
  const f = groupFlags(foe);
  if (f.preferMelee && !f.keepDistance) return true;
  const r = foe.role.toLowerCase();
  return (
    r.includes("fighter") ||
    r.includes("blade") ||
    r.includes("soldier") ||
    r.includes("warrior") ||
    r.includes("brute")
  );
}

function nearestCover(
  mem: CombatMemory,
  actor: CombatantState,
): { pos: Position; cells: number } | null {
  if (hasCover(mem.grid, actor.pos)) {
    return { pos: actor.pos, cells: 0 };
  }
  const blocked = occupiedKeys(mem, actor.id);
  let best: { pos: Position; cells: number } | null = null;
  for (const cell of mem.grid.walkable.values()) {
    if (!isCoverTags(cell.tags)) continue;
    const p = { x: cell.x, y: cell.y };
    if (blocked.has(cellId(p))) continue;
    const path = findPath(mem.grid, actor.pos, p, actor.speedCells * 4, blocked);
    if (!path.ok) continue;
    const cells = path.cost;
    if (!best || cells < best.cells) best = { pos: p, cells };
  }
  return best;
}

function parsePersistent(actor: CombatantState): PersistentDamageEntry[] {
  const out: PersistentDamageEntry[] = [];
  for (const c of actor.conditions) {
    const n = c.name.toLowerCase();
    if (
      n.includes("persistent") ||
      n === "burning" ||
      n === "bleeding" ||
      n === "bleed" ||
      n === "acid" ||
      n === "fire"
    ) {
      out.push({
        type: c.name,
        value: condValue(c),
        durationRounds: c.value != null && c.value < 0 ? 0 : Math.max(0, condValue(c)),
      });
    }
  }
  return out;
}

function parseDebuffs(actor: CombatantState, isFlanked: boolean): StatusDebuffEntry[] {
  const names = ["frightened", "sickened", "off-guard", "off_guard", "offguard"];
  const found: StatusDebuffEntry[] = [];
  for (const want of ["Frightened", "Sickened"]) {
    const c = actor.conditions.find(
      (x) => x.name.toLowerCase() === want.toLowerCase(),
    );
    found.push({ name: want, value: c ? condValue(c) : 0 });
  }
  const greaseOg = actor.conditions.some((c) =>
    names.slice(2).includes(c.name.toLowerCase()),
  );
  found.push({ name: "Off-Guard", value: isFlanked || greaseOg });
  return found;
}

/** Sync geometric Off-Guard into conditions bag for downstream consumers. */
export function syncOffGuardCondition(mem: CombatMemory, actor: CombatantState): void {
  const flanked = isFlankedBy(mem, actor);
  const has = actor.conditions.some(
    (c) =>
      c.name.toLowerCase() === "off-guard" ||
      c.name.toLowerCase() === "off_guard",
  );
  if (flanked && !has) {
    actor.conditions.push({ id: "off-guard", name: "off-guard", value: 1 });
  } else if (!flanked && has) {
    // Keep Grease-applied off-guard (no value from geometry sync only).
    actor.conditions = actor.conditions.filter((c) => {
      if (c.name.toLowerCase() !== "off-guard" && c.name.toLowerCase() !== "off_guard") {
        return true;
      }
      // Drop geometry-synced entries (value === 1 id off-guard from sync).
      return c.id !== "off-guard";
    });
  }
}

/**
 * Parse live combat state for `actor`. Call at turn start, after moves, and
 * whenever the Grandmaster loop needs a fresh feed.
 */
export function parseCombatState(
  mem: CombatMemory,
  actor: CombatantState,
  opts?: { turnActive?: boolean },
): CombatStateSnapshot {
  syncOffGuardCondition(mem, actor);

  const turnActive =
    opts?.turnActive ??
    (mem.activeGrandmasterPlan?.actorId === actor.id ||
      mem.initiative[mem.initIndex] === actor.id);

  const agile = agileWeaponEquipped(actor);
  const attackCount = actor.map;
  const flanked = isFlankedBy(mem, actor);
  const adj = living(mem, actor.side === "party" ? "enemy" : "party").filter((f) =>
    isAdjacent(actor.pos, f.pos, 1),
  );
  const cover = nearestCover(mem, actor);
  const raised = actor.isShieldRaised === true;
  const shieldBonus = raised ? 2 : 0;

  const registry: EnemyRegistryEntry[] = living(
    mem,
    actor.side === "party" ? "enemy" : "party",
  ).map((foe) => {
    const dCells = chebyshev(actor.pos, foe.pos);
    return {
      enemyID: foe.id,
      name: foe.name,
      gridSquare: toGridSquare(foe.pos),
      cellId: cellId(foe.pos),
      distanceInFeet: dCells * FEET_PER_CELL,
      distanceCells: dCells,
      suspectedWeakSave: suspectedWeakSave(foe),
      hasReactiveStrike: enemyLikelyHasReactiveStrike(foe),
      isOffGuard: isFlanking(mem, actor, foe),
      hp: foe.hp,
      maxHp: foe.maxHp,
      ac: foe.ac,
      saveBonus: foe.saveBonus,
    };
  });

  return {
    parserName: COMBAT_STATE_PARSER.parserName,
    version: COMBAT_STATE_PARSER.version,
    roundTracking: {
      currentRound: mem.round,
      currentTurnActive: !!turnActive,
      activeActorId: actor.id,
    },
    characterVitals: {
      maxHP: actor.maxHp,
      currentHP: actor.hp,
      shieldHardness: actor.shieldHardness ?? 0,
      shieldHP: actor.shieldHp ?? 0,
      isShieldRaised: raised,
      baseSpeedFeet: actor.speedCells * FEET_PER_CELL,
      baseSpeedCells: actor.speedCells,
      ac: actor.ac,
      effectiveAc: actor.ac + shieldBonus - (flanked ? 2 : 0),
    },
    actionBudgetTracker: {
      totalActions: TOTAL_ACTIONS,
      remainingActions: actor.actionsLeft,
      reactionAvailable: actor.reactionAvailable,
      attackCount,
      currentMAP: currentMapPenalty(attackCount, agile),
      agileWeaponEquipped: agile,
    },
    spatialCoordinates: {
      currentGridSquare: toGridSquare(actor.pos),
      cellId: cellId(actor.pos),
      adjacentEnemies: adj.map((e) => e.id),
      isFlanked: flanked,
      isAnchoredToWall: isAgainstWall(mem.grid, actor.pos),
      nearestCoverSquare: cover ? toGridSquare(cover.pos) : null,
      nearestCoverCellId: cover ? cellId(cover.pos) : null,
      distanceToNearestCoverFeet:
        cover != null ? cover.cells * FEET_PER_CELL : null,
      distanceToNearestCoverCells: cover?.cells ?? null,
    },
    activeStatusEffects: {
      persistentDamage: parsePersistent(actor),
      statusDebuffs: parseDebuffs(actor, flanked),
    },
    knownEnemyRegistry: registry,
  };
}

/** After an [Attack] trait action — MAP is already bumped via actor.map; re-parse. */
export function afterAttackTrait(actor: CombatantState): {
  attackCount: number;
  currentMAP: number;
} {
  const agile = agileWeaponEquipped(actor);
  return {
    attackCount: actor.map,
    currentMAP: currentMapPenalty(actor.map, agile),
  };
}

/**
 * End-of-turn decay: persistent tick, Frightened−1, clear shield raise & MAP.
 * Call when the agent's action budget is exhausted / turn ends.
 */
export function applyEndOfTurnDecay(
  mem: CombatMemory,
  actor: CombatantState,
  log: string[],
): void {
  // Persistent damage tick
  for (const c of [...actor.conditions]) {
    const n = c.name.toLowerCase();
    if (
      !(
        n.includes("persistent") ||
        n === "burning" ||
        n === "bleeding" ||
        n === "bleed" ||
        n === "acid" ||
        n === "fire"
      )
    ) {
      continue;
    }
    const tick = Math.max(1, condValue(c));
    const before = actor.hp;
    actor.hp = Math.max(0, actor.hp - tick);
    mem.events.push({
      t: "hazard",
      round: mem.round,
      actor: actor.id,
      cell: cellId(actor.pos),
      dmg: before - actor.hp,
      hpAfter: actor.hp,
    });
    log.push(
      `  EOT decay: persistent ${c.name} ticks ${tick} → hp ${actor.hp}/${actor.maxHp}`,
    );
    if (actor.hp <= 0) actor.downed = true;
  }

  // Frightened value decays by 1 at end of turn
  for (const c of actor.conditions) {
    if (c.name.toLowerCase() !== "frightened") continue;
    const v = condValue(c);
    if (v <= 1) {
      actor.conditions = actor.conditions.filter((x) => x !== c);
      log.push("  EOT decay: Frightened removed");
    } else {
      c.value = v - 1;
      log.push(`  EOT decay: Frightened → ${c.value}`);
    }
  }

  // Reset shield raise & MAP for next turn boundary (startTurn also resets MAP).
  if (actor.isShieldRaised) {
    actor.isShieldRaised = false;
    log.push("  EOT decay: shield lowered");
  }
  actor.map = 0;
}

/** Raise a Shield — runtime state for AC / Shield Block intent. */
export function raiseShield(actor: CombatantState, log: string[]): void {
  actor.isShieldRaised = true;
  log.push(
    `  Raise a Shield — AC +2 circumstance (hardness ${actor.shieldHardness ?? 0})`,
  );
}

export function formatCombatState(snapshot: CombatStateSnapshot): string[] {
  const a = snapshot.actionBudgetTracker;
  const s = snapshot.spatialCoordinates;
  const v = snapshot.characterVitals;
  const lines = [
    `  STATE v${snapshot.version} r${snapshot.roundTracking.currentRound} @ ${s.currentGridSquare} (${s.cellId})`,
    `    HP ${v.currentHP}/${v.maxHP} AC ${v.ac} (eff ${v.effectiveAc}) spd ${v.baseSpeedFeet}ft shieldRaised=${v.isShieldRaised}`,
    `    actions ${a.remainingActions}/${a.totalActions} MAP ${a.currentMAP} (attacks=${a.attackCount}${a.agileWeaponEquipped ? ", agile" : ""}) reaction=${a.reactionAvailable}`,
    `    flanked=${s.isFlanked} wallAnchor=${s.isAnchoredToWall} adj=[${s.adjacentEnemies.join(",") || "—"}] cover=${s.nearestCoverSquare ?? "—"} (${s.distanceToNearestCoverFeet ?? "—"}ft)`,
  ];
  const pers = snapshot.activeStatusEffects.persistentDamage;
  const deb = snapshot.activeStatusEffects.statusDebuffs.filter((d) =>
    typeof d.value === "boolean" ? d.value : (d.value as number) > 0,
  );
  if (pers.length || deb.length) {
    lines.push(
      `    status: ${[
        ...pers.map((p) => `${p.type}:${p.value}`),
        ...deb.map((d) => `${d.name}:${d.value}`),
      ].join(", ")}`,
    );
  }
  if (snapshot.knownEnemyRegistry.length) {
    const top = snapshot.knownEnemyRegistry
      .slice()
      .sort((x, y) => x.distanceCells - y.distanceCells)
      .slice(0, 4)
      .map(
        (e) =>
          `${e.enemyID}@${e.gridSquare} ${e.distanceInFeet}ft weak=${e.suspectedWeakSave}${e.isOffGuard ? " OG" : ""}${e.hasReactiveStrike ? " RS" : ""}`,
      );
    lines.push(`    enemies: ${top.join("; ")}`);
  }
  return lines;
}
