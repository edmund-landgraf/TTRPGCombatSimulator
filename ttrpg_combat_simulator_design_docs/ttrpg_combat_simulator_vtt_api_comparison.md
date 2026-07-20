# Combat Simulator Architecture Comparison
## Custom Simulator vs Existing VTT / TTRPG API Integration

This document compares two ways to build the combat simulator:

1. **Build our own combat simulator engine**
2. **Use an existing VTT/TTRPG platform and manipulate tokens/actions through its API**

The key question is:

> If the VTT already tracks tokens, HP, initiative, and conditions, does the LLM still need to track everything too?

The short answer:

> The LLM should understand the current state well enough to make decisions, but it should not be the source of truth.

The source of truth should be either:

- Our simulator engine, or
- The VTT/platform engine, or
- A synchronized state layer that reads from the VTT and validates before writing back.

The LLM should be treated as a tactical planner and narrator, not as the authoritative combat database.

---

# 1. Two Main Architecture Options

## Option A: Build Our Own Simulator

```text
Encounter JSON
   ↓
Our Simulator Engine
   ↓
Rules Validation
   ↓
State Update
   ↓
Map Render / UI
   ↓
Persistent Run Log
```

In this model, our app owns:

- Initiative
- Token positions
- HP
- Conditions
- Actions remaining
- Reactions
- Spell slots
- Consumables
- Movement rules
- Line of sight
- Dice rolls
- Damage
- Victory conditions
- Simulation history
- Run grouping

The LLM proposes actions, but our simulator validates and applies them.

---

## Option B: Use Existing VTT / TTRPG API

```text
VTT Scene / Encounter
   ↓
Read State from VTT API
   ↓
LLM Proposes Action
   ↓
Rules / API Validation Layer
   ↓
Write Action Back to VTT
   ↓
Read Updated State from VTT
   ↓
Persistent External Log
```

In this model, the VTT may own:

- Token positions
- HP
- Initiative
- Conditions
- Actor sheets
- Inventory
- Spell slots
- Effects
- Vision
- Walls
- Terrain
- Measured movement
- Dice rolls, depending on system
- Automation, depending on modules

The LLM still proposes actions, but the VTT executes or reflects the results.

---

# 2. Important Distinction: VTT vs Rules Engine

A VTT is not always a complete rules engine.

Some VTTs are mostly:

```text
Map + tokens + sheets + dice roller
```

Others, with specific systems/modules, can become closer to:

```text
Map + tokens + sheets + rules automation + effect tracking
```

For example, a platform may track token position and HP perfectly, but may not automatically know whether:

- A spell is legal to cast right now
- A target is valid
- MAP was applied correctly
- A condition should expire
- Cover applies
- A PC has the right feat reaction
- Persistent damage should roll at end of turn
- A creature can Step through terrain
- A spell slot should be consumed

So we should not assume the existing platform handles everything unless we confirm it.

---

# 3. Does the LLM Need to Track Everything Too?

No.

The LLM should receive a **snapshot** of the current state, make a tactical decision, and return structured intent.

It should not maintain its own independent memory of combat state.

Bad architecture:

```text
LLM remembers:
- Goblin has 4 HP
- Wizard used fireball
- Fighter is prone
- Initiative is on round 3
```

This is risky because LLM memory can drift.

Better architecture:

```text
Authoritative State Store
   ↓
Compact Tactical Snapshot
   ↓
LLM Decision
   ↓
Validator
   ↓
Authoritative State Update
```

The LLM gets state every turn.

It does not own state.

---

# 4. Best Mental Model

Think of the LLM as a player at the table.

The player can say:

> I move behind the wall, shoot the cleric, then take cover.

But the GM/system says:

> You only have 25 feet of movement, that wall blocks line of sight, and you already used your reaction.

The LLM is the player brain.

The engine/VTT is the GM/rules authority.

---

# 5. Step-by-Step: Using an Existing VTT API

This flow assumes the VTT already has a scene, tokens, actor sheets, and a PF2e system installed.

---

## Step 1: Import or Locate the Encounter

The encounter may already exist in the VTT.

The simulator finds:

- Scene ID
- Encounter/combat ID
- Token IDs
- Actor IDs
- Current initiative tracker
- Current map/grid
- Active combatant
- Current round

Example internal link:

```json
{
  "vtt": "foundry",
  "worldId": "shining-lands-test",
  "sceneId": "scene_gatehouse",
  "combatId": "combat_001"
}
```

