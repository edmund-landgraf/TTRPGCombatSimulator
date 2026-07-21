/**
 * PF2e afflictions (poison / disease / curse) — combat-scoped:
 * initial save → stages → interval saves → recovery / max duration.
 */
import type {
  ActiveAffliction,
  CombatantState,
  CombatMemory,
} from "../../memory/combatMemory.js";
import type { Affliction, AfflictionStage } from "../../memory/schemas.js";
import { AfflictionSchema } from "../../memory/schemas.js";
import { COMBAT_AFFLICTION_STUBS } from "../../ingest/afflictions/combatStubs.js";
import { applyIncomingDamage } from "./dying.js";
import type { SeededRng } from "./rng.js";
import { rollDamage } from "./damage.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type { ActiveAffliction };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "../../..");

let cachedCatalog: Affliction[] | null = null;

function stubToAffliction(stub: (typeof COMBAT_AFFLICTION_STUBS)[number]): Affliction {
  return AfflictionSchema.parse({
    id: stub.id,
    name: stub.name,
    kind: stub.kind,
    level: stub.level,
    saveDc: stub.saveDc,
    virulent: stub.virulent ?? false,
    maxDurationRounds: stub.maxDurationRounds,
    stages: stub.stages,
    aonId: stub.aonId,
    aonUrl: stub.aonUrl,
    summary: stub.summary,
  });
}

export function loadAfflictionCatalog(forceReload = false): Affliction[] {
  if (cachedCatalog && !forceReload) return cachedCatalog;
  const candidates = [
    path.join(process.cwd(), "data", "afflictions", "catalog.json"),
    path.join(PACKAGE_ROOT, "data", "afflictions", "catalog.json"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as { afflictions?: unknown[] };
      if (Array.isArray(raw.afflictions) && raw.afflictions.length > 0) {
        cachedCatalog = raw.afflictions.map((a) => AfflictionSchema.parse(a));
        return cachedCatalog;
      }
    } catch {
      // fall through
    }
  }
  cachedCatalog = COMBAT_AFFLICTION_STUBS.map(stubToAffliction);
  return cachedCatalog;
}

export function lookupAffliction(idOrName: string): Affliction | undefined {
  const key = idOrName.trim().toLowerCase();
  return loadAfflictionCatalog().find(
    (a) => a.id === key || a.name.toLowerCase() === key,
  );
}

function stageDef(def: Affliction, stage: number): AfflictionStage {
  const idx = Math.min(Math.max(1, stage), def.stages.length) - 1;
  return def.stages[idx]!;
}

function applyStageEffects(
  mem: CombatMemory,
  target: CombatantState,
  def: Affliction,
  stage: number,
  rng: SeededRng,
  log: string[],
): number {
  const st = stageDef(def, stage);
  let dmg = 0;
  if (st.damageDice > 0 && st.damageDie) {
    const roll = rollDamage(rng, st.damageDice, st.damageDie, st.damageBonus ?? 0, false);
    dmg = roll.total;
    if (dmg > 0) applyIncomingDamage(target, dmg, { critical: false });
  }
  for (const name of st.conditions) {
    const existing = target.conditions.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (st.conditionValue != null) {
        existing.value = Math.max(existing.value ?? 0, st.conditionValue);
      }
    } else {
      target.conditions.push({
        id: name,
        name,
        value: st.conditionValue,
      });
    }
  }
  log.push(
    `  Affliction ${def.name} stage ${stage}` +
      (dmg ? ` deals ${dmg}` : "") +
      (st.conditions.length ? ` [${st.conditions.join(", ")}]` : ""),
  );
  mem.events.push({
    t: "affliction",
    round: mem.round,
    actor: target.id,
    affliction: def.id,
    afflictionName: def.name,
    kind: def.kind,
    stage,
    dmg,
    hpAfter: target.hp,
    outcome: "stage_effect",
  });
  return dmg;
}

