import type { SeededRng } from "./rng.js";

export type DamageRoll = {
  expr: string;
  rolls: number[];
  bonus: number;
  subtotal: number;
  crit: boolean;
  total: number;
};

export function formatDiceExpr(dice: number, die: number, bonus = 0): string {
  const base = `${dice}d${die}`;
  if (bonus > 0) return `${base}+${bonus}`;
  if (bonus < 0) return `${base}${bonus}`;
  return base;
}

/** e.g. "1d8+4 → [6]+4 = 10" or "2d10 → [4,7] = 11 (crit ×2 → 22)" */
export function formatDamageRoll(r: DamageRoll): string {
  const faces = r.rolls.length === 1 ? `[${r.rolls[0]}]` : `[${r.rolls.join(",")}]`;
  const bonusPart = r.bonus !== 0 ? `${r.bonus > 0 ? "+" : ""}${r.bonus}` : "";
  let s = `${r.expr} → ${faces}${bonusPart ? bonusPart : ""} = ${r.subtotal}`;
  if (r.crit) s += ` (crit ×2 → ${r.total})`;
  return s;
}

export function rollDamage(
  rng: SeededRng,
  dice: number,
  die: number,
  bonus: number,
  crit: boolean,
): DamageRoll {
  const detail = rng.rollDiceDetail(dice, die);
  const subtotal = detail.total + bonus;
  const total = crit ? subtotal * 2 : subtotal;
  return {
    expr: formatDiceExpr(dice, die, bonus),
    rolls: detail.rolls,
    bonus,
    subtotal,
    crit,
    total,
  };
}
