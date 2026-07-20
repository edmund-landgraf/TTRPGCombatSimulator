# Foundry VTT + PF2e LLM Combat Controller
## Deep Research Implementation Plan

## Purpose

This document lays out a second implementation path for the TTRPG combat simulator:

> Use Foundry VTT as the visual/runtime environment, use the PF2e system as the rules-rich actor/sheet layer, and use the LLM to control every actor in the encounter.

The key assumption is correct:

> Foundry does not automatically decide actions for NPCs, monsters, or PCs. It tracks the scene, actors, tokens, combat tracker, rolls, effects, and automation, but it does not act as an AI combatant.

So your module provides the missing combat brain.

---

# 1. Research Summary

## 1.1 Official Foundry VTT Findings

Foundry is a strong target because it exposes a client-side JavaScript API for creating systems, modules, scripts, and extensions. The official API documentation describes Foundry as a JavaScript application for running tabletop RPGs inside a self-hosted web framework, and the purpose of the API is to let developers augment and extend the platform.

Foundry module development is also a first-class workflow. Modules are add-ons that can modify behavior, add UI, register hooks, add scripts, and integrate with game systems.

Relevant official documentation:

- Foundry VTT API v14: https://foundryvtt.com/api/
- Introduction to Module Development: https://foundryvtt.com/article/module-development/
- Introduction to Development: https://foundryvtt.com/article/intro-development/
- Combat API: https://foundryvtt.com/api/classes/foundry.documents.Combat.html
- TokenDocument API: https://foundryvtt.com/api/classes/foundry.documents.TokenDocument.html

Important API facts:

- `Combat` documents model rounds, turns, and combatants.
- The combat tracker already represents current turn order.
- `TokenDocument` exposes token position, actor linkage, and combat participation.
- A token can reference its actor through `token.actor`.
- If a token is unlinked, Foundry may provide a synthetic actor instance derived from the base actor plus token delta.
- Foundry modules can register startup hooks and expose their own APIs.

---

## 1.2 PF2e System Findings

The PF2e system is a major reason to target Foundry before Roll20.

The PF2e package page says the system includes:

- All official Pathfinder Second Edition rules content
- Creatures
- Hazards
- Items
- Actions
- Feats
- Spells
- Character sheets
- Spellcasting support
- Inventory management
- Crafting
- Pathfinder Society chronicle support
- Canvas integration
- Immersive vision mechanics
- Positional flanking
- Immunities
- Weaknesses
- Resistances
- Real-time range detection
- Variant rule support

Relevant sources:

- PF2e package page: https://foundryvtt.com/packages/pf2e
- PF2e GitHub: https://github.com/foundryvtt/pf2e
- PF2e GM Starter Guide: https://github.com/foundryvtt/pf2e/wiki/GM%27s-Starter-Guide
- PF2e Rule Elements guide: https://github.com/foundryvtt/pf2e/wiki/Quickstart-guide-for-rule-elements
- PF2e homebrew/settings guide: https://foundryvtt-pf2e-70.mintlify.app/guides/homebrew-and-settings

Important PF2e findings:

- Rule elements are how the PF2e system handles much of its automation.
- Rule elements can add modifiers, adjust modifiers, change token images, change actor data, add toggles, give feats, and more.
- PF2e automation settings are world-scoped and can control mechanical bookkeeping.
- PF2e settings include automation for rules-based vision and immunities/weaknesses/resistances.
- The PF2e system can automatically detect flanking, accounting for position, reach, and abilities that prevent flanking.
- The PF2e system is rules-rich, but tactical control is still left to the GM or player.

---

## 1.3 Prior Art: Other People Have Tried Similar Things

This is not a totally untested idea.

### PF2e AI Combat Assistant

There is already a Foundry module called **PF2e AI Combat Assistant**.

Package page:

- https://foundryvtt.com/packages/pf2e-ai-combat-assistant

GitHub:

- https://github.com/AI-DM-Foundry/AI-Combat-Assistant-Pf2e

Reddit release thread:

- https://www.reddit.com/r/FoundryVTT/comments/1jrfz62/tool_release_ai_combat_assistant_for_pf2e_in/