function clearStageConditions(target: CombatantState, def: Affliction): void {
  const names = new Set(
    def.stages.flatMap((s) => s.conditions.map((c) => c.toLowerCase())),
  );
  // Keep frightened/sickened/etc. that may come from other sources — only remove
  // off-guard/clumsy/fatigued-style tags that this affliction applies if value-less
  // or we track ownership loosely. Simple approach: remove listed condition names
  // when no other active affliction still wants them.
  const stillWanted = new Set<string>();
  for (const a of target.afflictions) {
    if (a.id === def.id) continue;
    for (const c of stageDef(a.definition, a.stage).conditions) {
      stillWanted.add(c.toLowerCase());
    }
  }
  target.conditions = target.conditions.filter(
    (c) => !names.has(c.name.toLowerCase()) || stillWanted.has(c.name.toLowerCase()),
  );
}

/**
 * Initial exposure: Fort save vs DC.
 * Success → unaffected. Failure → stage 1. Crit fail → stage 2 (if exists).
 * Poison re-exposure while active: fail advances stage (PF2e multiple exposures).
 */
export function exposeAffliction(
  mem: CombatMemory,
  target: CombatantState,
  afflictionId: string,
  rng: SeededRng,
  log: string[],
  opts?: { saveDcOverride?: number },
): void {
  const def = lookupAffliction(afflictionId);
  if (!def) {
    log.push(`  Affliction unknown: ${afflictionId}`);
    return;
  }
  const dc = opts?.saveDcOverride ?? def.saveDc;
  const d20 = rng.d20();
  const total = d20 + target.saveBonus;
  const critSuccess = d20 === 20 || total >= dc + 10;
  const success = critSuccess || total >= dc;
  const critFail = d20 === 1 || total <= dc - 10;

  const existing = target.afflictions.find((a) => a.id === def.id);

  if (existing) {
    // Disease/curse: multiple exposures ignored. Poison: advance on fail.
    if (def.kind !== "poison") {
      log.push(`  ${def.name}: already afflicted (ignored)`);
      return;
    }
    if (success) {
      log.push(
        `  ${def.name} re-exposure: save ${total} vs DC ${dc} — resisted (no stage change)`,
      );
      mem.events.push({
        t: "affliction",
        round: mem.round,
        actor: target.id,
        affliction: def.id,
        afflictionName: def.name,
        kind: def.kind,
        stage: existing.stage,
        dmg: 0,
        hpAfter: target.hp,
        outcome: "resisted",
        saveRoll: d20,
        saveTotal: total,
        saveDc: dc,
      });
      return;
    }
    const bump = critFail ? 2 : 1;
    const prev = existing.stage;
    existing.stage = Math.min(def.stages.length, existing.stage + bump);
    existing.intervalLeft = stageDef(def, existing.stage).intervalRounds;
    log.push(
      `  ${def.name} re-exposure: fail ${total} vs DC ${dc} — stage ${prev}→${existing.stage}`,
    );
    applyStageEffects(mem, target, def, existing.stage, rng, log);
    return;
  }

  if (success) {
    log.push(`  ${def.name}: initial save ${total} vs DC ${dc} — unaffected`);
    mem.events.push({
      t: "affliction",
      round: mem.round,
      actor: target.id,
      affliction: def.id,
      afflictionName: def.name,
      kind: def.kind,
      stage: 0,
      dmg: 0,
      hpAfter: target.hp,
      outcome: "resisted",
      saveRoll: d20,
      saveTotal: total,
      saveDc: dc,
    });
    return;
  }

  const startStage = Math.min(def.stages.length, critFail ? 2 : 1);
  const active: ActiveAffliction = {
    id: def.id,
    name: def.name,
    kind: def.kind,
    stage: startStage,
    saveDc: dc,
    virulent: def.virulent,
    roundsLeft: def.maxDurationRounds,
    intervalLeft: stageDef(def, startStage).intervalRounds,
    virulentSuccessStreak: 0,
    definition: def,
  };
  target.afflictions.push(active);
  log.push(
    `  ${def.name}: initial save ${total} vs DC ${dc} — ${critFail ? "crit fail" : "fail"} → stage ${startStage}`,
  );
  applyStageEffects(mem, target, def, startStage, rng, log);
}

function removeAffliction(target: CombatantState, active: ActiveAffliction): void {
  clearStageConditions(target, active.definition);
  target.afflictions = target.afflictions.filter((a) => a !== active);
}

/**
 * End-of-turn: tick max duration + interval saves for this creature's afflictions.
 */
