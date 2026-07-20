import type { CombatantState, CombatMemory } from "../../memory/combatMemory.js";
import type { Weapon } from "../../memory/schemas.js";
import { chebyshev, hasCover, hasLineOfSight } from "../../map/grid.js";
import { isFlanking } from "../../ai/flank.js";
import { groupFlags } from "../../ai/tacticsGroups.js";
import { formatDamageRoll, formatDiceExpr, rollDamage } from "./damage.js";
import type { SeededRng } from "./rng.js";

export function mapPenalty(map: number): number {
  if (map <= 0) return 0;
  if (map === 1) return -5;
  return -10;
}

export function weaponLabel(weapon: Weapon): string {
  return weapon.id.replace(/_/g, " ");
}

export function estimatePHit(
  mem: CombatMemory,
  attacker: CombatantState,
  target: CombatantState,
  weapon: Weapon,
): number {
  const dist = chebyshev(attacker.pos, target.pos);
  if (weapon.kind === "melee" && dist > (weapon.reach ?? 1)) return 0;
  if (weapon.kind === "ranged") {
    const range = weapon.rangeCells ?? 12;
    if (dist > range) return 0;
    if (!hasLineOfSight(mem.grid, attacker.pos, target.pos)) return 0;
  }
  let ac = target.ac;
  if (weapon.kind === "ranged" && hasCover(mem.grid, target.pos)) ac += 2;
  if (weapon.kind === "melee" && isFlanking(mem, attacker, target, weapon.reach ?? 1)) {
    ac -= 2; // off-guard from flanking
  }
  const mod = weapon.attackBonus + mapPenalty(attacker.map);
  const need = ac - mod;
  if (need <= 1) return 0.95;
  if (need >= 20) return 0.05;
  return Math.max(0.05, Math.min(0.95, (21 - need) / 20));
}

export function resolveStrike(
  mem: CombatMemory,
  attacker: CombatantState,
  target: CombatantState,
  weapon: Weapon,
  rng: SeededRng,
  round: number,
): void {
  const dist = chebyshev(attacker.pos, target.pos);
  if (weapon.kind === "melee" && dist > (weapon.reach ?? 1)) {
    mem.events.push({
      t: "reject",
      round,
      actor: attacker.id,
      reason: `Strike out of melee reach (${dist})`,
    });
    return;
  }
  if (weapon.kind === "ranged") {
    const range = weapon.rangeCells ?? 12;
    if (dist > range) {
      mem.events.push({
        t: "reject",
        round,
        actor: attacker.id,
        reason: `Strike out of range (${dist}>${range})`,
      });
      return;
    }
    if (!hasLineOfSight(mem.grid, attacker.pos, target.pos)) {
      mem.events.push({
        t: "reject",
        round,
        actor: attacker.id,
        reason: "Strike blocked (no LOS)",
      });
      return;
    }
  }

  let ac = target.ac;
  if (weapon.kind === "ranged" && hasCover(mem.grid, target.pos)) ac += 2;
  const flanked =
    weapon.kind === "melee" && isFlanking(mem, attacker, target, weapon.reach ?? 1);
  if (flanked) ac -= 2;

  const d20 = rng.d20();
  const mod = weapon.attackBonus + mapPenalty(attacker.map);
  const total = d20 + mod;
  const crit = d20 === 20 || total >= ac + 10;
  const hit = crit || total >= ac;
  let dmg = 0;
  let damageExpr = formatDiceExpr(weapon.damageDice, weapon.damageDie, weapon.damageBonus);
  let diceRolls: number[] = [];
  let damageBonus = weapon.damageBonus;
  if (hit) {
    const roll = rollDamage(rng, weapon.damageDice, weapon.damageDie, weapon.damageBonus, crit);
    dmg = roll.total;
    damageExpr = roll.expr;
    diceRolls = roll.rolls;
    damageBonus = roll.bonus;
    // Simplified sneak: flanking flanker-group melee adds 1d6 (doubled on crit).
    if (flanked && groupFlags(attacker).seekFlank) {
      const sneakRoll = rng.rollDiceDetail(1, 6);
      const sneakTotal = crit ? sneakRoll.total * 2 : sneakRoll.total;
      dmg += sneakTotal;
      diceRolls = [...diceRolls, ...sneakRoll.rolls];
      damageExpr = `${damageExpr}+${sneakTotal} sneak`;
    }
    target.hp = Math.max(0, target.hp - dmg);
    target.conditions = target.conditions.filter((c) => c.name !== "asleep");
    if (target.hp <= 0) {
      target.downed = true;
      target.hp = 0;
    }
  }

  mem.events.push({
    t: "attack",
    round,
    actor: attacker.id,
    target: target.id,
    weapon: weapon.id,
    weaponName: weaponLabel(weapon),
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
    map: attacker.map,
  });

  attacker.map += 1;
  attacker.actionsLeft -= 1;
}

export function formatAttackLine(
  e: Extract<CombatMemory["events"][number], { t: "attack" }>,
): string {
  const result = e.crit ? "CRIT" : e.hit ? "HIT" : "MISS";
  let line = `  Strike ${e.target} with ${e.weaponName}: d20 ${e.d20}+${e.mod}=${e.total} vs AC ${e.ac} ${result}`;
  if (e.hit) {
    const sub = e.diceRolls.reduce((a, b) => a + b, 0) + e.damageBonus;
    line +=
      "; " +
      formatDamageRoll({
        expr: e.damageExpr,
        rolls: e.diceRolls,
        bonus: e.damageBonus,
        subtotal: sub,
        crit: e.crit,
        total: e.dmg,
      }) +
      ` → hp ${e.hpAfter}`;
  }
  return line;
}

export function formatMoveLine(e: Extract<CombatMemory["events"][number], { t: "move" }>): string {
  return `${e.actor} ${e.kind} ${e.from} → ${e.to}`;
}
