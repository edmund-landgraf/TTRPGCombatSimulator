import type { CombatantState, CombatMemory } from "../../memory/combatMemory.js";
import type { Spell } from "../../memory/schemas.js";
import { chebyshev, hasCover, hasLineOfSight } from "../../map/grid.js";
import { rollDamage } from "./damage.js";
import { mapPenalty } from "./strike.js";
import type { SeededRng } from "./rng.js";

export function spellUsesLeft(actor: CombatantState, spell: Spell): number {
  if (spell.rank === 0 || spell.usesPerCombat == null) return Infinity;
  const used = actor.spellUses.get(spell.id) ?? 0;
  return Math.max(0, spell.usesPerCombat - used);
}

/** PF2e-simplified: max spell rank by creature level (L1–2 → 1, L3–4 → 2, L5–6 → 3, …). */
export function maxSpellRankForLevel(creatureLevel: number): number {
  const level = Math.max(0, Math.floor(creatureLevel));
  if (level <= 0) return 0;
  return Math.floor((level + 1) / 2);
}

export function canCastSpell(
  mem: CombatMemory,
  caster: CombatantState,
  target: CombatantState,
  spell: Spell,
): boolean {
  if (caster.actionsLeft < spell.actions) return false;
  if (spell.rank > 0 && spell.rank > maxSpellRankForLevel(caster.level)) return false;
  if (spellUsesLeft(caster, spell) <= 0) return false;
  const dist = chebyshev(caster.pos, target.pos);
  if (dist > spell.rangeCells) return false;
  if (spell.kind !== "heal" && !hasLineOfSight(mem.grid, caster.pos, target.pos)) return false;
  if (spell.kind === "heal" && target.side !== caster.side) return false;
  if (spell.kind !== "heal" && (target.side === caster.side || target.downed)) return false;
  if (spell.kind === "heal" && target.hp >= target.maxHp && !target.downed) return false;
  if (
    spell.skipIfSaveBonusGte != null &&
    spell.kind !== "heal" &&
    target.saveBonus >= spell.skipIfSaveBonusGte
  ) {
    return false;
  }
  return true;
}

export function estimateSpellScore(
  mem: CombatMemory,
  caster: CombatantState,
  target: CombatantState,
  spell: Spell,
): number {
  if (!canCastSpell(mem, caster, target, spell)) return 0;
  if (spell.kind === "heal") {
    const missing = target.maxHp - target.hp;
    return Math.min(1, missing / 10);
  }
  if (spell.kind === "attack" && spell.attackBonus != null) {
    let ac = target.ac;
    if (hasCover(mem.grid, target.pos)) ac += 2;
    const mod = spell.attackBonus + mapPenalty(caster.map);
    const need = ac - mod;
    if (need <= 1) return 0.9;
    if (need >= 20) return 0.1;
    return Math.max(0.1, Math.min(0.9, (21 - need) / 20));
  }
  if (spell.kind === "save" && spell.saveDc != null) {
    const need = spell.saveDc - target.saveBonus;
    // chance fail roughly
    if (need <= 1) return 0.9;
    if (need >= 20) return 0.15;
    return Math.max(0.15, Math.min(0.85, (need - 1) / 20));
  }
  return 0.4;
}