Our app should not assume the map is ASCII anymore.

Instead, it reads the VTT scene and translates it into our tactical model.

---

## Step 2: Read the Current VTT State

The app asks the VTT API for:

```json
{
  "round": 2,
  "turn": 4,
  "activeToken": "Goblin Cutter 1",
  "tokens": [],
  "actors": [],
  "effects": [],
  "walls": [],
  "terrain": [],
  "initiative": []
}
```

Important state to read:

| State | Needed? | Source |
|---|---:|---|
| Token position | Yes | VTT scene |
| Token size | Yes | VTT token |
| HP | Yes | Actor/system data |
| AC | Yes | Actor/system data |
| Saves | Yes | Actor/system data |
| Actions remaining | Maybe | Our turn tracker or VTT module |
| Conditions | Yes | Actor effects |
| Spell slots | Yes | Actor items/system data |
| Inventory | Eventually | Actor items |
| Initiative | Yes | VTT combat tracker |
| Vision/LOS | Ideally | VTT scene or our tactical layer |
| Terrain | Ideally | Scene/map module or our terrain adapter |

---

## Step 3: Normalize VTT State into Tactical State

Do not send raw VTT data directly to the LLM.

Raw VTT actor data can be huge and noisy.

Instead, create a compact tactical snapshot:

```json
{
  "ruleset": "pf2e",
  "round": 2,
  "active": {
    "id": "token_goblin_1",
    "name": "Goblin Cutter 1",
    "hp": "3/6",
    "ac": 16,
    "position": { "x": 14, "y": 2 },
    "conditions": ["frightened 1"],
    "actionsRemaining": 3
  },
  "visibleOpponents": [
    {
      "id": "token_seren",
      "name": "Seren",
      "hp": "7/18",
      "ac": 17,
      "position": { "x": 7, "y": 5 },
      "conditions": []
    }
  ],
  "availableActions": [
    "Stride",
    "Step",
    "Strike: Dogslicer",
    "Strike: Shortbow",
    "Take Cover",
    "End Turn"
  ],
  "mapSummary": {
    "coverNearby": true,
    "nearestCover": { "x": 15, "y": 3 },
    "nearestEnemyDistanceFeet": 40
  }
}
```

This snapshot is what the LLM uses.

---

## Step 4: LLM Proposes Actions

The LLM returns structured JSON:

```json
{
  "intent": "Stay alive and pressure the wounded rogue.",
  "actions": [
    {
      "type": "Stride",
      "destination": { "x": 15, "y": 3 }
    },
    {
      "type": "Strike",
      "attackId": "shortbow",
      "targetId": "token_seren"
    },
    {
      "type": "TakeCover"
    }
  ]
}
```

This is still only a proposal.

---

## Step 5: Validate Against Rules and VTT State

There are three possible validation strategies.

---

### Strategy 1: VTT-Only Validation

The app asks the VTT to execute the proposed action.

If the VTT rejects or cannot perform the action, the action fails.

Problem:

Many VTT APIs do not expose high-level action validation cleanly.

They may allow you to move a token anywhere, even illegally.

So this is not enough by itself unless the VTT system is highly automated.

---

### Strategy 2: Our Validation Before VTT Write

Our app validates the action before calling the VTT API.

Example checks:

- Is destination reachable?
- Does movement exceed speed?
- Does terrain block movement?
- Is target in range?
- Does the actor have that weapon?
- Does MAP apply?
- Does the spell slot exist?
- Is the spell already spent?
- Is the actor stunned, slowed, grabbed, prone, etc.?

Then the app writes only legal changes to the VTT.

This is safer.

---

### Strategy 3: Hybrid Validation

Best approach:

```text
Our Tactical Validator
   ↓
VTT/System Validation
   ↓
Apply Action
   ↓
Read Back State
   ↓
Compare Expected vs Actual
```

This catches drift.

Example:

```text
Our validator thinks the goblin has 3 HP.
VTT says the goblin has 2 HP.
Trust the VTT, update our snapshot, and continue.
```

---

## Step 6: Execute Action Through VTT API

For movement:

```text
Move token_goblin_1 to x15 y3.
```

For attack:

```text
Trigger actor item "Shortbow" against target token_seren.
```

Depending on platform automation, the VTT may:

- Roll the attack
- Apply MAP
- Compare AC
- Roll damage
- Apply damage
- Consume resources
- Add chat card
- Apply conditions

