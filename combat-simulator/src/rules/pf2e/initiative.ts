import type { CombatMemory } from "../../memory/combatMemory.js";
import type { SeededRng } from "./rng.js";

export function rollInitiative(mem: CombatMemory, rng: SeededRng): void {
  const rolls: { id: string; total: number; side: "party" | "enemy" }[] = [];
  for (const c of mem.combatants.values()) {
    const d20 = rng.d20();
    rolls.push({
      id: c.id,
      total: d20 + c.perceptionBonus,
      side: c.side,
    });
  }
  rolls.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    // ties: enemies before PCs, then id
    if (a.side !== b.side) return a.side === "enemy" ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  mem.initiative = rolls.map((r) => r.id);
  mem.events.push({
    t: "initiative",
    order: rolls.map((r) => ({ id: r.id, total: r.total })),
  });
}