export function resolveSpell(
  mem: CombatMemory,
  caster: CombatantState,
  target: CombatantState,
  spell: Spell,
  rng: SeededRng,
  round: number,
): void {
  if (!canCastSpell(mem, caster, target, spell)) {
    mem.events.push({
      t: "reject",
      round,
      actor: caster.id,
      reason: `Cannot cast ${spell.name}`,
    });
    return;
  }

  if (spell.rank > 0 && spell.usesPerCombat != null) {
    caster.spellUses.set(spell.id, (caster.spellUses.get(spell.id) ?? 0) + 1);
  }

  if (spell.kind === "heal") {
    const dice = spell.healDice ?? 1;
    const die = spell.healDie ?? 8;
    const bonus = spell.healBonus ?? 0;
    const roll = rollDamage(rng, dice, die, bonus, false);
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + roll.total);
    if (target.hp > 0) target.downed = false;
    mem.events.push({
      t: "spell",
      round,
      actor: caster.id,
      target: target.id,
      spell: spell.id,
      spellName: spell.name,
      kind: "heal",
      damageExpr: roll.expr,
      diceRolls: roll.rolls,
      damageBonus: roll.bonus,
      dmg: 0,
      healAmt: target.hp - before,
      hpAfter: target.hp,
      actionsSpent: spell.actions,
      map: caster.map,
    });
    caster.actionsLeft -= spell.actions;
    return;
  }

  if (spell.kind === "attack") {
    let ac = target.ac;
    if (hasCover(mem.grid, target.pos)) ac += 2;
    const d20 = rng.d20();
    const mod = (spell.attackBonus ?? 0) + mapPenalty(caster.map);
    const total = d20 + mod;
    const crit = d20 === 20 || total >= ac + 10;
    const hit = crit || total >= ac;
    let dmg = 0;
    let damageExpr = "";
    let diceRolls: number[] = [];
    let damageBonus = 0;
    if (hit && spell.damageDice && spell.damageDie) {
      const roll = rollDamage(rng, spell.damageDice, spell.damageDie, spell.damageBonus ?? 0, crit);
      dmg = roll.total;
      damageExpr = roll.expr;
      diceRolls = roll.rolls;
      damageBonus = roll.bonus;
      target.hp = Math.max(0, target.hp - dmg);
      target.conditions = target.conditions.filter((c) => c.name !== "asleep");
      if (target.hp <= 0) {
        target.downed = true;
        target.hp = 0;
      }
    }
    mem.events.push({
      t: "spell",
      round,
      actor: caster.id,
      target: target.id,
      spell: spell.id,
      spellName: spell.name,
      kind: "attack",
      d20,
      mod,
      total,
      ac,
      hit,
      crit,
      damageExpr,
      diceRolls,
      damageBonus,
      dmg,
      hpAfter: target.hp,
      actionsSpent: spell.actions,
      map: caster.map,
    });
    caster.map += 1;
    caster.actionsLeft -= spell.actions;
    return;
  }

  // save
  const dc = spell.saveDc ?? 15;
  const saveRoll = rng.d20();
  const saveTotal = saveRoll + target.saveBonus;
  const saved = saveTotal >= dc;
  let dmg = 0;
  let damageExpr = "";
  let diceRolls: number[] = [];
  let damageBonus = 0;
  if (spell.damageDice && spell.damageDie) {
    const roll = rollDamage(rng, spell.damageDice, spell.damageDie, spell.damageBonus ?? 0, false);
    damageExpr = roll.expr;
    diceRolls = roll.rolls;
    damageBonus = roll.bonus;
    dmg = saved && spell.halfOnSave !== false ? Math.floor(roll.total / 2) : roll.total;
    if (!saved || spell.halfOnSave !== false) {
      target.hp = Math.max(0, target.hp - dmg);
      if (dmg > 0) target.conditions = target.conditions.filter((c) => c.name !== "asleep");
      if (target.hp <= 0) {
        target.downed = true;
        target.hp = 0;
      }
    }
  }
  let applied: string | undefined;
  if (!saved && spell.applyCondition) {
    const name = spell.applyCondition;
    if (!target.conditions.some((c) => c.name === name)) {
      target.conditions.push({ id: name, name });
    }
    applied = name;
  }
  mem.events.push({
    t: "spell",
    round,
    actor: caster.id,
    target: target.id,
    spell: spell.id,
    spellName: spell.name,
    kind: "save",
    saveRoll,
    saveBonus: target.saveBonus,
    saveTotal,
    saveDc: dc,
    saved,
    damageExpr,
    diceRolls,
    damageBonus,
    dmg,
    hpAfter: target.hp,
    actionsSpent: spell.actions,
    map: caster.map,
    appliedCondition: applied,
  });
  caster.actionsLeft -= spell.actions;
}

export function formatSpellLine(
  e: Extract<CombatMemory["events"][number], { t: "spell" }>,
): string {
  if (e.kind === "heal") {
    const faces =
      (e.diceRolls?.length ?? 0) === 1
        ? `[${e.diceRolls![0]}]`
        : `[${(e.diceRolls ?? []).join(",")}]`;
    const bonusPart =
      e.damageBonus && e.damageBonus !== 0
        ? `${e.damageBonus > 0 ? "+" : ""}${e.damageBonus}`
        : "";
    return `  Cast ${e.spellName} on ${e.target}: heal ${e.damageExpr} → ${faces}${bonusPart} = ${e.healAmt} → hp ${e.hpAfter}`;
  }
  if (e.kind === "attack") {
    const result = e.crit ? "CRIT" : e.hit ? "HIT" : "MISS";
    let line = `  Cast ${e.spellName} at ${e.target}: spell attack d20 ${e.d20}+${e.mod}=${e.total} vs AC ${e.ac} ${result}`;
    if (e.hit && e.damageExpr) {
      const faces =
        (e.diceRolls?.length ?? 0) === 1
          ? `[${e.diceRolls![0]}]`
          : `[${(e.diceRolls ?? []).join(",")}]`;
      const bonusPart =
        e.damageBonus && e.damageBonus !== 0
          ? `${e.damageBonus > 0 ? "+" : ""}${e.damageBonus}`
          : "";
      const sub = (e.diceRolls ?? []).reduce((a, b) => a + b, 0) + (e.damageBonus ?? 0);
      line += `; ${e.damageExpr} → ${faces}${bonusPart} = ${sub}`;
      if (e.crit) line += ` (crit ×2 → ${e.dmg})`;
      line += ` → hp ${e.hpAfter}`;
    }
    return line;
  }
  const save = e.saved ? "SAVE" : "FAIL";
  let line = `  Cast ${e.spellName} at ${e.target}: save d20 ${e.saveRoll}+${e.saveBonus}=${e.saveTotal} vs DC ${e.saveDc} ${save}`;
  if (e.damageExpr) {
    const faces =
      (e.diceRolls?.length ?? 0) === 1
        ? `[${e.diceRolls![0]}]`
        : `[${(e.diceRolls ?? []).join(",")}]`;
    const bonusPart =
      e.damageBonus && e.damageBonus !== 0
        ? `${e.damageBonus > 0 ? "+" : ""}${e.damageBonus}`
        : "";
    const half = e.saved ? " (half)" : "";
    line += `; ${e.damageExpr} → ${faces}${bonusPart}${half} = ${e.dmg} → hp ${e.hpAfter}`;
  }
  if (e.appliedCondition) line += ` → ${e.target} is ${e.appliedCondition}`;
  return line;
}