The module is described as an AI-powered combat assistant for PF2e in Foundry. It analyzes combat state and recommends actions for PCs or NPCs, considering:

- Usable actions
- Reactions
- Spells
- Items
- Feats
- Passives
- Current HP
- Conditions
- Resources
- Effects
- Allies
- Enemies
- Positioning

That is extremely close to the architecture proposed here.

Important distinction:

> The existing module appears focused on recommending the best action. Your design goes further: full simulation runs, scenario grouping, repeated trials, adaptive strategy, state snapshots, and persistent combat event logs.

---

### Reddit: NPCs with Artificial Intelligence

A Reddit thread titled **NPCs with Artificial Intelligence?** asks whether people have used Foundry to automate NPCs with AI beyond simple automation.

Source:

- https://www.reddit.com/r/FoundryVTT/comments/seri0j/npcs_with_artificial_intelligence/

This confirms that the idea has been discussed in the Foundry community for several years.

---

### Reddit: Adding AI to Enemies?

Another Reddit thread, **Adding AI to enemies?**, discusses enemy automation. The thread references the concept of automating mook decisions so the GM can focus on more important villains and table management.

Source:

- https://www.reddit.com/r/FoundryVTT/comments/tx2glk/adding_ai_to_enemies/

This supports the “GM attention saver” use case.

---

### Reddit: AI Automation Suite for Foundry

A newer Reddit thread titled **I'm making an AI automation suite for Foundry** argues that many AI modules focus on text/image generation, while the more interesting direction is real automation.

Source:

- https://www.reddit.com/r/FoundryVTT/comments/1q5jxtr/im_making_an_ai_automation_suite_for_foundry/

This aligns with your project: not AI flavor text, but AI as a tactical controller.

---

### Reddit: Automated NPCs for D&D 5e

A recent Reddit thread titled **Automated NPCs! [D&D 5e]** describes a module that automates enemy turns using behavior layers and inferred intelligence archetypes.

Source:

- https://www.reddit.com/r/FoundryVTT/comments/1tlz340/automated_npcs_dd_5e/

The interesting design idea:

> Behavior can be inferred from creature stats, type, abilities, equipment, and role.

That maps directly to your strategy-profile layer:

- reckless brute
- cowardly skirmisher
- assassin
- defender
- beast
- disciplined soldier
- boss adaptive

---

### Reddit: AI Assistant Gut Check

A Reddit thread titled **GM here with a Foundry AI assistant — is it actually useful, or just more AI noise?** includes a concern that LLM mechanical translation can be a weak point.

Source:

- https://www.reddit.com/r/FoundryVTT/comments/1u7qh3r/gm_here_with_a_foundry_ai_assistant_is_it/

This directly supports your concern:

> Rules drift is real.

The response should not be “LLM only.” The useful version needs a validator, readback, and reconciliation.

---

### Non-AI Automation Modules

There are also many non-AI combat automation modules. These matter because they prove Foundry is commonly extended at the combat/action layer.

Examples:

- Dragonbane Combat Assistant: https://foundryvtt.com/packages/dragonbane-action-rules
- PF2e Assistant: https://foundryvtt.com/packages/pf2e-assistant
- PF2e Threat Tracker: https://foundryvtt.com/packages/pf2e-threat-tracker
- PF2e Troops Helper: https://foundryvtt.com/packages/pf2e-troops-helper

These modules show that combat automation, validation, helper panels, and tactical tracking are normal Foundry module patterns.

---

# 2. Feasibility Answer

## Is this possible?

Yes.

## Is Foundry a good target?

Yes.

Foundry is probably the best VTT target for this because:

- It is JavaScript-based.
- It has a rich client API.
- It supports modules deeply.
- The PF2e system is very mature.
- PF2e already tracks a lot of the state you need.
- Combat, tokens, actors, effects, and scenes are all structured documents.
- Community precedent exists.

## Is it easy?

No.

The hard parts are not basic token movement or reading HP.

The hard parts are:

