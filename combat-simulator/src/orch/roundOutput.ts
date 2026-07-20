import type { CombatMemory } from "../memory/combatMemory.js";
import { cellId } from "../memory/schemas.js";
import { renderAscii } from "../map/ascii.js";

export function formatStatusRoster(mem: CombatMemory): string {
  const lines: string[] = [`--- Status (end of Round ${mem.round}) ---`];

  const formatSide = (side: "party" | "enemy", label: string) => {
    lines.push(label);
    for (const c of mem.combatants.values()) {
      if (c.side !== side) continue;
      const cond =
        c.conditions.length === 0
          ? "—"
          : c.conditions.map((x) => (x.value != null ? `${x.name} ${x.value}` : x.name)).join(", ");
      const down = c.downed ? " (downed)" : "";
      lines.push(
        `  ${c.id.padEnd(4)} ${c.name.padEnd(10)} hp ${String(c.hp).padStart(2)}/${c.maxHp}${down}  @ ${cellId(c.pos)}  conditions: ${cond}`,
      );
    }
  };

  formatSide("party", "PARTY");
  formatSide("enemy", "ENEMY");

  const updates: string[] = [];
  for (const c of mem.combatants.values()) {
    const start = mem.hpAtRoundStart.get(c.id);
    if (start == null || start === c.hp) continue;
    const delta = c.hp - start;
    const sign = delta > 0 ? "+" : "";
    updates.push(`${c.id} ${sign}${delta}`);
  }
  lines.push(
    updates.length
      ? `Updates this round: ${updates.join("; ")}`
      : "Updates this round: —",
  );
  return lines.join("\n");
}

export function formatAsciiBoard(mem: CombatMemory): string {
  const tokens = [...mem.combatants.values()].map((c) => ({
    id: c.id,
    tokenChar: c.tokenChar,
    pos: c.pos,
    downed: c.downed,
  }));
  return renderAscii(mem.grid, tokens, `=== Round ${mem.round} map ===`);
}

export function formatRoundSummary(mem: CombatMemory): string {
  const bullets: string[] = [];
  const roundEvents = mem.events.filter(
    (e) => ("round" in e && e.round === mem.round) || false,
  );

  for (const id of mem.initiative) {
    const actor = mem.combatants.get(id);
    if (!actor) continue;
    const hpStart = mem.hpAtRoundStart.get(id) ?? actor.hp;
    if (actor.downed && hpStart === 0) {
      bullets.push(`- ${actor.name} remained downed`);
      continue;
    }

    // Chronological actions for this actor (one bullet each).
    const mine = roundEvents.filter(
      (e) => "actor" in e && e.actor === id && (e.t === "move" || e.t === "attack" || e.t === "spell"),
    );

    for (const e of mine) {
      if (e.t === "move") {
        const verb = e.kind === "Step" ? "stepped" : "strode";
        bullets.push(`- ${actor.name} ${verb} to ${e.to}`);
      } else if (e.t === "attack") {
        const tgt = mem.combatants.get(e.target)?.name ?? e.target;
        const wpn = e.weaponName ?? e.weapon;
        if (e.crit) {
          bullets.push(`- ${actor.name} crit ${tgt} with ${wpn} for ${e.dmg} (${e.damageExpr})`);
        } else if (e.hit) {
          bullets.push(`- ${actor.name} hit ${tgt} with ${wpn} for ${e.dmg} (${e.damageExpr})`);
        } else {
          bullets.push(`- ${actor.name} missed ${tgt} with ${wpn}`);
        }
      } else if (e.t === "spell") {
        const tgt = mem.combatants.get(e.target)?.name ?? e.target;
        if (e.kind === "heal") {
          bullets.push(`- ${actor.name} healed ${tgt} with ${e.spellName} for ${e.healAmt}`);
        } else if (e.kind === "attack") {
          if (e.crit) {
            bullets.push(`- ${actor.name} crit ${tgt} with ${e.spellName} for ${e.dmg}`);
          } else if (e.hit) {
            bullets.push(`- ${actor.name} hit ${tgt} with ${e.spellName} for ${e.dmg}`);
          } else {
            bullets.push(`- ${actor.name} missed ${tgt} with ${e.spellName}`);
          }
        } else if (e.saved) {
          bullets.push(`- ${tgt} saved vs ${actor.name}'s ${e.spellName} for ${e.dmg}`);
        } else {
          bullets.push(`- ${actor.name} hit ${tgt} with ${e.spellName} for ${e.dmg} (failed save)`);
        }
      }
    }

    if (mine.length === 0) {
      if (actor.downed && hpStart > 0) {
        bullets.push(`- ${actor.name} was dropped before acting`);
      } else {
        bullets.push(`- ${actor.name} held position`);
      }
    }
  }

  return `--- Round ${mem.round} summary ---\n${bullets.join("\n")}`;
}
export function formatRoundEnd(mem: CombatMemory): string {
  return [formatStatusRoster(mem), "", formatAsciiBoard(mem), "", formatRoundSummary(mem)].join(
    "\n",
  );
}