Or it may only:

- Roll dice
- Show result
- Require manual damage application

If the VTT is not fully automated, our app still needs to resolve the mechanics.

---

## Step 7: Read Updated State Back from VTT

After execution, always re-read state.

Do not assume our write succeeded exactly as planned.

Read:

- Token position
- HP changes
- Conditions
- Resource changes
- Chat/dice results
- Initiative changes
- Active turn

This prevents state drift.

---

## Step 8: Persist Our Own Simulation Log

Even if the VTT has a chat log, our app should save its own structured simulation log.

Why?

Because VTT chat logs are usually not ideal for:

- Statistical comparison
- Run grouping
- AI strategy review
- Replays
- Encounter balance analysis
- Exporting to AMBA
- Re-running same scenario 10 times
- Comparing different branches

Our event log should store:

```json
{
  "runId": "run_004",
  "round": 2,
  "active": "Goblin Cutter 1",
  "proposedAction": {},
  "validatedAction": {},
  "vttCommand": {},
  "vttResult": {},
  "stateBefore": {},
  "stateAfter": {},
  "narration": "..."
}
```

---

## Step 9: Advance Turn

If the VTT owns initiative, tell the VTT:

```text
Advance to next turn.
```

Then read back the new active combatant.

If our app owns initiative, update internally and optionally sync display to VTT.

Strong recommendation:

> If using an existing VTT, let the VTT own initiative display, but our app should keep a mirrored copy for logs and validation.

---

## Step 10: Repeat Until Combat Ends

At the end of each turn:

- Check VTT combat state
- Check HP/dead/unconscious status
- Check objectives
- Save event
- Advance combat

---

# 6. What the VTT Owns vs What Our App Owns

## If VTT Is Source of Truth

| System Area | Owner |
|---|---|
| Token positions | VTT |
| Map/walls/vision | VTT |
| Actor sheets | VTT |
| HP | VTT |
| Conditions | VTT |
| Initiative | VTT |
| Dice rolls | VTT or our app |
| Tactical choice | LLM |
| Rules validation | Hybrid |
| Simulation grouping | Our app |
| Persistent run comparison | Our app |
| Strategy memory | Our app |
| Narrative reports | Our app |

---

## If Our Simulator Is Source of Truth

| System Area | Owner |
|---|---|
| Token positions | Our app |
| Map/walls/vision | Our app |
| Actor sheets | Our app |
| HP | Our app |
| Conditions | Our app |
| Initiative | Our app |
| Dice rolls | Our app |
| Tactical choice | LLM |
| Rules validation | Our app |
| Simulation grouping | Our app |
| Persistent run comparison | Our app |
| Strategy memory | Our app |
| Narrative reports | Our app |
| VTT display | Optional |

---

# 7. The LLM's Actual Role

The LLM should do four things:

## 7.1 Tactical Planning

Given state:

```text
The rogue is wounded.
The fighter is blocking the hallway.
The goblin has a bow.
There is cover nearby.
```

Choose:

```text
Move to cover, shoot rogue, take cover.
```

---

## 7.2 Rule Navigation Assistance

The LLM can help choose candidate rules:

```text
This action likely uses Strike.
This save targets Reflex DC.
This condition may make the target off-guard.
```

But the validator must confirm.

---

## 7.3 Narrative Description

Convert structured outcomes into high narrative:

```text
The goblin presses itself against the broken lintel, breath steaming in the damp gatehouse air. Its arrow flashes once in the torchlight before sinking into Seren's ribs.
```

---

## 7.4 Strategy Adaptation Across Runs

After several runs:

```text
The enemies lost because they charged through the mud.
Try using the crawler as a blocker while goblins use ranged attacks.
```

This is a good LLM job.

---

# 8. The LLM Should Not Do These Things

The LLM should not be trusted to:

- Remember exact HP over many turns
- Remember used spell slots without state input
- Apply PF2e MAP correctly every time
- Know every active condition from memory
- Decide legal movement without pathfinding
- Mutate the database directly
- Invent abilities
- Declare victory
- Apply damage without validation
- Consume resources without engine confirmation

It can suggest.

The engine decides.

---

# 9. Comparison: Build Own Simulator vs Use Existing VTT API

## 9.1 Build Own Simulator

### Advantages

