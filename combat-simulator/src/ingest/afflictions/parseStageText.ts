import type { AfflictionStage } from "../../memory/schemas.js";

const DICE_RE = /(\d+)d(\d+)(?:\+(\d+))?/i;
const INTERVAL_RE = /\((\d+)\s*rounds?\)/i;
const COND_RE =
  /\b(flat-footed|off-guard|clumsy|enfeebled|drained|sickened|fatigued|stupefied|slowed|paralyzed|blinded|deafened|frightened)\s*(\d+)?/gi;

/** Parse AoN stage blurb like "1d4 poison damage and fatigued (1 round)". */
export function parseStageText(text: string): AfflictionStage {
  const dice = text.match(DICE_RE);
  const interval = text.match(INTERVAL_RE);
  const conditions: string[] = [];
  let conditionValue: number | undefined;
  for (const m of text.matchAll(COND_RE)) {
    let name = m[1]!.toLowerCase();
    if (name === "flat-footed") name = "off-guard";
    conditions.push(name);
    if (m[2]) conditionValue = Number(m[2]);
  }
  return {
    damageDice: dice ? Number(dice[1]) : 0,
    damageDie: dice ? Number(dice[2]) : undefined,
    damageBonus: dice && dice[3] ? Number(dice[3]) : 0,
    conditions,
    conditionValue,
    intervalRounds: interval ? Number(interval[1]) : 1,
  };
}

export function parseSaveDc(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.match(/DC\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

export function parseMaxDurationRounds(
  durationRaw: string | undefined,
  summary: string | undefined,
): number | undefined {
  const blob = `${durationRaw ?? ""} ${summary ?? ""}`;
  const m = blob.match(/(\d+)\s*rounds?/i);
  if (m) return Number(m[1]);
  // duration field sometimes stored in seconds (6 rounds = 36s)
  if (durationRaw && /^\d+$/.test(durationRaw.trim())) {
    const n = Number(durationRaw);
    if (n > 0 && n % 6 === 0 && n <= 600) return n / 6;
  }
  return undefined;
}

export function inferKind(traits: string[], category: string): "poison" | "disease" | "curse" | "other" {
  const t = traits.map((x) => x.toLowerCase());
  if (t.includes("poison") || category === "equipment") return "poison";
  if (category === "disease" || t.includes("disease")) return "disease";
  if (category === "curse" || t.includes("curse")) return "curse";
  return "other";
}
