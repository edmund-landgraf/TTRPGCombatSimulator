import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import { living } from "../memory/combatMemory.js";
import { cellId } from "../memory/schemas.js";
import type { Weapon } from "../memory/schemas.js";
import { chebyshev } from "../map/grid.js";
import { renderAscii } from "../map/ascii.js";

/** Max Chebyshev cells a weapon can Strike. */
function weaponRangeCells(w: Weapon): number {
  return w.kind === "ranged" ? (w.rangeCells ?? 12) : (w.reach ?? 1);
}

function weaponRangeLabel(w: Weapon): string {
  const max = weaponRangeCells(w);
  return w.kind === "ranged" ? `${w.id} range ${max}` : `${w.id} reach ${max}`;
}

/** Distances to living foes + whether each weapon reaches them. */
function formatDistanceLines(actor: CombatantState, mem: CombatMemory): string[] {
  if (actor.downed) return [];
  const foes = living(mem).filter((f) => f.side !== actor.side);
  if (foes.length === 0) return [];

  const dists = foes
    .map((f) => ({ id: f.id, d: chebyshev(actor.pos, f.pos) }))
    .sort((a, b) => a.d - b.d || a.id.localeCompare(b.id));

  const out: string[] = [
    `    foes: ${dists.map(({ id, d }) => `${id}@${d}`).join(" ")}`,
  ];

  for (const w of actor.weapons) {
    const max = weaponRangeCells(w);
    const inReach = dists.filter((x) => x.d <= max);
    const outOfReach = dists.filter((x) => x.d > max);
    let verdict: string;
    if (outOfReach.length === 0) {
      verdict = "reaches all";
    } else if (inReach.length === 0) {
      verdict = "out of reach for all";
    } else {
      verdict =
        `reaches ${inReach.map((x) => x.id).join(" ")}; ` +
        `out: ${outOfReach.map((x) => `${x.id}@${x.d}`).join(" ")}`;
    }
    out.push(`    ${weaponRangeLabel(w)} — ${verdict}`);
  }
  return out;
}

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
      lines.push(...formatDistanceLines(c, mem));
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

  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of mem.initiative) {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  for (const e of roundEvents) {
    if (
      (e.t === "delay" || e.t === "delay_forfeit" || e.t === "delay_return") &&
      !seen.has(e.actor)
    ) {
      seen.add(e.actor);
      order.push(e.actor);
    }
  }

  for (const id of order) {
    const actor = mem.combatants.get(id);
    if (!actor) continue;
    const hpStart = mem.hpAtRoundStart.get(id) ?? actor.hp;
    if (actor.downed && hpStart === 0) {
      bullets.push(`- ${actor.name} remained downed`);
      continue;
    }

    const delayed = roundEvents.find((e) => e.t === "delay" && e.actor === id);
    const returned = roundEvents.find((e) => e.t === "delay_return" && e.actor === id);
    const forfeit = roundEvents.find((e) => e.t === "delay_forfeit" && e.actor === id);
    if (delayed) {
      bullets.push(`- ${actor.name} Delayed (waiting to act later)`);
      if (returned && returned.t === "delay_return") {
        const after = mem.combatants.get(returned.after)?.name ?? returned.after;
        bullets.push(`- ${actor.name} returned from Delay after ${after}`);
      }
      if (forfeit) {
        bullets.push(`- ${actor.name} forfeited Delayed turn`);
      }
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

    if (mine.length === 0 && !delayed) {
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