- Full control over state
- Easier to batch-run simulations
- Easier to run 10, 100, or 1,000 scenario trials
- Easier to persist structured logs
- Easier to compare strategies
- Easier to integrate with AMBA
- No dependency on VTT internals
- Can be ruleset-agnostic from the start
- Can simplify map logic early
- Easier to test deterministically
- Easier to support headless/server mode

### Disadvantages

- Must build map movement
- Must build line of sight
- Must build condition tracking
- Must build resource tracking
- Must build PF2e rules logic
- Must build UI
- Must build import/export tools
- More up-front engineering
- Harder to match a real VTT experience quickly

### Best For

- Encounter balance testing
- AI combat research
- AMBA integration
- Repeatable simulations
- Adventure authoring
- Batch reports
- Running many trials
- Building your own tactical engine

---

## 9.2 Use Existing VTT API

### Advantages

- Existing map display
- Existing token movement
- Existing actor sheets
- Existing initiative tracker
- Existing HP and condition UI
- Existing dice/chat log
- Existing walls/vision/lighting
- Existing community rules systems
- Faster visual prototype
- Players/GMs already understand it
- Can use real campaign scenes

### Disadvantages

- API may not expose everything cleanly
- Automation quality depends on system/modules
- Harder to batch-run many simulations
- Harder to avoid UI coupling
- Harder to guarantee deterministic runs
- Harder to persist clean structured results
- VTT state can drift from our state
- Module updates may break integration
- Headless operation may be difficult
- Some actions may require UI-level automation instead of API-level commands

### Best For

- GM assistant mode
- Live table integration
- Visual demos
- Using existing campaigns
- Manipulating real VTT scenes
- Letting users watch combat unfold
- Tactical co-pilot for existing play

---

# 10. The Best Hybrid Architecture

The best long-term design is probably hybrid:

```text
Our Combat Simulation Core
   ↔
VTT Adapter
   ↔
Foundry / Roll20 / Other VTT
```

The simulator should have its own internal model.

Then it can either:

1. Run headless by itself, or
2. Drive a VTT as a visual front end.

This avoids locking the project to one VTT.

---

## 10.1 Hybrid Flow

```text
Load Encounter
   ↓
Normalize to Internal Combat Model
   ↓
Choose Execution Mode
      ├── Headless Simulator
      └── VTT-Controlled Simulator
```

In headless mode:

```text
Internal state is source of truth.
```

In VTT mode:

```text
VTT state is source of truth, but internal model mirrors it.
```

---

# 11. Recommended Adapter Pattern

Create adapters:

```ts
interface CombatRuntimeAdapter {
  readState(): Promise<EncounterState>;
  moveToken(tokenId: string, destination: Position): Promise<VttCommandResult>;
  rollAttack(action: StrikeAction): Promise<RollResult>;
  applyDamage(targetId: string, damage: DamageResult): Promise<void>;
  applyCondition(targetId: string, condition: Condition): Promise<void>;
  advanceTurn(): Promise<void>;
}
```

Implementations:

```text
LocalRuntimeAdapter
FoundryRuntimeAdapter
Roll20RuntimeAdapter
OwlbearRuntimeAdapter
AMBARuntimeAdapter
```

Then the engine can run against any backend.

---

# 12. Example Hybrid Turn

## Starting State

```text
Round 2.
Active combatant: Goblin Cutter 1.
Goblin HP: 3/6.
Seren HP: 7/18.
Goblin has shortbow.
Seren is 40 feet away.
Crate nearby gives cover.
```

---

## LLM Proposal

```json
{
  "actions": [
    {
      "type": "Stride",
      "destination": { "x": 15, "y": 3 }
    },
    {
      "type": "Strike",
      "attackId": "shortbow",
      "targetId": "pc_seren"
    },
    {
      "type": "TakeCover"
    }
  ]
}
```

---

## Validator Checks

```text
Stride:
- Destination is open.
- Path is 10 feet.
- Goblin speed is 25 feet.
- Legal.

Strike:
- Shortbow exists.
- Seren is visible.
- Distance is 40 feet.
- Shortbow range increment is 60 feet.
- MAP is 0.
- Legal.

Take Cover:
- Crate provides standard cover.
- Goblin is adjacent to cover.
- Legal.
```

---

## VTT Commands

```text
1. Move token Goblin Cutter 1 to x15 y3.
2. Roll Shortbow attack against Seren.
3. Apply damage if hit.
4. Apply cover effect to Goblin Cutter 1.
5. Advance turn.
```

---

## Result Readback

