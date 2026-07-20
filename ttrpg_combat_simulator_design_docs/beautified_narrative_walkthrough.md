# Beautified Narrative Walkthrough

Goal: turn a finished sim run (ASCII maps + mechanical logs) into a **teaching walkthrough** in the style of the “Act 1 Combat Walkthrough / Reworked First Watch Patrol” document — prose, labeled maps, initiative tables, round-by-round beat sheets, rules bubbles, and aftermath.

This doc is the contract for that pipeline. It is **not** implemented end-to-end yet.

---

## How far we are today

| Layer in the beautiful write-up | Current simulator | Gap |
|--------------------------------|-------------------|-----|
| Encounter title, system, difficulty warning | Fixture `name` + `ruleset` only | No teaching intro, no difficulty framing, no “what this teaches” |
| Encounter design (roles / goals) | Implicit in AI weights + templates | No authored design bullets |
| Annotated ASCII map with legend & labels | Raw grid (`# . = ~` + token letters) | No north label, no named cover/lanes, no multi-line legend |
| “Distances that matter” table | Engine knows cells; never explained | Need path/distance summaries in feet (cell × 5) |
| Terrain + rules bubbles | Tags: floor / cover / difficult / blocking | No prose rule callouts (Acrobatics DC, climb, AoO, etc.) |
| Enemy / PC reference tables | JSON combatants (AC, HP, weapons, spells) | Can export tables; missing tactics blurbs & gear flavor |
| Initiative example table | `Initiative: ROG 23, …` one line | Need Roll / Modifier / Total columns |
| Round sections with named beats | `=== Round N ===` + Strike/Stride lines | Mechanical only; no “Start: …” framing or tactic commentary |
| Per-actor prose + inline dice | `d20 10+6=16 vs AC 15 HIT` | Close on dice; missing plain-English rule asides |
| Attack tables (archers volley) | Sequential log lines | Need grouped tables for multi-attacker beats |
| Aftermath / treasure / interrogation | None | Fully authored or LLM-invented (must be flagged) |
| Quick rule reference | `--rules` catalog (brief/verbose) | Can append; not woven into the walkthrough |

**Bottom line:** We are strong on **mechanical fidelity** (positions, rolls, HP, MAP-ish strikes). We are weak on **pedagogy and atmosphere** (why the fight is hard, what the GM should notice, labeled maps, aftermath). The beautified narrative is a **post-pass** over sim truth, not a replacement for the engine.

Rough readiness: **~35%** of the beautiful document can be filled automatically from a run today; **~65%** needs templates + LLM (or hand authoring) on top of that truth.

---

## Pipeline

```
Sim run
  → walkthrough.md / events.jsonl / run.json / ASCII boards
  → NarrativeCompiler (deterministic extract)
  → BeautifiedNarrativePrompt (system + extracted facts)
  → LLM (Ollama) OR human editor
  → beautified-narrative.md   ← teaching document
```

Hard rules for the rewrite:

1. **Do not invent mechanical outcomes.** Every hit, miss, damage number, HP change, and position must come from the sim extract.
2. **May invent teaching asides** (rules bubbles, “why this is tougher”) when tagged as commentary.
3. **May not invent treasure / interrogation** unless a separate encounter lore pack supplies them; otherwise omit or mark `[LORE NEEDED]`.
4. Scale is always **1 cell = 5 feet**.

---

## Input extract (from a run)

Produced by a future `src/narrative/extractRun.ts` (planned). Shape:

```json
{
  "encounter": {
    "id": "studio-custom",
    "name": "Custom (4 PCs vs 5 enemies)",
    "ruleset": "pf2e",
    "width": 12,
    "height": 12,
    "seed": 42
  },
  "initiative": [{ "id": "ROG", "name": "Rogue", "total": 23 }],
  "combatants": [
    {
      "id": "FTR",
      "name": "Fighter",
      "side": "party",
      "role": "fighter",
      "ac": 18,
      "maxHp": 20,
      "weapons": ["longsword"],
      "spells": [],
      "start": { "x": 7, "y": 13 }
    }
  ],
  "startingMapAscii": "...",
  "rounds": [
    {
      "round": 1,
      "actions": [
        {
          "actorId": "ROG",
          "actorName": "Rogue",
          "raw": "Strike GA1 with shortbow: d20 10+6=16 vs AC 15 HIT; …",
          "kind": "attack",
          "targetId": "GA1",
          "hit": true,
          "dmg": 3
        }
      ],
      "statusText": "--- Status (end of Round 1) --- …",
      "mapAscii": "=== Round 1 map === …",
      "summaryBullets": ["- Rogue hit Goblin Archer 1 …"]
    }
  ],
  "outcome": { "winner": "party", "reason": "enemies defeated", "rounds": 4 }
}
```

