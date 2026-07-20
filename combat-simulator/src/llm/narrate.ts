import type { LlmProvider } from "./types.js";

const SYSTEM = `You are a Pathfinder combat narrator for a GM teaching handout.
Rewrite the provided mechanical combat log into friendly, clear English.

Hard rules:
- Keep every fact accurate: who acted, hit/miss, damage numbers, final HP if given.
- Do NOT invent attacks, spells, damage, positions, or outcomes.
- Do NOT change numbers from the log.
- Do NOT compute or guess intermediate HP. If you mention HP, use only values that appear in the log or status block.
- Prefer character names over ids when both appear.
- Short sentences; one or two paragraphs.
- Plain prose only (no markdown headings, no bullet lists).`;

export async function narrateRound(
  llm: LlmProvider,
  round: number,
  mechanicalBlock: string,
): Promise<string> {
  const result = await llm.complete({
    purpose: "narrate",
    system: SYSTEM,
    user: `Round ${round} mechanical log and status (authoritative — do not contradict):\n\n${mechanicalBlock}\n\nWrite the friendly English narration now.`,
  });
  return result.text.replace(/^["']|["']$/g, "").trim();
}