```json
{
  "goblinPosition": { "x": 15, "y": 3 },
  "serenHp": {
    "before": 7,
    "after": 3
  },
  "goblinEffects": ["standard cover"],
  "chatRoll": {
    "d20": 13,
    "bonus": 8,
    "total": 21,
    "targetAc": 17,
    "result": "hit",
    "damage": 4
  }
}
```

---

## Combat Log

```text
Goblin Cutter 1 darts behind the broken crate.

Movement:
Stride from x14 y2 to x15 y3.
Distance moved: 10 feet.
Speed available: 25 feet.
Action cost: 1.

Shortbow Strike against Seren:
d20 = 13
Shortbow attack bonus = +8
Multiple Attack Penalty = 0
Total = 21

Seren AC = 17.
21 beats AC 17 by 4.
Result: Hit.

Damage:
1d6 piercing = 4.
Seren HP: 7 → 3.

The goblin looses from cover. The arrow cuts through the mist and punches into Seren's side, dropping her to one knee in the mud.

Action 3:
Goblin Cutter 1 Takes Cover behind the crate.
Goblin gains improved defensive position until it moves or the cover no longer applies.
```

---

# 13. State Sync Problem

If both the VTT and our simulator track state, drift can happen.

Example drift:

```text
Our app thinks the goblin is at x15 y3.
VTT says the goblin is at x16 y3.
```

Or:

```text
Our app thinks Seren has 3 HP.
VTT says Seren has 4 HP because resistance was applied by a module.
```

Solution:

After every command:

1. Read VTT state.
2. Compare against expected state.
3. If different, decide which system wins.
4. Log the correction.

Recommended rule:

> In VTT mode, the VTT wins for visible actor state, but our app logs the discrepancy.

Example log:

```json
{
  "eventType": "stateReconciliation",
  "field": "pc_seren.hp.current",
  "expected": 3,
  "actual": 4,
  "resolution": "accepted_vtt_state"
}
```

---

# 14. Simulation Persistence with VTT Integration

Even if the VTT owns state, our app should own simulation grouping.

```text
Scenario Parent
  ├── Run 1 using local simulator
  ├── Run 2 using local simulator
  ├── Run 3 using Foundry scene
  └── Run 4 using Foundry scene with altered enemy strategy
```

Store:

- Source platform
- Scene ID
- Combat ID
- Imported state hash
- Simulation options
- Strategy profile
- Run events
- Outcome
- Reconciliation notes

Example:

```json
{
  "scenarioId": "scenario_abc123",
  "source": {
    "type": "foundry",
    "worldId": "shining-lands",
    "sceneId": "gatehouse",
    "combatId": "combat_001"
  },
  "scenarioHash": "abc123",
  "runs": []
}
```

---

# 15. What Existing VTT APIs Are Good For

An existing VTT is excellent for:

- Visual board state
- Token movement
- Initiative display
- Actor sheet storage
- Manual GM correction
- Dice presentation
- Player familiarity
- Live play
- Real map assets
- Walls, doors, lights, fog, vision

It is less ideal for:

- Running 100 simulations unattended
- Comparing outcomes statistically
- Changing strategy across runs
- Cleanly exporting every action as structured data
- Supporting multiple rulesets equally
- Guaranteeing API stability
- Headless encounter testing

---

# 16. What Our Own Simulator Is Good For

Our own simulator is excellent for:

- Fast iteration
- Controlled rules validation
- Repeatable experiments
- Scenario branching
- Strategy comparison
- AMBA adventure testing
- Generating encounter balance reports
- Running without UI
- Swapping rulesets
- Saving complete structured state
- Using AI safely behind validation

It is less ideal for:

- Beautiful maps early
- Full VTT-like UX
- Player-facing sessions
- Mature automation on day one
- Handling every PF2e edge case immediately

---

# 17. Recommended Roadmap

## Phase 1: Build Local Simulator Core

Do this first.

Why?

Because it gives you ownership of:

- State model
- Validation model
- Run persistence
- Scenario hashing
- AI strategy loop
- Logs
- Repeatable tests

Do not start with a VTT API first, because you may get trapped by another platform's data model.

---

## Phase 2: Build a VTT Import Adapter

Import a scene from a VTT into our internal model.

```text
VTT Scene → Simulator Encounter JSON
```

This lets a GM create maps in a VTT, then run batch simulations in our app.

---

## Phase 3: Build a VTT Control Adapter

Drive a live VTT scene.

```text
Simulator Action → VTT Token Movement / Rolls / Effects
```

