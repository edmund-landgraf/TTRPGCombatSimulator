import { OllamaProvider } from "../llm/ollama.js";
import { companionSession, formatContextForLlm } from "./session.js";
import { formatStudioAscii, studioState, studioSummary } from "./studio.js";

const SYSTEM = `You are a Pathfinder 2e teaching assistant in a side panel next to a live combat simulator.

You ALWAYS receive an auto-loaded combat/studio context. Trust the COMBAT STATE banner at the top of that context.

Combat states you will see:
- PAUSED BETWEEN ROUNDS — Round N finished; user is deciding before Enter starts Round N+1. This is the normal time for tactics chat. Actions in that round's log already happened (spell slots/uses spent, HP already changed).
- PAUSED BETWEEN TURNS — a combatant's turn just finished mid-round; map/status are live; Enter continues to the next initiative turn.
- ROUND RESOLVING — sim is still processing a round; be cautious about incomplete details.
- ENDED — fight over; discuss aftermath only, not "next round" plans as if combat continues.
- Studio staging — no live fight yet.

Hard rules:
- You have NO control over the fight. Never claim to change HP, rolls, positions, or actions.
- Do not invent outcomes that contradict the provided context.
- If something is not in the context, say you don't know from the current snapshot.
- When PAUSED, answer from the completed round log + status (e.g. "Cleric already cast Heal this round" if the log shows it).
- Prefer clear, short answers. Use bullets when listing options or distances.
- You may explain PF2e rules using the context as examples.`;

function formatStudioFallbackForLlm(): string {
  const s = studioSummary(studioState);
  const lines = [
    "COMBAT STATE: NO LIVE COMBAT (studio staging)",
    "No round is paused or in progress. Combat context appears after Setup → Run combat, especially during round pauses.",
    `Map: ${s.map.width}×${s.map.height} (${s.map.source})`,
    "",
    "Party:",
    ...(s.pcs.length
      ? s.pcs.map((c) => `- ${c.id} ${c.name} HP ${c.hp} AC ${c.ac} @ ${c.start.x},${c.start.y}`)
      : ["- (none)"]),
    "",
    "Enemies:",
    ...(s.enemies.length
      ? s.enemies.map((c) => `- ${c.id} ${c.name} HP ${c.hp} AC ${c.ac} @ ${c.start.x},${c.start.y}`)
      : ["- (none)"]),
    "",
    "Map:",
    formatStudioAscii(studioState),
  ];
  return lines.join("\n");
}

function contextBlockForChat(opts?: { runInFlight?: boolean }): string | null {
  if (companionSession.context) {
    return formatContextForLlm(companionSession.context, opts);
  }
  if (studioState.pcs.length || studioState.enemies.length) {
    return formatStudioFallbackForLlm();
  }
  return null;
}

export async function answerCompanionChat(
  userMessage: string,
  ollama: OllamaProvider,
  opts?: { runInFlight?: boolean },
): Promise<string> {
  const contextBlock = contextBlockForChat(opts);
  if (!contextBlock) {
    return "No combat or studio roster is loaded yet. Import PCs/enemies (or wait for the auto-seeded classic fight) so I can see the battlefield.";
  }

  const history = companionSession.chat.slice(-12).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  companionSession.addChat("user", userMessage);

  const result = await ollama.chat({
    system: `${SYSTEM}\n\n--- CURRENT COMBAT CONTEXT (read-only, auto-loaded) ---\n${contextBlock}\n--- END CONTEXT ---`,
    messages: [...history, { role: "user", content: userMessage }],
    temperature: 0.35,
  });

  companionSession.addChat("assistant", result.text);
  return result.text;
}
