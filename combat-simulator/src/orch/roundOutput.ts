import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import { living } from "../memory/combatMemory.js";
import { cellId } from "../memory/schemas.js";
import type { Weapon } from "../memory/schemas.js";
import {
  formatActiveTerrainStatus,
  formatTerrainNarrativeNotes,
} from "../map/aoe.js";
import { chebyshev } from "../map/grid.js";
import { renderAscii } from "../map/ascii.js";
import { describeVitalStatus, formatVitalRosterLine } from "../rules/pf2e/dying.js";

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
      const vital = describeVitalStatus(c);
      const vitalTag = formatVitalRosterLine(c);
      const condParts = c.conditions
        .filter((x) => !["dying", "unconscious", "dead", "wounded"].includes(x.name))
        .map((x) => (x.value != null ? `${x.name} ${x.value}` : x.name));
      const cond = condParts.length === 0 ? "—" : condParts.join(", ");
      const statusBit = vitalTag ? ` [${vitalTag}]` : "";
      lines.push(
        `  ${c.id.padEnd(4)} ${c.name.padEnd(10)} hp ${String(c.hp).padStart(2)}/${c.maxHp}${statusBit}  @ ${cellId(c.pos)}  conditions: ${cond}`,
      );
      if (vital.state === "dying" || vital.state === "dead" || vital.state === "unconscious") {
        lines.push(`       → ${vital.note}`);
      } else if (vital.wounded > 0) {
        lines.push(`       → ${vital.note}`);
      }
      lines.push(...formatDistanceLines(c, mem));
    }
  };

  formatSide("party", "PARTY");
  formatSide("enemy", "ENEMY");

  const terrainLines = formatActiveTerrainStatus(mem);
  if (terrainLines.length) {
    lines.push(...terrainLines);
  }

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
      const vital = describeVitalStatus(actor);
      bullets.push(`- ${actor.name} is ${vital.label}`);
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
      (e) =>
        "actor" in e &&
        e.actor === id &&
        (e.t === "move" ||
          e.t === "attack" ||
          e.t === "spell" ||
          e.t === "hazard" ||
          e.t === "terrain"),
    );

    for (const e of mine) {
      if (e.t === "move") {
        const verb = e.kind === "Step" ? "stepped" : "strode";
        bullets.push(`- ${actor.name} ${verb} to ${e.to}`);
      } else if (e.t === "hazard") {
        bullets.push(
          `- ${actor.name} took ${e.dmg} from hazardous terrain at ${e.cell} (hp ${e.hpAfter})`,
        );
      } else if (e.t === "terrain") {
        const dur =
          e.durationRounds <= 0
            ? "until combat end"
            : `${e.durationRounds} rounds (through r${e.expiresAtEndOfRound})`;
        bullets.push(
          `- ${actor.name} created ${e.glyph} (${e.tag}) with ${e.spellName} on ${e.cells.join(", ")} — ${dur}`,
        );
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
        const vital = describeVitalStatus(actor);
        bullets.push(`- ${actor.name} was dropped (${vital.label})`);
      } else {
        bullets.push(`- ${actor.name} held position`);
      }
    }
  }

  const expires = roundEvents.filter((e) => e.t === "terrain_expire");
  for (const e of expires) {
    if (e.t !== "terrain_expire") continue;
    bullets.push(
      `- ${e.spellName} ${e.glyph} (${e.tag}) expired on ${e.cells.join(", ")}`,
    );
  }

  const narrativeNotes = formatTerrainNarrativeNotes(mem);
  const parts = [`--- Round ${mem.round} summary ---`, bullets.join("\n")];
  if (narrativeNotes.length) {
    parts.push("", ...narrativeNotes);
  }
  return parts.join("\n");
}
export function formatRoundEnd(mem: CombatMemory): string {
  return [formatStatusRoster(mem), "", formatAsciiBoard(mem), "", formatRoundSummary(mem)].join(
    "\n",
  );
}
