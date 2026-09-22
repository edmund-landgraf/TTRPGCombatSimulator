import type { CombatantState, CombatMemory } from "../../memory/combatMemory.js";
import type { Consumable, Spell } from "../../memory/schemas.js";
import { chebyshev } from "../../map/grid.js";
import { rollDamage } from "./damage.js";
import { applyHealing, isDead } from "./dying.js";
import {
  canCastSpell,
  estimateSpellScore,
  resolveSpell,
} from "./spell.js";
import type { SeededRng } from "./rng.js";

export function itemUsesLeft(actor: CombatantState, item: Consumable): number {
  const used = actor.itemUses.get(item.id) ?? 0;
  return Math.max(0, item.uses - used);
}

export function scrollSpell(actor: CombatantState, item: Consumable): Spell | undefined {
  if (item.kind !== "scroll") return undefined;
  if (item.spell) return item.spell;
  if (item.spellId) return actor.spells.find((s) => s.id === item.spellId);
  return undefined;
}

function validTargetSide(
  actor: CombatantState,
  target: CombatantState,
  item: Consumable,
): boolean {
  if (item.target === "self") return target.id === actor.id;
  if (item.target === "ally") return target.side === actor.side;
  if (item.target === "foe") return target.side !== actor.side && !isDead(target);
  return false;
}

export function canUseItem(
  mem: CombatMemory,
  actor: CombatantState,
  target: CombatantState,
  item: Consumable,
): boolean {
  if (actor.actionsLeft < item.actions) return false;
  if (itemUsesLeft(actor, item) <= 0) return false;
  if (!validTargetSide(actor, target, item)) return false;

  if (item.kind === "potion") {
    const dist = chebyshev(actor.pos, target.pos);
    const range = item.rangeCells ?? (item.target === "self" ? 0 : 1);
    if (dist > range) return false;
    if (target.hp >= target.maxHp && !target.downed) return false;
    return true;
  }

  const spell = scrollSpell(actor, item);
  if (!spell) return false;
  if (actor.actionsLeft < Math.max(item.actions, spell.actions)) return false;
  return canCastSpell(mem, actor, target, spell, {
    ignoreSlots: true,
    ignoreRankGate: true,
  });
}

export function estimateItemScore(
  mem: CombatMemory,
  actor: CombatantState,
  target: CombatantState,
  item: Consumable,
): number {
  if (!canUseItem(mem, actor, target, item)) return 0;
  if (item.kind === "potion") {
    const missing = target.maxHp - target.hp;
    return Math.min(1.2, missing / 8);
  }
  const spell = scrollSpell(actor, item);
  if (!spell) return 0;
  return estimateSpellScore(mem, actor, target, spell);
}

export function resolveItem(
  mem: CombatMemory,
  actor: CombatantState,
  target: CombatantState,
  item: Consumable,
  rng: SeededRng,
  round: number,
): void {
  if (!canUseItem(mem, actor, target, item)) {
    mem.events.push({
      t: "reject",
      round,
      actor: actor.id,
      reason: `Cannot use ${item.name}`,
    });
    return;
  }

  if (item.kind === "potion") {
    actor.itemUses.set(item.id, (actor.itemUses.get(item.id) ?? 0) + 1);
    const dice = item.healDice ?? 1;
    const die = item.healDie ?? 8;
    const bonus = item.healBonus ?? 0;
    const roll = rollDamage(rng, dice, die, bonus, false);
    const healAmt = applyHealing(target, roll.total);
    mem.events.push({
      t: "item",
      round,
      actor: actor.id,
      target: target.id,
      item: item.id,
      itemName: item.name,
      kind: "potion",
      healAmt,
      dmg: 0,
      hpAfter: target.hp,
      actionsSpent: item.actions,
    });
    actor.actionsLeft -= item.actions;
    return;
  }

  const spell = scrollSpell(actor, item);
  if (!spell) {
    mem.events.push({
      t: "reject",
      round,
      actor: actor.id,
      reason: `Scroll ${item.name} has no spell`,
    });
    return;
  }

  const before = mem.events.length;
  resolveSpell(mem, actor, target, spell, rng, round, { consumeSpellSlot: false });
  for (let i = before; i < mem.events.length; i++) {
    const ev = mem.events[i]!;
    if (ev.t === "reject") return;
    if (ev.t === "spell") {
      ev.actionsSpent = Math.max(ev.actionsSpent, item.actions);
    }
  }
  actor.itemUses.set(item.id, (actor.itemUses.get(item.id) ?? 0) + 1);
  actor.actionsLeft -= Math.max(0, item.actions - spell.actions);
  mem.events.push({
    t: "item",
    round,
    actor: actor.id,
    target: target.id,
    item: item.id,
    itemName: item.name,
    kind: "scroll",
    spell: spell.id,
    spellName: spell.name,
    dmg: 0,
    hpAfter: target.hp,
    actionsSpent: item.actions,
  });
}

export function formatItemLine(
  e: Extract<CombatMemory["events"][number], { t: "item" }>,
): string {
  if (e.kind === "potion" && e.healAmt != null) {
    return `  ITEM ${e.itemName} → ${e.target} heal ${e.healAmt} → hp ${e.hpAfter}`;
  }
  if (e.kind === "scroll" && e.spellName) {
    return `  SCROLL ${e.itemName} (${e.spellName}) → ${e.target}`;
  }
  return `  ITEM ${e.itemName} → ${e.target}`;
}