This turns the simulator into a GM co-pilot.

---

## Phase 4: Bidirectional Sync

Allow:

```text
VTT manual correction → simulator state update
```

Useful when a GM overrides the AI or manually adjusts conditions.

---

# 18. Final Recommendation

The strongest architecture is:

```text
Own the simulator.
Adapt to VTTs.
Do not become dependent on a VTT.
```

Build the local simulator as the rules/state authority first.

Then add VTT adapters so the same engine can either:

1. Run headless for balance testing, or
2. Manipulate an existing VTT scene for visual/live play.

The LLM should never be the state authority.

In all modes, the LLM should:

- Read current state
- Propose actions
- Explain tactics
- Narrate results
- Adapt strategy across runs

The engine or VTT should:

- Track HP
- Track initiative
- Track conditions
- Track resources
- Validate actions
- Roll or verify dice
- Apply results
- Persist state

That separation keeps the system powerful, debuggable, and safe from LLM drift.

---

# 19. Required Tactical State for Planning

Yes: to plan intelligently, the LLM needs to know the current state of:

- PCs
- Enemies
- NPCs
- Terrain
- Initiative
- Actions remaining
- Resources
- Conditions
- Threats and objectives

But the LLM should receive this as a **fresh tactical snapshot every turn**, not as something it remembers internally.

The planner needs enough information to answer:

```text
Who am I?
Whose turn is it?
How many actions do I have?
Where am I?
Where are my enemies?
Who is wounded?
Who is dangerous?
What terrain matters?
What actions are legal?
What resources remain?
What conditions affect this turn?
What is the objective?
```

The engine or VTT remains the source of truth.

---

## 19.1 The Tactical Snapshot

Before each participant acts, the simulator should build a compact state packet.

Example:

```json
{
  "ruleset": "pf2e",
  "round": 3,
  "turnNumber": 14,
  "activeCombatantId": "enemy_goblin_2",
  "initiative": {
    "currentIndex": 2,
    "order": [
      {
        "id": "pc_seren",
        "name": "Seren",
        "initiative": 22,
        "status": "waiting"
      },
      {
        "id": "pc_brakka",
        "name": "Brakka",
        "initiative": 18,
        "status": "waiting"
      },
      {
        "id": "enemy_goblin_2",
        "name": "Goblin Cutter 2",
        "initiative": 16,
        "status": "active"
      },
      {
        "id": "enemy_crawler_1",
        "name": "Gatehouse Crawler",
        "initiative": 10,
        "status": "waiting"
      }
    ]
  },
  "active": {
    "id": "enemy_goblin_2",
    "name": "Goblin Cutter 2",
    "team": "enemy",
    "hp": {
      "current": 4,
      "max": 6
    },
    "ac": 16,
    "speed": 25,
    "position": {
      "x": 15,
      "y": 3
    },
    "actionsRemaining": 3,
    "reactionAvailable": true,
    "multipleAttackPenalty": 0,
    "conditions": [],
    "resources": {
      "arrows": "not tracked"
    },
    "availableActions": [
      "Stride",
      "Step",
      "Strike: Dogslicer",
      "Strike: Shortbow",
      "Take Cover",
      "Demoralize",
      "End Turn"
    ]
  },
  "pcs": [
    {
      "id": "pc_seren",
      "name": "Seren",
      "team": "party",
      "hp": {
        "current": 3,
        "max": 18
      },
      "ac": 17,
      "position": {
        "x": 8,
        "y": 6
      },
      "conditions": ["wounded 1"],
      "threatAssessment": "wounded high-damage rogue"
    },
    {
      "id": "pc_brakka",
      "name": "Brakka",
      "team": "party",
      "hp": {
        "current": 22,
        "max": 22
      },
      "ac": 18,
      "position": {
        "x": 7,
        "y": 7
      },
      "conditions": ["shield raised"],
      "threatAssessment": "durable melee defender"
    }
  ],
  "enemies": [
    {
      "id": "enemy_goblin_2",
      "name": "Goblin Cutter 2",
      "hp": {
        "current": 4,
        "max": 6
      },
      "position": {
        "x": 15,
        "y": 3
      },
      "conditions": []
    },
    {
      "id": "enemy_crawler_1",
      "name": "Gatehouse Crawler",
      "hp": {
        "current": 18,
        "max": 22
      },
      "position": {
        "x": 13,
        "y": 6
      },
      "conditions": ["off-guard"]
    }
  ],
  "terrain": {
    "mapSize": {
      "width": 20,
      "height": 9
    },
    "cellSizeFeet": 5,
    "activePosition": {
      "x": 15,
      "y": 3
    },
    "nearbyFeatures": [
      {
        "type": "cover",
        "name": "broken crate",
        "position": {
          "x": 15,
          "y": 4
        },
        "effect": "standard cover"
      },
      {
        "type": "difficultTerrain",
        "name": "mud",
        "area": "x5 y3 through x5 y5",
        "effect": "movement costs double"
      }
    ],
    "blockedCells": [
      {
        "x": 11,
        "y": 1
      },
      {
        "x": 11,
        "y": 2
      }
    ],
    "lineOfSight": [
      {
        "targetId": "pc_seren",
        "visible": true,
        "rangeFeet": 40,
        "cover": "none"
      },
      {
        "targetId": "pc_brakka",
        "visible": true,
        "rangeFeet": 45,
        "cover": "standard"
      }
    ]
  },
  "objectives": [
    {
      "type": "defeatEnemies",
      "priority": "primary"
    }
  ],
  "strategyProfile": {
    "id": "cowardly_skirmisher",
    "instructions": [
      "avoid melee",
      "use cover",
      "target wounded PCs",
      "retreat if badly wounded"
    ]
  }
}
```