export function tickAfflictionsForActor(
  mem: CombatMemory,
  actor: CombatantState,
  rng: SeededRng,
  log: string[],
): void {
  for (const active of [...actor.afflictions]) {
    if (active.roundsLeft != null) {
      active.roundsLeft -= 1;
      if (active.roundsLeft <= 0) {
        log.push(`  ${active.name}: maximum duration elapsed — ends`);
        mem.events.push({
          t: "affliction",
          round: mem.round,
          actor: actor.id,
          affliction: active.id,
          afflictionName: active.name,
          kind: active.kind,
          stage: active.stage,
          dmg: 0,
          hpAfter: actor.hp,
          outcome: "ended",
        });
        removeAffliction(actor, active);
        continue;
      }
    }

    active.intervalLeft -= 1;
    if (active.intervalLeft > 0) continue;

    const def = active.definition;
    const d20 = rng.d20();
    const total = d20 + actor.saveBonus;
    const dc = active.saveDc;
    const critSuccess = d20 === 20 || total >= dc + 10;
    const success = critSuccess || total >= dc;
    const critFail = d20 === 1 || total <= dc - 10;

    if (success) {
      let reduce = critSuccess ? 2 : 1;
      if (active.virulent) {
        if (critSuccess) {
          reduce = 1;
          active.virulentSuccessStreak = 0;
        } else {
          active.virulentSuccessStreak += 1;
          if (active.virulentSuccessStreak < 2) {
            log.push(
              `  ${active.name}: virulent save success ${total} vs DC ${dc} — need another consecutive success`,
            );
            active.intervalLeft = stageDef(def, active.stage).intervalRounds;
            mem.events.push({
              t: "affliction",
              round: mem.round,
              actor: actor.id,
              affliction: active.id,
              afflictionName: active.name,
              kind: active.kind,
              stage: active.stage,
              dmg: 0,
              hpAfter: actor.hp,
              outcome: "progress_save",
              saveRoll: d20,
              saveTotal: total,
              saveDc: dc,
            });
            continue;
          }
          reduce = 1;
          active.virulentSuccessStreak = 0;
        }
      }
      const prev = active.stage;
      active.stage -= reduce;
      if (active.stage < 1) {
        log.push(`  ${active.name}: recovered (save ${total} vs DC ${dc})`);
        mem.events.push({
          t: "affliction",
          round: mem.round,
          actor: actor.id,
          affliction: active.id,
          afflictionName: active.name,
          kind: active.kind,
          stage: 0,
          dmg: 0,
          hpAfter: actor.hp,
          outcome: "recovered",
          saveRoll: d20,
          saveTotal: total,
          saveDc: dc,
        });
        removeAffliction(actor, active);
        continue;
      }
      log.push(
        `  ${active.name}: save ${total} vs DC ${dc} — stage ${prev}→${active.stage}`,
      );
      clearStageConditions(actor, def);
      applyStageEffects(mem, actor, def, active.stage, rng, log);
      active.intervalLeft = stageDef(def, active.stage).intervalRounds;
      mem.events.push({
        t: "affliction",
        round: mem.round,
        actor: actor.id,
        affliction: active.id,
        afflictionName: active.name,
        kind: active.kind,
        stage: active.stage,
        dmg: 0,
        hpAfter: actor.hp,
        outcome: "progress_save",
        saveRoll: d20,
        saveTotal: total,
        saveDc: dc,
      });
      continue;
    }

    // Failure: advance stage (or repeat highest)
    active.virulentSuccessStreak = 0;
    const bump = critFail ? 2 : 1;
    const prev = active.stage;
    active.stage = Math.min(def.stages.length, active.stage + bump);
    log.push(
      `  ${active.name}: ${critFail ? "crit fail" : "fail"} ${total} vs DC ${dc} — stage ${prev}→${active.stage}`,
    );
    clearStageConditions(actor, def);
    applyStageEffects(mem, actor, def, active.stage, rng, log);
    active.intervalLeft = stageDef(def, active.stage).intervalRounds;
    mem.events.push({
      t: "affliction",
      round: mem.round,
      actor: actor.id,
      affliction: active.id,
      afflictionName: active.name,
      kind: active.kind,
      stage: active.stage,
      dmg: 0,
      hpAfter: actor.hp,
      outcome: "progress_save",
      saveRoll: d20,
      saveTotal: total,
      saveDc: dc,
    });
  }
}
