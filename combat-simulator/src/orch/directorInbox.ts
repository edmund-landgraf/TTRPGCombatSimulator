import type { CombatMemory } from "../memory/combatMemory.js";
import type { WeightDelta } from "../memory/schemas.js";

/** Keyword stub: map free-text notes to weight deltas for V1a. */
export function parseNotesToDeltas(notes: string, roundLimit = 99): WeightDelta[] {
  const text = notes.toLowerCase();
  const deltas: WeightDelta[] = [];

  if (!text.trim()) return deltas;

  if (text.includes("rogue") && (text.includes("close") || text.includes("melee"))) {
    deltas.push({
      combatantId: "ROG",
      until: { round: roundLimit },
      delta: { Stride_close: 2.0, Strike_ranged: -1.0 },
    });
  }
  if (text.includes("rogue") && (text.includes("stealth") || text.includes("hide"))) {
    deltas.push({
      combatantId: "ROG",
      until: { round: roundLimit },
      delta: { Stride_cover: 2.0, Strike_ranged: -1.5 },
    });
  }
  if (text.includes("fighter") && text.includes("shaman")) {
    deltas.push({
      combatantId: "FTR",
      until: { round: 99 },
      delta: { Stride_close: 1.5, Strike_melee: 1.0 },
    });
  }
  if (text.includes("wizard") && text.includes("back")) {
    deltas.push({
      combatantId: "WIZ",
      until: { round: 99 },
      delta: { Step_away: 1.5, Stride_close: -1.0 },
    });
  }
  if (text.includes("archers") && text.includes("focus") && !text.includes("rush")) {
    for (const id of ["GA1", "GA2", "A1", "A2"]) {
      deltas.push({
        combatantId: id,
        until: { round: roundLimit },
        delta: { Strike_ranged: 1.5 },
      });
    }
  }
  if (text.includes("rush") && text.includes("archer")) {
    for (const id of ["FTR", "ROG", "CHP"]) {
      deltas.push({
        combatantId: id,
        until: { round: roundLimit },
        delta: { Stride_close: 1.5, Strike_melee: 0.5 },
      });
    }
  }
  if (text.includes("protect") && text.includes("wizard")) {
    deltas.push({
      combatantId: "WIZ",
      until: { round: roundLimit },
      delta: { Step_away: 1.5, Stride_cover: 1.0, Stride_close: -1.0 },
    });
    deltas.push({
      combatantId: "FTR",
      until: { round: roundLimit },
      delta: { Stride_close: 1.0, Strike_melee: 0.5 },
    });
  }

  // Generic: if nothing matched but notes exist, slightly boost party close for fighter
  if (deltas.length === 0 && text.length > 3) {
    deltas.push({
      combatantId: "FTR",
      until: { round: roundLimit },
      delta: { Stride_close: 0.5 },
    });
  }

  return deltas;
}

export function applyDirectorNotes(mem: CombatMemory, notes: string): void {
  mem.notes = notes;
  const deltas = parseNotesToDeltas(notes);
  mem.weightDeltas.push(...deltas);
}