Today’s closest sources: `walkthrough.md`, companion `rounds[]` snapshots, `events.jsonl`.

---

## Output markdown skeleton

File name: `runs/<encounter>/<runId>/beautified-narrative.md`

```markdown
# Act N Combat Walkthrough
## Encounter — {name} · {ruleset} · {seed}

{1–2 paragraphs: purpose / teaching goal / difficulty warning}

### Encounter Design
- {role bullets — from lore pack or LLM commentary}

### Encounter Map and Starting Positions
Scale: 1 grid square = 5 feet.

{annotated ASCII — see Map annotation}

**Legend:** …

### Distances That Matter
| Movement Goal | Distance | Notes |
| … | … ft. | … |

### Terrain and Rules Bubbles
| Feature | Rule | GM Use |
| … | … | … |

### Enemy / PC Reference
(tables from combatant extract + optional tactics lines)

### Initiative
| Combatant | Total |
| … | … |

### Round 1 — {short beat title}
**Start:** {one sentence from positions + HP}

#### {Actor}, Init {n}
{prose}  
{inline dice from extract}  
{optional Rules bubble}

…

### Round 2 — …
…

### Aftermath
| Result | Consequence |
| … | … |

### Quick Rule Reference
(pull from `--rules` catalog topics used this fight)
```

---

## Map annotation rules

Start from sim ASCII. Beautifier may:

- Add a **North** label and axis headers (already partly present).
- Expand single-letter tokens to `[ID]` or short names on a **legend** (not necessarily on every cell).
- Add a short caption under the map (“Party south in 2×2; enemies north”).
- Optionally overlay known tags: `=` → “cover rail”, `~` → “difficult / runoff”.

Must **not** move tokens or change which cells are blocked.

---

## Round rewrite style (examples)

**Mechanical (sim):**

```text
--- ROG (Rogue) ---
  Strike GA1 with shortbow: d20 10+6=16 vs AC 15 HIT; 1d6+1 → [2]+1 = 3 → hp 7
```

**Beautified:**

```markdown
#### Rogue, Init 23
The rogue looses an arrow at Goblin Archer 1.

**Attack:** d20 10 + 6 = 16 vs AC 15 — **Hit**.  
**Damage:** 1d6+1 → [2]+1 = **3**. Archer hp 10 → 7.

*Rules bubble: MAP — second attack this turn would take a multiple attack penalty.*
```

Beat titles (“The Line Holds”, “The Blades Bite Back”) are LLM/editorial; they must not contradict HP or who is downed.

---

## Implementation plan (phased)

### Phase A — Extract + stub MD (near-term)
- `extractRun(runDir) → NarrativeExtract`
- Emit `beautified-narrative.stub.md` with filled tables/maps/rounds still mechanical
- CLI: `npm run sim -- --beautify <runDir>` or Studio button “Export beautified stub”

### Phase B — LLM rewrite (matches companion Ollama)
- Purpose: `beautify_narrative`
- System prompt: this skeleton + hard rules above
- User payload: JSON extract only (no free invention of rolls)
- Write `beautified-narrative.md` beside the stub

### Phase C — Lore packs (optional)
- Per-encounter YAML/JSON: design bullets, treasure, interrogation, terrain names
- Merged into extract so LLM does not fabricate loot

### Phase D — Studio UX
- After a paused combat ends: **Beautify** on Combat tab
- Side-by-side: left = mechanical rounds, right = narrative MD preview

---

## What we will not claim yet

- Full PF1e parity with the sample (we simulate **PF2e-simplified**).
- Automatic treasure / interrogation without a lore pack.
- Perfect annotated sinkhole art maps — we start from grid truth and caption it.
- That `--narrative` today equals this doc (current narrative is short Ollama prose per round, not a full walkthrough).

---

## Success check

A beautified file is “good enough” when a new GM can:

1. See the starting map and know who is where.
2. Follow initiative order without reading raw logs.
3. Understand each round’s turning point in prose.
4. Trust every number because it matches `walkthrough.md` / `events.jsonl`.
5. Leave with 3–5 rules bubbles they can reuse at the table.

---

## Related commands (current)

```bash
npm run sim -- --seed 42
npm run ui          # round-pause theater; Enter advances
npm run loop        # challenge ladder HTML report (balance, not narrative)
npm run sim -- --rules Strike_melee,cover --rules-mode verbose
```

Existing mechanical dump: `combat-simulator/runs/<encounter>/<runId>/walkthrough.md`.
