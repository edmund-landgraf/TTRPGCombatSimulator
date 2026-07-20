# TTRPG Combat Simulator (V1a)

PF2e-inspired CLI combat loop. Engine owns rolls and HP; ASCII map shows positions only.

## Setup

```bash
cd combat-simulator
npm install
```

## Run sample combat

```bash
npm run sim -- --encounter classic-four-vs-goblins --seed 42 --llm none
```

PF2e threat ladder (trivial / moderate / hard=severe / extreme), party size 3–5:

```bash
npm run sim -- --threat trivial --party-size 4 --seed 42
npm run sim -- --threat extreme --party-size 3 --seed 42
npm run loop
```

Writes `runs/challenge-matrix/challenge-matrix-report.json` and an HTML dashboard
(`challenge-matrix-report.html`) matching the challenge-ladder report (stats, matrix table, charts).
Also available in Studio → **Loop** tab, or `npm run sim -- --loop`.
```

Print PF2e rules blurbs for actions / topics (`brief` default, or `verbose`):

```bash
npm run sim -- --rules
npm run sim -- --rules Strike_melee,Step,aoo --rules-mode verbose
npm run sim -- --rules help
```

Interactive play (multiple-choice PC turns; enemies stay AI):

```bash
npm run sim -- --play --seed 42
npm run sim -- --play --threat moderate --party-size 4
```

Only legal actions are listed. Tips tag tactics (offense / control / crowd control / heal). Sleep is hidden vs high-Will targets; spell rank is gated by creature level (L1 casters cannot cast Fireball).

Companion side chat (live combat context; chat cannot change the fight — needs Ollama):

```bash
npm run sim -- --companion --seed 42
npm run sim -- --play --companion --seed 42
```

Opens `http://127.0.0.1:3847/` with status/map/log on the left and a Q&A panel on the right. Optional `--port 3847`.

With director-style notes (keyword weight boosts):

```bash
npm run sim -- --notes "rogue close first" --seed 42
```

AI actions pass a **tactics agent** before commit (open with magic, focus fire, finish wounded, triage heals, close to melee, hold the line, no thrash, cast over club, don't waste MAP, spend actions). Rejected picks are replaced and reviewed again (logged as `TACTICS reject [...]`).

**PF2e Delay** (defer): at turn start a combatant may leave initiative and return after another creature’s turn (permanent reorder). Melee who can’t reach may Delay early; casters who can cast do not — round 1 they open with spells. See `--rules Delay`.

```bash
npm run sim -- --seed 42 --max-rounds 2
```

Friendly English narration via local Ollama (`llama3` by default):

```bash
npm run sim -- --encounter classic-four-vs-goblins --seed 42 --narrative --max-rounds 2
```

Optional: `--model llama3` (default), `OLLAMA_HOST`, `OLLAMA_MODEL`.

## Round output

1. Per-turn action log (weapon/spell name + dice, e.g. `1d8+4 → [6]+4 = 10`)  
2. Status roster (all PCs & enemies)  
3. ASCII map (letter tokens)  
4. Round summary paragraph  
5. With `--narrative`: Ollama prose from that round’s mechanical lines (no invented numbers)

Casters use spells as tactics: wizard (Produce Flame / Electric Arc), cleric (Divine Lance / Heal), shaman (Produce Flame). Melee is backup only.

Runs are saved under `combat-simulator/runs/<encounter>/<timestamp>_notes/`.