This is the data the LLM uses to plan.

---

## 19.2 State the Planner Must Know

### PC State

The planner needs:

| Field | Why It Matters |
|---|---|
| Current HP / max HP | Target selection, healing, risk |
| AC and saves | Attack choice and spell choice |
| Position | Movement, range, flanking, escape |
| Conditions | Off-guard, prone, frightened, dying, slowed |
| Resources | Spell slots, focus points, consumables |
| Known reactions | Avoiding opportunity attacks or shield blocks |
| Role | Tank, striker, healer, controller |
| Current threat | Which PC is most dangerous or vulnerable |

Example tactical reasoning:

```text
Seren is at 3/18 HP and wounded 1. She is a dangerous rogue but nearly down.
The goblin should shoot Seren if it can do so safely.
```

---

### Enemy/NPC State

The planner needs:

| Field | Why It Matters |
|---|---|
| Current HP / max HP | Preserve wounded allies, focus wounded enemies |
| Position | Formation and tactics |
| Conditions | Exploit off-guard, avoid stunned allies |
| Remaining resources | Breath weapon, spells, reactions |
| Morale | Flee, surrender, press attack |
| Strategy profile | Beast, soldier, coward, boss, assassin |

Example:

```text
The crawler is off-guard and low on HP. It should not expose itself unless it can block the fighter.
```

---

### Terrain State

The planner needs terrain, but not necessarily the whole raw map every turn.

It needs tactical terrain facts:

| Terrain Fact | Why It Matters |
|---|---|
| Walkable cells | Legal movement |
| Blocked cells | Walls, pits, obstacles |
| Difficult terrain | Movement cost |
| Cover | Defensive positioning |
| Line of sight | Legal ranged attacks/spells |
| Chokepoints | Tanking and blocking |
| Hazards | Avoid or push enemies into them |
| Doors/objects | Interact actions |
| Elevation | Range, cover, advantage-like effects if ruleset supports it |
| Objective zones | Escape, ritual, rescue, hold area |

Example:

```text
The mud makes a direct charge costly.
The goblin should stay behind the crate instead of crossing open ground.
```

---

### Initiative and Turn State

The planner needs:

| Field | Why It Matters |
|---|---|
| Current round | Duration effects, urgency |
| Current active combatant | Whose turn it is |
| Initiative order | Who acts next |
| Actions remaining | PF2e planning |
| Reactions remaining | Defensive/offensive triggers |
| MAP | Attack sequencing |
| Delayed/readied status | Turn manipulation |
| End-of-turn effects | Persistent damage, frightened reduction |

Example:

```text
Brakka acts immediately after the goblin, so ending adjacent to Brakka is dangerous.
The goblin should Step away or Take Cover.
```

---

### Resource State

The planner needs to know what is still available.

Examples:

| Resource | Why It Matters |
|---|---|
| Spell slots | Cannot cast spent spells |
| Prepared spells | Determines legal spell choices |
| Focus points | Limits focus spells |
| Consumables | Potions, bombs, scrolls |
| Ammunition | Optional, if tracked |
| Breath weapons | Recharge or cooldown |
| Reactions | Attack of Opportunity, Shield Block |
| Once-per-day powers | Cannot reuse after spent |