- Producing a clean tactical snapshot.
- Getting all legal/usable PF2e actions.
- Making LLM output strictly structured.
- Preventing rules drift.
- Avoiding state drift between your module and Foundry.
- Handling PF2e edge cases.
- Executing actions through the cleanest PF2e/FVTT workflow.
- Logging state before and after every action.

---

# 3. Core Architecture

```text
Foundry Scene + PF2e Actors
        ↓
State Reader
        ↓
Tactical Snapshot Builder
        ↓
LLM Planner
        ↓
Action Validator
        ↓
Foundry/PF2e Command Executor
        ↓
State Readback
        ↓
Reconciliation
        ↓
Persistent Simulation Event Log
```

The LLM controls all actors, but it does not own state.

---

# 4. Foundry State Ownership

## Foundry/PF2e Owns

- Scene
- Grid
- Walls
- Tokens
- Actor documents
- Actor sheets
- HP
- AC
- saves
- items
- weapons
- spells
- spellcasting entries
- active effects
- conditions
- combat tracker
- initiative
- turn order
- range/vision integration
- flanking automation
- IWR automation, if enabled

## Your Module Owns

- LLM prompts
- Strategy profiles
- Actor tactical roles
- Automation mode
- Scenario import
- Run identity
- Run grouping
- Simulation event log
- Action proposals
- Validation results
- Narrative reports
- Reconciliation records

## LLM Owns

- Tactical choice
- Target prioritization
- Narrative style
- Strategy adaptation across repeated runs

## LLM Does Not Own

- HP
- conditions
- spell slots
- resources
- initiative
- action count
- MAP
- legal targeting
- final rules resolution

---

# 5. Stage-Based Implementation Plan

---

## Stage 1: Foundry Module Skeleton

Goal:

Create a working Foundry module that loads in a PF2e world.

Files:

```text
foundry-ai-combat-controller/
  module.json
  scripts/
    main.js
```

Example `module.json` concept:

```json
{
  "id": "ai-combat-controller",
  "title": "AI Combat Controller",
  "description": "LLM tactical combat controller for Foundry VTT PF2e.",
  "version": "0.1.0",
  "compatibility": {
    "minimum": "12",
    "verified": "14"
  },
  "authors": [
    {
      "name": "Unwhelm / AMBA"
    }
  ],
  "scripts": [
    "scripts/main.js"
  ]
}
```

Example startup:

```js
Hooks.once("ready", () => {
  if (game.system.id !== "pf2e") {
    ui.notifications.warn("AI Combat Controller currently expects the PF2e system.");
    return;
  }

  console.log("AI Combat Controller ready", {
    foundry: game.version,
    system: game.system.id,
    systemVersion: game.system.version
  });
});
```

Deliverable:

- Module appears in Foundry.
- Can be enabled in a PF2e world.
- Logs startup status.
- Warns if not PF2e.

---

## Stage 2: Control Panel UI

Goal:

Add a basic GM-facing panel.

Controls:

```text
[Load Scenario]
[Read Current Combat]
[Build Snapshot]
[Ask LLM for Active Actor]
[Validate Action]
[Execute Action]
[Next Turn]
[Auto Round]
[Pause]
[Stop Simulation]
```

Settings:

```text
Mode:
- Suggest only
- Execute with confirmation
- Full auto

Actor control:
- Enemies only
- NPCs only
- PCs only
- All actors

Narration:
- None
- Rules only
- High narrative

Validation:
- Strict
- Lenient
- Suggest-only
```

Do not start with full automation.

Start with:

```text
Read state → suggest action → show action JSON
```

Then add execution.

---

## Stage 3: Read Current Foundry Combat

Goal:

Read the current combat tracker.

Pseudo-code:

```js
function getCurrentCombat() {
  const combat = game.combat;
  if (!combat) throw new Error("No active combat.");

  return {
    id: combat.id,
    round: combat.round,
    turn: combat.turn,
    combatants: combat.combatants.map(c => ({
      id: c.id,
      tokenId: c.tokenId,
      actorId: c.actorId,
      name: c.name,
      initiative: c.initiative,
      defeated: c.defeated
    })),
    current: combat.combatant
      ? {
          id: combat.combatant.id,
          tokenId: combat.combatant.tokenId,
          actorId: combat.combatant.actorId,
          name: combat.combatant.name
        }
      : null
  };
}
```

