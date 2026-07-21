import type { CombatantState, CombatMemory } from "../../memory/combatMemory.js";
import type { Weapon } from "../../memory/schemas.js";
import { chebyshev, hasCoverFromAttack, hasLineOfSight } from "../../map/grid.js";
import { isFlanking } from "../../ai/flank.js";
import { groupFlags } from "../../ai/tacticsGroups.js";
import { formatDamageRoll, formatDiceExpr, rollDamage } from "./damage.js";
import { applyIncomingDamage } from "./dying.js";
import { exposeAffliction } from "./affliction.js";
import {
  CONCEALED_HIT_FACTOR,
  fogConcealsTarget,
  rollConcealedFlat,
} from "./concealment.js";
import type { SeededRng } from "./rng.js";

export function mapPenalty(map: number, agile = false): number {
  if (map <= 0) return 0;
  if (map === 1) return agile ? -4 : -5;
  return agile ? -8 : -10;
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
  if (
    weapon.kind === "ranged" &&
    hasCoverFromAttack(mem.grid, attacker.pos, target.pos)
  ) {
    ac += 2; // PF2e standard cover (incl. soft barricade)
  }
  if (weapon.kind === "melee" && isFlanking(mem, attacker, target, weapon.reach ?? 1)) {
    ac -= 2; // off-guard from flanking
  }
  const mod = weapon.attackBonus + mapPenalty(attacker.map, !!weapon.agile);
  const need = ac - mod;
  let p =
    need <= 1 ? 0.95 : need >= 20 ? 0.05 : Math.max(0.05, Math.min(0.95, (21 - need) / 20));
  // Fog → concealed (DC 5 flat), not a −2 attack penalty.
  if (fogConcealsTarget(mem, attacker, target)) p *= CONCEALED_HIT_FACTOR;
  return p;
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
  if (
    weapon.kind === "ranged" &&
    hasCoverFromAttack(mem.grid, attacker.pos, target.pos)
  ) {
    ac += 2; // PF2e standard cover (incl. soft barricade)
  }
  const flanked =
    weapon.kind === "melee" && isFlanking(mem, attacker, target, weapon.reach ?? 1);
  if (flanked) ac -= 2;

  const mod = weapon.attackBonus + mapPenalty(attacker.map, !!weapon.agile);
  const flat = rollConcealedFlat(mem, attacker, target, rng);
  if (flat.required && !flat.passed) {
    // Concealed miss: no attack roll; action + MAP still spent.
    mem.events.push({
      t: "attack",
      round,
      actor: attacker.id,
      target: target.id,
      weapon: weapon.id,
      weaponName: weaponLabel(weapon),
      d20: 0,
      mod,
      total: 0,
      ac,
      hit: false,
      crit: false,
      damageExpr: formatDiceExpr(weapon.damageDice, weapon.damageDie, weapon.damageBonus),
      diceRolls: [],
      damageBonus: weapon.damageBonus,
      dmg: 0,
      hpAfter: target.hp,
      map: attacker.map,
      concealedFlat: { d20: flat.d20, dc: flat.dc, passed: false },
    });
    attacker.map += 1;
    attacker.actionsLeft -= 1;
    return;
  }

  const d20 = rng.d20();
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
    target.conditions = target.conditions.filter((c) => c.name !== "asleep");
    applyIncomingDamage(target, dmg, { critical: crit });
    if (weapon.afflictionId) {
      exposeAffliction(mem, target, weapon.afflictionId, rng, []);
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
    concealedFlat: flat.required
      ? { d20: flat.d20, dc: flat.dc, passed: true }
      : undefined,
  });

  attacker.map += 1;
  attacker.actionsLeft -= 1;
}

export function formatAttackLine(
  e: Extract<CombatMemory["events"][number], { t: "attack" }>,
): string {
  if (e.concealedFlat && !e.concealedFlat.passed) {
    return (
      `  Strike ${e.target} with ${e.weaponName}: CONCEALED miss` +
      ` (flat ${e.concealedFlat.d20} vs DC ${e.concealedFlat.dc})`
    );
  }
  const result = e.crit ? "CRIT" : e.hit ? "HIT" : "MISS";
  const fogNote =
    e.concealedFlat?.passed
      ? ` [concealed flat ${e.concealedFlat.d20} vs DC ${e.concealedFlat.dc}]`
      : "";
  let line = `  Strike ${e.target} with ${e.weaponName}: d20 ${e.d20}+${e.mod}=${e.total} vs AC ${e.ac} ${result}${fogNote}`;
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