Example:

```text
The wizard has already used Fireball.
Do not propose Fireball again unless another use remains.
```

---

## 19.3 State the LLM Should Not Track Internally

The LLM should not be expected to remember:

```text
Seren had 7 HP three turns ago and took 4 damage.
Therefore she now has 3 HP.
```

That is fragile.

Instead:

```text
Engine/VTT calculates Seren HP = 3.
Planner receives Seren HP = 3.
Planner acts on that.
```

The LLM can remember strategic lessons across runs, but not authoritative combat state.

Good long-term memory:

```text
In this scenario, goblins lose when they charge through mud.
Try ranged cover tactics in the next run.
```

Bad long-term memory:

```text
Goblin 2 has exactly 4 HP right now.
```

---

## 19.4 State Ownership Rule

Use this rule:

```text
The engine owns truth.
The VTT displays and may also own truth in VTT mode.
The LLM receives truth.
The LLM does not store truth.
```

In local simulator mode:

```text
Our simulator owns all state.
```

In VTT mode:

```text
The VTT owns visible combat state.
Our app mirrors it, validates against it, and persists a structured log.
```

In hybrid mode:

```text
Read state from VTT.
Normalize state into tactical snapshot.
Ask LLM for action.
Validate action.
Write action to VTT.
Read VTT state again.
Reconcile and log.
```

---

# 20. Updated Per-Turn Flow With State Snapshot

Every participant turn should work like this:

```text
1. Read authoritative state.
   - Local mode: read simulator state.
   - VTT mode: read VTT scene/combat/actor state.

2. Normalize into tactical snapshot.
   - PCs
   - Enemies
   - NPCs
   - Terrain
   - Initiative
   - Actions
   - Resources
   - Conditions
   - Objectives

3. Ask LLM for action plan.
   - The LLM receives only current known state.
   - The LLM returns structured JSON.

4. Validate the action plan.
   - Check movement.
   - Check range.
   - Check actions remaining.
   - Check resources.
   - Check conditions.
   - Check targeting.
   - Check rules.

5. Resolve or execute actions.
   - Local mode: simulator rolls and applies results.
   - VTT mode: send commands to VTT or trigger VTT rolls.

6. Read state again.
   - Confirm HP, position, effects, initiative.

7. Persist structured event log.
   - Proposed action
   - Validated action
   - Dice math
   - State before
   - State after
   - Narration
   - Any reconciliation notes

8. Advance turn.
```

This means the LLM is always planning from fresh state.

---

# 21. Updated Comparison: Existing VTT API Implication

If using an existing VTT, the VTT may already know:

- Where tokens are
- Current HP
- Conditions
- Initiative
- Actor sheets
- Spell slots
- Active effects
- Walls and line of sight

But our planner still needs that information copied into a tactical snapshot.

So the VTT having the data does not remove the need to send state to the LLM.

It only changes who owns the authoritative state.

Instead of:

```text
Our database → LLM
```

the flow becomes:

```text
VTT API → normalized snapshot → LLM
```

The LLM still needs to know the state to make decisions, but it should not maintain the state.

---

# 22. Practical State Contract

For every turn, the simulator should guarantee this contract:

```ts
interface TacticalSnapshot {
  ruleset: string;
  round: number;
  activeCombatantId: string;

  initiative: InitiativeState;

  active: TacticalCombatant;

  pcs: TacticalCombatant[];
  enemies: TacticalCombatant[];
  npcs: TacticalCombatant[];

  terrain: TacticalTerrainState;

  visibleTargets: TacticalTarget[];
  availableActions: TacticalActionOption[];

  objectives: TacticalObjective[];

  strategyProfile?: StrategyProfile;
  previousRunLessons?: string[];
}
```

The LLM should only be allowed to choose from `availableActions`.

The validator should only accept actions that are legal under the authoritative state.

---

# 23. Final Clarification

So the answer is:

> Yes, the planner needs PC state, enemy state, terrain state, initiative state, and action/resource state to plan moves.

But:

> No, the LLM should not be responsible for tracking those things over time.

The correct design is:

```text
Stateful engine/VTT
   ↓
Fresh tactical snapshot
   ↓
Stateless LLM planning
   ↓
Rules validation
   ↓
State update
   ↓
Repeat
```

This keeps the AI useful without letting it hallucinate combat state.