Deliverable:

A JSON panel showing:

- Current round
- Current turn
- Initiative order
- Active combatant
- Defeated status

---

## Stage 4: Read Tokens and Actors

Goal:

For each combatant, get token and actor state.

Foundry concept:

```js
const tokenDocument = combatant.token;
const actor = tokenDocument.actor;
```

Snapshot fields:

```js
function readCombatantState(combatant) {
  const token = combatant.token;
  const actor = token?.actor;

  return {
    combatantId: combatant.id,
    tokenId: token?.id,
    actorId: actor?.id,
    name: combatant.name,
    disposition: token?.disposition,
    position: {
      x: token?.x,
      y: token?.y,
      gridX: canvas.grid.getOffset ? null : null
    },
    size: {
      width: token?.width,
      height: token?.height
    },
    defeated: combatant.defeated,
    actorType: actor?.type,
    system: actor?.system
  };
}
```

Important:

Do not send the entire raw `actor.system` object to the LLM. It is too large and too noisy.

Instead extract tactical values.

---

## Stage 5: Build PF2e Tactical Actor Summary

Goal:

Convert Foundry/PF2e actor data into compact state.

For each actor:

```json
{
  "id": "token_xyz",
  "name": "Goblin Warrior",
  "team": "enemy",
  "level": -1,
  "hp": {
    "current": 6,
    "max": 6
  },
  "ac": 16,
  "saves": {
    "fortitude": 5,
    "reflex": 7,
    "will": 3
  },
  "speed": 25,
  "conditions": [],
  "effects": [],
  "position": {
    "gridX": 12,
    "gridY": 8
  },
  "items": {
    "weapons": [],
    "spells": [],
    "consumables": []
  }
}
```

Likely PF2e values are under actor attributes and system data. The exact paths may vary by PF2e version, so this layer should be version-tolerant.

Use adapter methods:

```js
const pf2eAdapter = {
  getHP(actor) {},
  getAC(actor) {},
  getSaves(actor) {},
  getSpeed(actor) {},
  getConditions(actor) {},
  getWeapons(actor) {},
  getSpells(actor) {},
  getConsumables(actor) {},
  getActions(actor) {}
};
```

Do not scatter PF2e property-path assumptions throughout the code.

---

## Stage 6: Read Scene Terrain and Tactical Map

Goal:

Extract enough map information for planning.

Foundry has rich scene data:

- grid size
- token positions
- walls
- doors
- tiles
- drawings
- regions
- lighting
- terrain modules, if used

Initial tactical terrain summary should include:

```json
{
  "sceneId": "abc",
  "grid": {
    "type": "square",
    "size": 100,
    "distance": 5,
    "units": "ft"
  },
  "walls": [],
  "doors": [],
  "tokens": [],
  "lineOfSight": [],
  "coverCandidates": [],
  "hazards": [],
  "difficultTerrain": []
}
```

Do not try to perfectly solve all Foundry geometry on day one.

Minimum useful terrain facts:

- current token grid coordinate
- target token grid coordinate
- straight-line distance
- occupied squares
- walls between active token and target
- nearby cover markers, if configured
- difficult terrain regions, if configured

---

## Stage 7: Build Tactical Snapshot

Goal:

Create the per-turn LLM input.

Snapshot shape:

```json
{
  "ruleset": "pf2e",
  "source": "foundry",
  "round": 2,
  "turn": 4,
  "active": {},
  "initiative": [],
  "allies": [],
  "enemies": [],
  "npcs": [],
  "terrain": {},
  "availableActions": [],
  "resources": {},
  "objectives": [],
  "strategyProfile": {}
}
```

This is the most important artifact in the entire system.

The LLM should receive this every turn.

The LLM should not rely on memory.

---

## Stage 8: Generate Available Actions

Goal:

Tell the LLM what it may choose.

Start simple:

```json
[
  {
    "id": "stride",
    "name": "Stride",
    "cost": 1
  },
  {
    "id": "step",
    "name": "Step",
    "cost": 1
  },
  {
    "id": "strike:dogslicer",
    "name": "Strike: Dogslicer",
    "cost": 1,
    "type": "attack"
  },
  {
    "id": "strike:shortbow",
    "name": "Strike: Shortbow",
    "cost": 1,
    "type": "attack"
  },
  {
    "id": "take-cover",
    "name": "Take Cover",
    "cost": 1
  },
  {
    "id": "end-turn",
    "name": "End Turn",
    "cost": 0
  }
]
```

Then expand:

- Demoralize
- Feint
- Trip
- Grapple
- Shove
- Raise Shield
- Cast Spell
- Battle Medicine
- Draw Item
- Use Consumable
- Sustain Spell
- Escape
- Stand
- Crawl
- Seek
- Recall Knowledge
- Aid
- Ready
- Delay

For PF2e, actions are complex because feats, conditions, items, and effects can add or alter actions.

Do not try to solve all action discovery first.

Instead:

1. Support universal basic actions.
2. Add weapons.
3. Add spells.
4. Add common skill actions.
5. Add actor-specific actions from items/feats.
6. Add custom AI-action annotations.

---

## Stage 9: LLM Planning Prompt

Goal:

Ask the LLM to choose actions for the active actor.

Prompt rule:

```text
You control the active combatant in a PF2e combat.
You may choose only from the provided availableActions list.
Return only JSON.
Do not invent abilities, resources, conditions, or movement.
Prefer legal, tactically sound actions.
Explain tactical intent briefly.
```

Expected output:

```json
{
  "intent": "The goblin is wounded and should avoid melee while pressuring the wounded rogue.",
  "actions": [
    {
      "type": "Stride",
      "destination": {
        "gridX": 14,
        "gridY": 6
      }
    },
    {
      "type": "Strike",
      "actionId": "strike:shortbow",
      "targetId": "token_seren"
    },
    {
      "type": "TakeCover"
    }
  ],
  "fallback": "If target is not visible, move to nearest cover and end turn."
}
```

---

## Stage 10: Validation Layer

Goal:

Catch rules drift before touching Foundry state.

Minimum validation:

```text
Active actor owns the turn.
Action count does not exceed 3.
Action exists in availableActions.
Destination is within movement budget.
Destination is not occupied illegally.
Destination is not blocked.
Target exists.
Target is enemy or valid target.
Target is in range.
Weapon exists.
Spell/resource exists.
Spell/resource has remaining uses.
Condition does not prevent action.
MAP can be calculated.
```

Validation result:

```json
{
  "valid": false,
  "reason": "The selected target is not visible from the destination.",
  "repairHints": [
    "Choose pc_brakka instead.",
    "Move to gridX 13 gridY 5 first.",
    "Use Seek or End Turn."
  ]
}
```

Then run a repair loop:

```text
LLM proposal
  ↓
validator rejects
  ↓
LLM receives reason + legal alternatives
  ↓
LLM returns revised JSON
  ↓
validator checks again
```

After two failures, use deterministic fallback.

---

## Stage 11: Execute Movement in Foundry

Goal:

Move tokens after validation.

Conceptual movement command:

```js
async function moveToken(tokenDocument, gridX, gridY) {
  const pixel = gridToPixel(gridX, gridY);

  await tokenDocument.update({
    x: pixel.x,
    y: pixel.y
  });
}
```

Important:

- Foundry token positions are usually pixel/canvas coordinates, not logical grid coordinates.
- Your adapter should convert grid to pixel and pixel to grid.
- Read back the token after update.

After movement:

```js
const updated = canvas.scene.tokens.get(tokenDocument.id);
```

Then log:

```json
{
  "eventType": "tokenMoved",
  "before": {
    "gridX": 12,
    "gridY": 5
  },
  "after": {
    "gridX": 14,
    "gridY": 6
  }
}
```

---

## Stage 12: Execute Strikes

Goal:

Use PF2e item/action workflow if possible.

Desired behavior:

```text
Use the actor's weapon item.
Roll attack against target.
Let PF2e apply modifiers where possible.
Roll damage.
Apply damage.
Read back HP.
```

Potential implementation patterns:

1. Call PF2e actor/item roll methods directly.
2. Trigger item sheet roll methods.
3. Use chat card/action macros.
4. Fall back to your own dice and damage logic, then update HP.

Preferred order:

```text
PF2e-native roll/action method
  ↓ if unavailable
Module adapter for item roll
  ↓ if unavailable
Custom resolver with Foundry chat output
```

Do not start by trying to automate every PF2e roll perfectly.

Start with:

```text
Basic Strike:
- choose weapon
- roll d20
- apply attack bonus from item/actor summary
- compare AC
- roll damage
- apply HP damage
- create chat message
```

Then replace custom pieces with PF2e-native methods as you discover stable APIs.

---

## Stage 13: Execute Spells

Spells are harder than Strikes.

Need to know:

- spell exists
- spell rank
- number of actions
- target type
- range
- area template
- save DC
- spell attack modifier
- remaining slots or prepared uses
- damage/effects
- heightened version
- traits

Stage spells later.

First spell support:

```text
single-target spell attack
single-target saving throw spell
simple area save spell
```

Example spell command:

```json
{
  "type": "CastSpell",
  "spellId": "electric-arc",
  "targets": ["token_goblin_1", "token_goblin_2"]
}
```

Validate:

- spell known/prepared
- can target that many creatures
- targets in range
- actions remaining
- resource available
- no condition prevents casting

---

## Stage 14: Conditions and Effects

Goal:

Read and write PF2e conditions.

Foundry/PF2e already has condition/effect concepts.

Your module should initially read:

- prone
- grabbed
- restrained
- frightened
- sickened
- slowed
- stunned
- fleeing
- confused
- concealed
- hidden
- invisible
- dying
- wounded
- unconscious
- off-guard
- shield raised

When applying conditions, prefer PF2e-native condition APIs if available.

If not, create a narrow adapter:

```js
pf2eAdapter.applyCondition(actor, "frightened", { value: 1 });
pf2eAdapter.removeCondition(actor, "frightened");
```

Do not mutate raw effect structures in scattered code.

---

## Stage 15: Per-Round / Per-Turn Automation

Goal:

Let the LLM control all actors.

Modes:

```text
Suggest Only:
- Build snapshot.
- Ask LLM.
- Show suggestion.
- GM clicks execute manually.

Confirm Each Action:
- LLM proposes.
- Validator approves.
- GM confirms.
- Module executes.

Manual Step:
- Press Enter / Next Actor.
- LLM controls one active combatant.

Auto Round:
- LLM controls everyone until round ends.

Auto Combat:
- LLM controls everyone until combat ends or GM pauses.
```

Turn loop:

```text
while combat is active:
  read active combatant
  build tactical snapshot
  ask LLM for action plan
  validate action plan
  repair if invalid
  execute each action
  read back state
  log event
  advance turn
```

Round loop:

```text
start round
for each combatant in initiative order:
  run turn loop
end round
summarize round
```

---

## Stage 16: Sending Actions Per Round

The Foundry action sender should be a command queue.

Example command queue:

```json
{
  "round": 2,
  "turn": 4,
  "active": "enemy_goblin_2",
  "commands": [
    {
      "command": "moveToken",
      "tokenId": "abc",
      "destination": {
        "gridX": 14,
        "gridY": 6
      }
    },
    {
      "command": "strike",
      "actorId": "def",
      "tokenId": "abc",
      "itemId": "shortbow",
      "targetTokenId": "seren"
    },
    {
      "command": "applyEffect",
      "targetTokenId": "abc",
      "effect": "take-cover"
    }
  ]
}
```

Execution:

```js
for (const command of commands) {
  await executor.execute(command);
  await readBackAndLog(command);
}
```

This queue lets you:

- pause between actions
- show preview
- let GM approve
- recover from failures
- log each command
- compare expected vs actual state

---

## Stage 17: State Readback and Reconciliation

After every command, re-read state from Foundry.

Example:

```json
{
  "expected": {
    "pc_seren.hp.current": 3
  },
  "actual": {
    "pc_seren.hp.current": 4
  },
  "resolution": "accepted_foundry_state",
  "reason": "PF2e IWR automation adjusted damage."
}
```

Rule:

> In Foundry mode, Foundry/PF2e wins visible combat state.

Your app logs mismatches instead of silently overriding them.

---

## Stage 18: Persistent Logs

Store each simulation run.

Use either:

- Foundry flags
- world journal entries
- exported JSON
- external local API
- AMBA backend
- SQLite/Postgres outside Foundry

Recommended:

```text
For prototype: Foundry world flags or JSON export.
For AMBA integration: external API + database.
```

Event shape:

```json
{
  "runId": "run_001",
  "scenarioId": "foundry_scene_gatehouse",
  "round": 2,
  "turn": 4,
  "activeTokenId": "enemy_goblin_2",
  "snapshot": {},
  "llmProposal": {},
  "validation": {},
  "commands": [],
  "stateBefore": {},
  "stateAfter": {},
  "reconciliation": [],
  "narration": ""
}
```

---

## Stage 19: Scenario Loading

There are two scenario-loading directions.

---

### Direction A: Existing Foundry Scene to Simulation

Use an existing scene.

Flow:

```text
GM opens Foundry scene.
GM places tokens.
GM creates combat encounter.
GM starts combat.
Module reads combat.
Module begins LLM control.
```

This is easier.

Implementation:

```text
Read current scene.
Read current combat.
Read current tokens.
Build snapshot.
Run turn.
```

---

### Direction B: AMBA / JSON Scenario to Foundry Scene

Use AMBA or external JSON to create a Foundry scene.

Flow:

```text
AMBA encounter JSON
  ↓
Foundry import adapter
  ↓
Create scene
  ↓
Create walls/terrain
  ↓
Create/import actors
  ↓
Place tokens
  ↓
Create combat tracker
  ↓
Roll initiative
  ↓
Start simulation
```

This is more powerful but harder.

Initial import JSON:

```json
{
  "scene": {
    "name": "Gatehouse Crawler Ambush",
    "grid": {
      "cellSizeFeet": 5,
      "width": 20,
      "height": 9
    },
    "map": [
      "####################",
      "#..........#.......#",
      "#..........#...g...#",
      "#....~.....#.......#",
      "#....~.............#",
      "#....~.....#####...#",
      "#..........#.......#",
      "#.....R....#...c...#",
      "####################"
    ]
  },
  "combatants": []
}
```

Adapter creates:

- Scene
- Background/grid
- Walls from `#`
- Terrain notes from `~`
- Tokens from token markers
- Actor links from combatants

For prototype, do not create pretty maps.

Use a blank grid plus walls/tokens.

---

## Stage 20: Strategy Profiles

The LLM should receive a profile for each actor.

Example:

```json
{
  "actorId": "enemy_goblin_2",
  "strategyProfile": {
    "id": "cowardly_skirmisher",
    "goals": [
      "avoid melee",
      "use cover",
      "target wounded enemies",
      "flee below 30% HP"
    ]
  }
}
```

Profiles:

| Profile | Behavior |
|---|---|
| beast | nearest target, simple aggression |
| cowardly_skirmisher | ranged attacks, cover, retreat |
| disciplined_soldier | formation, flanking, focus fire |
| assassin | isolate and finish wounded targets |
| defender | protect leader/objective |
| controller | debuff and battlefield control |
| boss_adaptive | changes tactics after failure |

This is where your system can become better than normal VTT automation.

---

# 6. Recommended Build Order

## Build 1: Suggestion-Only Module

- Module loads.
- Reads active combat.
- Reads active token/actor.
- Builds snapshot.
- Sends snapshot to LLM.
- Displays suggested actions.
- Does not execute anything.

This proves:

```text
Foundry state → tactical snapshot → LLM action
```

---

## Build 2: Manual Execute Basic Movement

- LLM suggests Stride.
- GM approves.
- Module moves token.
- Module logs movement.
- Module reads state back.

This proves:

```text
LLM action → validation → Foundry command → state readback
```

---

## Build 3: Basic Strike

- LLM suggests Strike.
- Validator checks target/range.
- Module rolls attack.
- Module logs math.
- Module applies damage or uses PF2e roll workflow.
- Module reads HP back.

This proves:

```text
PF2e action resolution path
```

---

## Build 4: Auto Turn

- LLM controls one actor for a full PF2e turn.
- Maximum three actions.
- Validates each action.
- Executes in sequence.
- Advances turn.

---

## Build 5: Auto Round

- LLM controls all selected actors for one round.
- GM can pause.
- Full event log saved.

---

## Build 6: Auto Combat

- LLM controls selected teams until combat ends.
- Stops on:
  - combat over
  - validation failure
  - unresolved spell/action
  - GM pause
  - max round limit

---

## Build 7: Scenario Import

- Load AMBA JSON.
- Create simple Foundry scene.
- Create/place actors.
- Create combat.
- Roll initiative.
- Start simulation.

---

## Build 8: Repeated Simulation

- Duplicate initial scene/combat state.
- Run scenario multiple times.
- Persist each run.
- Compare outcomes.

---

# 7. Major Risks

## Risk 1: PF2e Internal API Stability

PF2e data paths and roll methods may change.

Mitigation:

- Keep all PF2e-specific logic inside `pf2eAdapter`.
- Version-gate where needed.
- Prefer public/system-supported methods where available.
- Avoid mutating raw internals unless necessary.

---

## Risk 2: LLM Rules Drift

The LLM may propose illegal actions.

Mitigation:

- availableActions whitelist
- strict JSON schema
- validator
- repair loop
- deterministic fallback
- Foundry/PF2e readback

---

## Risk 3: State Drift

Your expected state may differ from Foundry state.

Mitigation:

- read state before every turn
- read state after every command
- Foundry wins in Foundry mode
- log reconciliation events

---

## Risk 4: Too Much Raw Actor Data

PF2e actors can be huge.

Mitigation:

- do not send raw actor data to LLM
- extract compact tactical summaries
- include only relevant items/actions/resources
- use retrieval for rules text only when needed

---

## Risk 5: Automating Spells Too Early

PF2e spells are complex.

Mitigation:

- start with movement and Strikes
- then skill actions
- then simple spells
- then templates/areas
- then complex spell effects

---

# 8. Key Technical Design Principle

Use adapters everywhere.

```text
LLM Planner
  does not know Foundry

Validator
  does not know raw PF2e internals

Command Executor
  knows Foundry commands

PF2e Adapter
  knows PF2e actor/item/effect paths

Runtime Adapter
  knows whether this is Foundry, local simulator, or future Roll20
```

Interfaces:

```ts
interface RuntimeAdapter {
  readCombatState(): Promise<CombatState>;
  moveToken(tokenId: string, destination: GridPosition): Promise<CommandResult>;
  executeStrike(actorId: string, itemId: string, targetId: string): Promise<CommandResult>;
  applyDamage(targetId: string, damage: DamagePayload): Promise<CommandResult>;
  applyCondition(targetId: string, condition: ConditionPayload): Promise<CommandResult>;
  advanceTurn(): Promise<CommandResult>;
}
```

---

# 9. Bottom Line

Yes, this is possible.

People have already tried adjacent versions:

- AI combat suggestion for PF2e in Foundry
- AI/NPC automation discussions
- D&D 5e automated NPC behavior
- non-AI combat automation modules
- PF2e helper/automation modules

The correct version for AMBA is not just “ChatGPT controls monsters.”

The correct version is:

```text
Foundry/PF2e owns state.
Your module builds a tactical snapshot.
LLM proposes actions for every actor.
Validator blocks illegal actions.
Executor sends legal actions to Foundry.
Foundry/PF2e resolves or reflects state.
Your module reads back state.
Every event is logged.
Repeated runs are grouped and compared.
```

That gives you the best of both worlds:

- Foundry's mature VTT and PF2e implementation
- LLM tactical flexibility
- Your own persistent simulation architecture
- AMBA-compatible encounter testing and replay
