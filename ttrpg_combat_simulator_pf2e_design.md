# TTRPG Combat Simulator Design
## Starting Ruleset: Pathfinder Second Edition

> **Superseded for V1 implementation:** see [`ttrpg_combat_simulator_design_docs/v1_cli_round_output.md`](ttrpg_combat_simulator_design_docs/v1_cli_round_output.md) and the runnable package [`combat-simulator/`](combat-simulator/). Primary sample encounter: `examples/classic-four-vs-goblins.json`.

---

This document describes a combat simulator that can load a TTRPG encounter from JSON, render a grid-based battlefield, run initiative, move tokens across terrain, validate actions against rules, and use an LLM decision layer to choose tactics and narrate play.

The first ruleset target is **Pathfinder Second Edition** because PF2e has clean tactical math, a consistent three-action economy, clear conditions, standardized monster math, and strong encounter-balancing assumptions.

The long-term goal is ruleset portability: a VTT, campaign manager, or adventure authoring tool can offload an encounter to the simulator, run it manually or automatically, and persist every simulation run.

---

# 1. Core Idea

The simulator receives an encounter package:

```json
{
  "ruleset": "pf2e",
  "scenarioId": "marsh-village-gatehouse",
  "scenarioVersion": "1.0.0",
  "party": [],
  "enemies": [],
  "npcs": [],
  "map": {},
  "simulationOptions": {}
}
```

It then:

1. Loads all combatants.
2. Loads the grid map.
3. Places tokens.
4. Rolls or imports initiative.
5. Displays:
   - Initiative panel
   - PC panel
   - Enemy/NPC panel
   - Map panel
   - Combat log panel
6. Runs combat in either:
   - Manual mode
   - Auto mode
   - Hybrid mode
7. Uses an LLM tactical layer to propose actions.
8. Uses a rules validation layer to approve, reject, or revise actions.
9. Applies validated effects.
10. Tracks all state changes.
11. Persists the full simulation run.
12. Groups similar simulation runs under a shared parent scenario node.

---

# 2. Main Design Goals

## 2.1 Rules-Accurate Enough to Be Useful

The simulator should not rely on the LLM to enforce rules.

The LLM may propose:

> The goblin strides behind the crate, raises its shortbow, and fires at the wounded rogue.

But the rules layer must verify:

- Does the goblin have enough actions?
- Can it reach the crate?
- Is the crate passable terrain?
- Does the shortbow have line of sight?
- Is the target within range?
- Does the goblin have ammunition, if tracked?
- Is the target hidden, concealed, prone, shielded, frightened, or otherwise affected?
- What MAP applies?
- What degree of success occurs?
- What damage applies?
- Does resistance, weakness, immunity, or condition logic alter the result?

The LLM is the **tactical/narrative brain**.

The simulator engine is the **rules and state authority**.

---

## 2.2 Replayable Simulations

The same scenario may be simulated many times.

Example:

```text
Scenario: Gatehouse Crawlers vs Level 1 Party
Run 1: Goblins rush the cleric.
Run 2: Goblins kite the fighter.
Run 3: Goblins focus fire the rogue.
Run 4: AI tries defensive choke-point tactics.
```

If the input variables are identical, all runs are grouped under the same parent scenario.

If core variables change, the simulator creates a new scenario branch.

Examples of changes that create a new branch:

- More enemies
- Fewer PCs
- Different map
- Different starting positions
- Modified terrain
- Different ruleset
- Different character stats
- Different starting HP
- Different loaded resources
- Different AI strategy profile

---

# 3. Major Components

## 3.1 Encounter Loader

Responsible for reading the JSON encounter file.

Responsibilities:

- Validate JSON shape.
- Confirm ruleset.
- Normalize character/enemy formats.
- Load map data.
- Assign token IDs.
- Initialize transient combat state.
- Preserve imported damage and resource usage.

Example:

```json
{
  "id": "pc_rogue_001",
  "name": "Seren",
  "type": "pc",
  "level": 1,
  "hp": {
    "max": 18,
    "current": 11,
    "temporary": 0
  },
  "ac": 17,
  "perception": 5,
  "saves": {
    "fortitude": 4,
    "reflex": 7,
    "will": 5
  },
  "speed": 25,
  "position": {
    "x": 3,
    "y": 5
  }
}
```

Important point:

Characters are loaded **as-is**. If a PC is already wounded, missing spell slots, poisoned, frightened, or carrying persistent damage, that is part of the imported state.

---

## 3.2 Ruleset Adapter

The ruleset adapter abstracts PF2e from the core simulator.

The simulator should not hardcode every PF2e rule directly into the core engine. Instead:

```text
Core Engine
  └── Ruleset Adapter
        └── PF2e Adapter
```

Future adapters might include:

- D&D 5e
- D&D 3.5
- Pathfinder 1e
- OSR systems
- Savage Worlds
- Custom AMBA rules
- Board-game-style tactical engines

The adapter defines:

```ts
interface RulesetAdapter {
  calculateInitiative(combatant, encounterState): InitiativeResult;
  getAvailableActions(combatant, encounterState): ActionOption[];
  validateAction(action, encounterState): ValidationResult;
  resolveAction(action, encounterState): ResolutionResult;
  applyEffects(result, encounterState): EncounterState;
  checkEndCondition(encounterState): CombatEndState;
}
```

---

## 3.3 Map Layer

The simulator uses its own internal map representation.

This is important because different sources may export different map formats:

- ASCII map
- Markdown map
- VTT JSON
- Foundry scene export
- Roll20 map data
- Owlbear-style data
- Inkarnate/manual grid maps
- AMBA scene maps

The simulator needs a **translation layer**.

```text
External Map Format
        ↓
Map Import Adapter
        ↓
Simulator Map Model
        ↓
Renderer
```

The internal map model should be stable even if external formats change.

---

# 4. ASCII / Markdown Map Format

Each square is 5 feet.

Example map:

```text
####################
#....P.....#.......#
#..........#...G...#
#....~.....#.......#
#....~.............#
#....~.....#####...#
#..........#.......#
#.....R....#...C...#
####################
```

Legend:

| Symbol | Meaning |
|---|---|
| `#` | Wall / blocking terrain |
| `.` | Normal floor |
| `~` | Difficult terrain |
| `^` | Hazard |
| `D` | Door |
| `C` | Cover / crate |
| `P` | PC token |
| `G` | Goblin token |
| `R` | Rogue token |
| `@` | Selected active token |
| `x` | Dead/unconscious token |

However, token display should be separated from terrain storage.

Bad internal model:

```text
Map tile is "P"
```

Better internal model:

```json
{
  "terrain": ".",
  "tokens": ["pc_seren"]
}
```

This allows a token to stand on floor, difficult terrain, cover, trap, bridge, stairs, and so on.

---

## 4.1 Internal Map Model

```json
{
  "width": 20,
  "height": 9,
  "cellSizeFeet": 5,
  "terrainLegend": {
    "#": {
      "name": "Stone Wall",
      "blocksMovement": true,
      "blocksLineOfSight": true
    },
    ".": {
      "name": "Open Ground",
      "blocksMovement": false,
      "blocksLineOfSight": false
    },
    "~": {
      "name": "Mud",
      "blocksMovement": false,
      "blocksLineOfSight": false,
      "movementMultiplier": 2
    },
    "C": {
      "name": "Crate",
      "blocksMovement": false,
      "blocksLineOfSight": false,
      "providesCover": "standard"
    }
  },
  "rows": [
    "####################",
    "#..........#.......#",
    "#..........#.......#",
    "#....~.....#.......#",
    "#....~.............#",
    "#....~.....#####...#",
    "#..........#.......#",
    "#..........#.......#",
    "####################"
  ]
}
```

Tokens are stored separately:

```json
{
  "tokens": [
    {
      "id": "pc_fighter",
      "display": "F",
      "name": "Brakka",
      "team": "party",
      "x": 5,
      "y": 2
    },
    {
      "id": "enemy_goblin_1",
      "display": "g",
      "name": "Goblin Cutter",
      "team": "enemy",
      "x": 14,
      "y": 2
    }
  ]
}
```

---

# 5. Combatant JSON

A combatant should include permanent stats, current state, and available resources.

## 5.1 PC Example

```json
{
  "id": "pc_seren",
  "name": "Seren",
  "type": "pc",
  "ancestry": "elf",
  "class": "rogue",
  "level": 1,
  "team": "party",
  "token": {
    "display": "R",
    "size": "medium",
    "position": {
      "x": 4,
      "y": 6
    }
  },
  "hp": {
    "max": 18,
    "current": 11,
    "temporary": 0
  },
  "ac": 17,
  "perception": 5,
  "saves": {
    "fortitude": 4,
    "reflex": 7,
    "will": 5
  },
  "speed": 30,
  "abilities": {
    "str": 0,
    "dex": 4,
    "con": 1,
    "int": 1,
    "wis": 2,
    "cha": 0
  },
  "skills": {
    "stealth": 7,
    "acrobatics": 7,
    "athletics": 3,
    "deception": 3
  },
  "attacks": [
    {
      "id": "rapier",
      "name": "Rapier",
      "type": "melee",
      "attackBonus": 7,
      "damage": "1d6+4",
      "damageType": "piercing",
      "traits": ["deadly d8", "disarm", "finesse"]
    },
    {
      "id": "shortbow",
      "name": "Shortbow",
      "type": "ranged",
      "attackBonus": 7,
      "damage": "1d6",
      "damageType": "piercing",
      "rangeIncrement": 60,
      "traits": ["deadly d10"]
    }
  ],
  "features": [
    {
      "id": "sneak_attack",
      "name": "Sneak Attack",
      "damage": "1d6",
      "conditions": ["targetOffGuard"]
    }
  ],
  "resources": {
    "heroPoints": 1,
    "reactions": {
      "max": 1,
      "current": 1
    }
  },
  "conditions": [],
  "notes": "Loaded damaged from prior encounter."
}
```

---

## 5.2 Enemy Example

```json
{
  "id": "enemy_goblin_1",
  "name": "Goblin Cutter",
  "type": "enemy",
  "level": -1,
  "team": "enemy",
  "token": {
    "display": "g",
    "size": "small",
    "position": {
      "x": 14,
      "y": 2
    }
  },
  "hp": {
    "max": 6,
    "current": 6,
    "temporary": 0
  },
  "ac": 16,
  "perception": 2,
  "saves": {
    "fortitude": 5,
    "reflex": 7,
    "will": 3
  },
  "speed": 25,
  "attacks": [
    {
      "id": "dogslicer",
      "name": "Dogslicer",
      "type": "melee",
      "attackBonus": 8,
      "damage": "1d6+2",
      "damageType": "slashing",
      "traits": ["agile", "backstabber", "finesse"]
    },
    {
      "id": "shortbow",
      "name": "Shortbow",
      "type": "ranged",
      "attackBonus": 8,
      "damage": "1d6",
      "damageType": "piercing",
      "rangeIncrement": 60
    }
  ],
  "resources": {},
  "conditions": []
}
```

---

# 6. PF2e Combat Model

PF2e is a strong first ruleset because the core action loop is predictable.

Each combatant gets:

- 3 actions on its turn
- 1 reaction per round
- Free actions as permitted
- Multiple Attack Penalty tracking
- Conditions
- Precise degrees of success

---

## 6.1 Turn State

Each turn should track:

```json
{
  "round": 2,
  "activeCombatantId": "pc_seren",
  "actionsRemaining": 3,
  "reactionAvailable": true,
  "multipleAttackPenalty": 0,
  "turnFlags": {
    "hasMoved": false,
    "hasAttacked": false,
    "usedInteract": false
  }
}
```

---

## 6.2 Common PF2e Actions

Initial implementation should support:

| Action | Cost | Notes |
|---|---:|---|
| Stride | 1 | Move up to Speed |
| Step | 1 | Move 5 ft without triggering reactions |
| Strike | 1 | Attack with weapon |
| Cast a Spell | 1-3 | Depends on spell |
| Raise a Shield | 1 | Shield bonus until next turn |
| Take Cover | 1 | Improve cover |
| Seek | 1 | Perception check |
| Demoralize | 1 | Intimidation vs Will DC |
| Feint | 1 | Deception vs Perception DC |
| Recall Knowledge | 1 | Skill check |
| Interact | 1 | Draw item, open door, etc. |
| Ready | 2 | Prepare a reaction |
| Delay | free | Change initiative timing |

Start with the minimum useful set:

1. Stride
2. Step
3. Strike
4. Cast Spell
5. Raise Shield
6. Demoralize
7. Interact
8. End Turn

---

## 6.3 Multiple Attack Penalty

PF2e applies MAP after attacks.

Typical penalties:

| Attack Number | Normal | Agile |
|---|---:|---:|
| First attack | 0 | 0 |
| Second attack | -5 | -4 |
| Third attack | -10 | -8 |

The rules layer must track this per turn.

Example combat log:

```text
Seren uses Strike with Rapier against Goblin Cutter.
Attack roll: d20 13 + attack bonus 7 + MAP 0 = 20.
Target AC: 16.
Result: Hit.

Damage roll: 1d6+4 piercing.
Rolled 5 + 4 = 9 piercing damage.
Goblin Cutter HP: 6 → 0.
Goblin Cutter falls, clutching its split leather jerkin as Seren twists the blade free.
```

---

## 6.4 Degrees of Success

PF2e has four result bands:

| Result | Rule |
|---|---|
| Critical Success | Total >= DC + 10 |
| Success | Total >= DC |
| Failure | Total < DC |
| Critical Failure | Total <= DC - 10 |

Natural 20 improves the degree by one step.

Natural 1 worsens the degree by one step.

Example:

```text
Attack roll: d20 20 + 4 = 24 vs AC 15.
Base result: Success.
Natural 20 improves result to Critical Success.
Damage is doubled.
```

---

# 7. Conditions and Status Tracking

Conditions are part of the simulation state, not just narrative.

Example condition:

```json
{
  "id": "frightened",
  "value": 1,
  "source": "goblin_war_chant",
  "expires": {
    "timing": "endOfTurn",
    "combatantId": "pc_seren"
  }
}
```

Useful initial conditions:

| Condition | Needed For Early Version? |
|---|---|
| Dying | Yes |
| Wounded | Yes |
| Unconscious | Yes |
| Off-Guard | Yes |
| Prone | Yes |
| Frightened | Yes |
| Clumsy | Soon |
| Enfeebled | Soon |
| Stunned | Soon |
| Slowed | Soon |
| Immobilized | Soon |
| Grabbed | Soon |
| Persistent Damage | Soon |
| Concealed | Later |
| Hidden | Later |
| Invisible | Later |

---

## 7.1 Resource Tracking

Resources must be consumed and unavailable after use.

Example spell slot state:

```json
{
  "spellcasting": {
    "tradition": "arcane",
    "spellAttack": 7,
    "spellDC": 17,
    "slots": {
      "rank1": {
        "max": 2,
        "current": 1
      }
    },
    "preparedSpells": [
      {
        "id": "fireball",
        "name": "Fireball",
        "rank": 3,
        "prepared": 1,
        "remaining": 1
      }
    ]
  }
}
```

If the wizard casts Fireball:

```json
{
  "preparedSpells": [
    {
      "id": "fireball",
      "name": "Fireball",
      "rank": 3,
      "prepared": 1,
      "remaining": 0
    }
  ]
}
```

The validation layer must reject:

```text
Cast Fireball
```

if:

```text
remaining = 0
```

The LLM may propose it, but the rules layer must say:

```json
{
  "valid": false,
  "reason": "Fireball is not available. Remaining prepared uses: 0."
}
```

Then the simulator can ask the LLM for a revised action.

---

# 8. LLM Tactical Layer

The LLM should not receive the entire rules database every turn.

Instead, it receives a compact tactical prompt:

```json
{
  "ruleset": "pf2e",
  "round": 2,
  "active": {
    "id": "enemy_goblin_1",
    "name": "Goblin Cutter",
    "team": "enemy",
    "hp": "3/6",
    "conditions": [],
    "actionsRemaining": 3,
    "position": { "x": 14, "y": 2 }
  },
  "visibleEnemies": [
    {
      "id": "pc_seren",
      "name": "Seren",
      "hp": "11/18",
      "ac": 17,
      "position": { "x": 4, "y": 6 },
      "estimatedThreat": "wounded striker"
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
    "nearestCover": "crate at x16 y7",
    "nearestEnemyDistanceFeet": 55,
    "terrainNotes": ["mud at x5 y3 through x5 y5"]
  },
  "strategyProfile": {
    "style": "cowardly skirmisher",
    "priority": "avoid melee, target wounded PCs"
  }
}
```

The LLM returns structured intent:

```json
{
  "intent": "Skirmish from range and avoid melee.",
  "actions": [
    {
      "type": "Stride",
      "destination": { "x": 16, "y": 3 }
    },
    {
      "type": "Strike",
      "attackId": "shortbow",
      "targetId": "pc_seren"
    },
    {
      "type": "TakeCover"
    }
  ],
  "narrationStyle": "high narrative"
}
```

The simulator then validates each action.

---

# 9. Rules Validation Layer

The validation layer receives proposed actions and checks them.

Example:

```json
{
  "combatantId": "enemy_goblin_1",
  "actions": [
    {
      "type": "Stride",
      "destination": { "x": 16, "y": 3 }
    },
    {
      "type": "Strike",
      "attackId": "shortbow",
      "targetId": "pc_seren"
    }
  ]
}
```

Validation checks:

- Active combatant matches initiative turn.
- Action count is available.
- Movement path is legal.
- Destination is legal.
- Token does not pass through walls.
- Speed is sufficient.
- Action is known to the ruleset.
- Attack exists on the combatant sheet.
- Target is visible/reachable.
- Range is valid.
- MAP is applied.
- Resource exists.
- Resource is not depleted.
- Conditions do not prevent the action.
- Triggered reactions are detected.
- Result can be resolved.

Validation output:

```json
{
  "valid": true,
  "validatedActions": [
    {
      "type": "Stride",
      "cost": 1,
      "path": [
        { "x": 14, "y": 2 },
        { "x": 15, "y": 2 },
        { "x": 16, "y": 2 },
        { "x": 16, "y": 3 }
      ]
    },
    {
      "type": "Strike",
      "cost": 1,
      "attackId": "shortbow",
      "targetId": "pc_seren",
      "rangeFeet": 60,
      "mapPenalty": 0
    }
  ]
}
```

If invalid:

```json
{
  "valid": false,
  "invalidActionIndex": 1,
  "reason": "Target is beyond the first range increment. Apply range penalty or choose another target.",
  "suggestedCorrections": [
    "Apply -2 range increment penalty.",
    "Move closer before attacking.",
    "Choose target pc_fighter instead."
  ]
}
```

---

# 10. Dice and Math Transparency

Every dice roll should be fully logged.

Bad log:

```text
Goblin hits Seren for 5 damage.
```

Good log:

```text
Goblin Cutter fires its shortbow at Seren.

Attack roll:
d20 = 13
Shortbow attack bonus = +8
Multiple Attack Penalty = 0
Range penalty = 0
Total = 21

Seren AC = 17
21 beats AC 17 by 4.
Result: Hit.

Damage:
1d6 piercing = 4
Total damage = 4 piercing.

Seren HP: 11 → 7.

Narration:
The goblin ducks beside the splintered crate and looses a black-fletched arrow. It slips under Seren's raised arm and bites into her side, forcing her back a step as blood darkens her tunic.
```

All rolls should include:

- Die expression
- Raw die result
- Modifiers
- DC or AC
- Final total
- Degree of success
- Damage calculation
- HP or condition changes
- Narrative result

---

# 11. UI Layout

Initial UI can be terminal, web, or markdown-driven.

A web UI is ideal, but terminal mode is enough for early simulation.

## 11.1 Suggested Web Layout

```text
+---------------------------------------------------------------+
| Encounter: Gatehouse Crawler Ambush     Round: 2   Mode: Auto |
+----------------------+----------------------+-----------------+
| Initiative           | Combatants           | Action Controls |
|----------------------|----------------------|-----------------|
| > Seren          24   | PCs                  | [Auto] [Manual] |
|   Goblin 1       19   | Seren  7/18 HP       | [Next Turn]     |
|   Brakka         14   | Brakka 22/22 HP      | [Pause]         |
|   Goblin 2       12   |                      | [Rerun Sim]     |
|   Crawler         8   | Enemies              |                 |
|                      | Goblin 1  6/6 HP     |                 |
|                      | Goblin 2  2/6 HP     |                 |
+----------------------+----------------------+-----------------+
| Map                                                           |
| ############################################################# |
| #....R........#........g.....................................# |
| #.............#..............................................# |
| #....~.................C.....................................# |
| #....~.......................................................# |
| #....~........#####..........................................# |
| #.............#..............................................# |
| #.....F.......#...g..........................................# |
| ############################################################# |
+---------------------------------------------------------------+
| Combat Log                                                    |
| Seren lunges through the mud...                               |
| Attack: d20 13 + 7 = 20 vs AC 16. Hit.                       |
| Damage: 1d6+4 = 5+4 = 9. Goblin 1 drops to 0 HP.             |
+---------------------------------------------------------------+
```

---

## 11.2 Panels

### Initiative Panel

Shows turn order.

```text
ROUND 2

> Seren               24
  Goblin Cutter 1     19
  Brakka              14
  Goblin Cutter 2     12
  Gatehouse Crawler    8
```

Use visual indicators:

| Marker | Meaning |
|---|---|
| `>` | Active turn |
| `✓` | Turn complete |
| `!` | Bloodied / low HP |
| `☠` | Dead |
| `⧖` | Delayed |
| `⚑` | Readied action |

---

### Combatant Panel

```text
PCs
Seren          HP 7/18    AC 17    Conditions: wounded 1
Brakka         HP 22/22   AC 18    Conditions: shield raised

Enemies
Goblin 1       HP 0/6     AC 16    Conditions: unconscious
Goblin 2       HP 2/6     AC 16    Conditions: frightened 1
Crawler        HP 17/22   AC 15    Conditions: none
```

---

### Map Panel

Rendered map should overlay token display onto terrain.

Example:

```text
    01234567890123456789
00  ####################
01  #....R.....#.......#
02  #..........#...g...#
03  #....~.....#.......#
04  #....~.............#
05  #....~.....#####...#
06  #..........#.......#
07  #.....F....#...c...#
08  ####################
```

---

### Combat Log Panel

The combat log should be both readable and exportable.

Each event should be stored structurally:

```json
{
  "round": 2,
  "turn": 5,
  "combatantId": "pc_seren",
  "eventType": "actionResolved",
  "action": "Strike",
  "targetId": "enemy_goblin_1",
  "rolls": [
    {
      "type": "attack",
      "formula": "1d20+7",
      "d20": 13,
      "modifiers": [
        { "name": "Rapier attack bonus", "value": 7 },
        { "name": "MAP", "value": 0 }
      ],
      "total": 20,
      "dc": 16,
      "degree": "success"
    },
    {
      "type": "damage",
      "formula": "1d6+4",
      "dice": [5],
      "modifiers": [
        { "name": "Dexterity", "value": 4 }
      ],
      "total": 9
    }
  ],
  "stateChanges": [
    {
      "targetId": "enemy_goblin_1",
      "field": "hp.current",
      "before": 6,
      "after": 0
    }
  ],
  "narration": "Seren lunges through the mud..."
}
```

Then render it as narrative text.

---

# 12. Manual, Auto, and Hybrid Modes

## 12.1 Manual Mode

Manual mode stops at each participant.

Flow:

```text
Round 1
Initiative: Seren

Press Enter to generate Seren's proposed action...
```

Then:

```text
Seren proposes:
1. Stride to x6 y4
2. Strike Goblin Cutter with Rapier
3. Step back to x5 y4

Press Enter to validate...
```

Then:

```text
Validation passed.

Press Enter to resolve...
```

Then the action resolves and is logged.

Manual mode is useful for debugging and for using the simulator as a GM assistant.

---

## 12.2 Auto Mode

Auto mode runs continuously until:

- One side wins.
- The round limit is reached.
- The simulator hits a validation failure it cannot repair.
- The user pauses.
- A special scenario objective is completed.

Auto mode should still log every action.

---

## 12.3 Hybrid Mode

Hybrid mode can allow:

- Manual PCs, auto enemies.
- Auto PCs, manual boss.
- Manual decision approval, auto dice.
- Auto tactics, manual narration.
- Auto movement, manual spell choices.

Useful setting:

```json
{
  "mode": "hybrid",
  "control": {
    "party": "manual",
    "enemies": "auto",
    "npcs": "auto"
  }
}
```

---

# 13. Strategy Profiles

The simulator should support tactical personality and strategy.

Example profiles:

```json
{
  "strategyProfile": {
    "id": "cowardly_skirmisher",
    "description": "Avoid melee, use cover, target wounded enemies, flee when below 30% HP.",
    "priorities": [
      "survive",
      "stay at range",
      "use cover",
      "focus wounded targets",
      "avoid opportunity attacks"
    ],
    "riskTolerance": "low"
  }
}
```

Other profiles:

| Profile | Behavior |
|---|---|
| reckless_brute | Charges nearest target and attacks repeatedly |
| disciplined_soldier | Holds formation, protects allies, uses chokepoints |
| cowardly_skirmisher | Uses cover and ranged attacks |
| assassin | Focuses wounded or isolated targets |
| defender | Protects leader or objective |
| beast | Attacks nearest visible target |
| spellcaster_control | Uses control spells before damage |
| boss_adaptive | Changes behavior after taking damage |

---

# 14. Adaptive Re-Runs

If the same scenario is run multiple times, the AI can change its strategy.

Example:

```json
{
  "scenarioHash": "abc123",
  "runNumber": 4,
  "previousRunSummaries": [
    {
      "runId": "run_001",
      "winner": "party",
      "rounds": 3,
      "enemyMistake": "Goblins entered melee too early."
    },
    {
      "runId": "run_002",
      "winner": "party",
      "rounds": 5,
      "enemyMistake": "Crawler failed to block choke point."
    }
  ],
  "adaptiveInstruction": "Try a new enemy strategy that addresses prior failures."
}
```

The LLM can then choose:

```text
This time, the goblins will stay behind cover while the crawler blocks the narrow passage.
```

The rules engine still validates every move.

---

# 15. Persistence Model

Use a database or file store.

Good early options:

- SQLite
- Postgres
- JSONL files
- Event-sourced log files

For Node or Python, SQLite is excellent for a prototype.

---

## 15.1 Scenario Parent Node

A scenario parent groups equivalent simulations.

```json
{
  "id": "scenario_abc123",
  "name": "Gatehouse Crawler Ambush",
  "ruleset": "pf2e",
  "scenarioHash": "abc123",
  "createdAt": "2026-06-30T10:00:00Z",
  "baseInput": {}
}
```

The `scenarioHash` is generated from normalized core variables:

- Ruleset
- Map
- Combatants
- Starting HP
- Starting resources
- Starting positions
- Encounter objectives
- Simulation options

Do not include:

- Run ID
- Timestamp
- Random seed, unless deterministic replay is desired
- LLM wording
- Combat log

---

## 15.2 Simulation Run

```json
{
  "id": "run_001",
  "scenarioId": "scenario_abc123",
  "runNumber": 1,
  "startedAt": "2026-06-30T10:01:00Z",
  "completedAt": "2026-06-30T10:04:00Z",
  "winner": "party",
  "rounds": 4,
  "endingState": {},
  "summary": {
    "partyDamageTaken": 19,
    "enemyDamageTaken": 44,
    "pcsDowned": 1,
    "enemiesDefeated": 5
  }
}
```

---

## 15.3 Event Log

Each action is stored as an event.

```json
{
  "id": "event_00042",
  "runId": "run_001",
  "round": 2,
  "initiativeIndex": 3,
  "combatantId": "enemy_goblin_2",
  "eventType": "actionResolved",
  "payload": {}
}
```

This makes replay possible.

---

# 16. Suggested Database Schema

## 16.1 SQLite Tables

```sql
CREATE TABLE scenario (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ruleset TEXT NOT NULL,
  scenario_hash TEXT NOT NULL UNIQUE,
  base_input_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE simulation_run (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  run_number INTEGER NOT NULL,
  mode TEXT NOT NULL,
  random_seed TEXT,
  strategy_profile_json TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  winner TEXT,
  rounds INTEGER,
  ending_state_json TEXT,
  summary_json TEXT,
  FOREIGN KEY (scenario_id) REFERENCES scenario(id)
);

CREATE TABLE simulation_event (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_index INTEGER NOT NULL,
  round INTEGER NOT NULL,
  active_combatant_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES simulation_run(id)
);

CREATE INDEX idx_simulation_event_run_id
ON simulation_event(run_id, event_index);
```

---

# 17. Scenario Hashing

The simulator should normalize the input before hashing.

Pseudo-code:

```ts
function createScenarioHash(input: EncounterInput): string {
  const normalized = {
    ruleset: input.ruleset,
    party: sortById(input.party),
    enemies: sortById(input.enemies),
    npcs: sortById(input.npcs ?? []),
    map: normalizeMap(input.map),
    objectives: input.objectives ?? [],
    startingState: extractStartingState(input)
  };

  return sha256(JSON.stringify(normalized));
}
```

Same normalized input means same parent scenario.

Changed input means new parent scenario.

---

# 18. Recommended Project Structure

## 18.1 Node/TypeScript Version

```text
combat-simulator/
  package.json
  tsconfig.json
  src/
    index.ts
    app.ts

    core/
      encounterLoader.ts
      simulationEngine.ts
      initiativeTracker.ts
      turnManager.ts
      stateStore.ts
      eventLog.ts

    map/
      mapModel.ts
      asciiMapParser.ts
      markdownMapParser.ts
      pathfinding.ts
      lineOfSight.ts
      renderer.ts

    rulesets/
      rulesetAdapter.ts
      pf2e/
        pf2eAdapter.ts
        actions.ts
        conditions.ts
        degreesOfSuccess.ts
        damage.ts
        resources.ts

    llm/
      tacticalPromptBuilder.ts
      actionPlanner.ts
      narrationWriter.ts
      repairPrompt.ts

    validation/
      actionValidator.ts
      movementValidator.ts
      resourceValidator.ts
      targetingValidator.ts

    persistence/
      db.ts
      schema.sql
      scenarioRepository.ts
      runRepository.ts
      eventRepository.ts

    ui/
      terminalUi.ts
      webServer.ts
      components/
        InitiativePanel.tsx
        CombatantPanel.tsx
        MapPanel.tsx
        CombatLogPanel.tsx

  examples/
    gatehouse-crawler-ambush.json
```

---

## 18.2 Python Version

```text
combat_simulator/
  pyproject.toml
  combat_simulator/
    __init__.py
    main.py

    core/
      encounter_loader.py
      simulation_engine.py
      initiative_tracker.py
      turn_manager.py
      state_store.py
      event_log.py

    map/
      map_model.py
      ascii_map_parser.py
      markdown_map_parser.py
      pathfinding.py
      line_of_sight.py
      renderer.py

    rulesets/
      adapter.py
      pf2e/
        adapter.py
        actions.py
        conditions.py
        degrees_of_success.py
        damage.py
        resources.py

    llm/
      tactical_prompt_builder.py
      action_planner.py
      narration_writer.py
      repair_prompt.py

    validation/
      action_validator.py
      movement_validator.py
      resource_validator.py
      targeting_validator.py

    persistence/
      db.py
      repositories.py
      schema.sql

    ui/
      terminal_ui.py
      web_server.py

  examples/
    gatehouse_crawler_ambush.json
```

---

# 19. Node vs Python Recommendation

## Node/TypeScript Strengths

Use Node/TypeScript if the simulator will become:

- A web app
- A VTT-like interface
- An AMBA-integrated tool
- A React dashboard
- A service API
- A real-time browser simulation

TypeScript is also excellent for JSON schemas and validation.

Recommended stack:

```text
Node.js
TypeScript
Zod
SQLite or Postgres
Express or Fastify
React
WebSockets
OpenAI/LLM client
```

---

## Python Strengths

Use Python if the simulator will become:

- A research engine
- A batch simulator
- A probability analyzer
- A combat balance tool
- A CLI-first experiment
- A data-science-heavy project

Recommended stack:

```text
Python
Pydantic
SQLite
FastAPI
Rich / Textual
NetworkX or custom pathfinding
OpenAI/LLM client
```

---

## Practical Recommendation

Start in **Node/TypeScript** if this is intended to plug into AMBA, a browser UI, or your existing web stack.

Start in **Python** if the first milestone is batch-running 100 simulations and analyzing outcomes.

For your described use case, the best first build is probably:

```text
Node/TypeScript backend
SQLite persistence
React UI later
Terminal UI first
LLM planner behind an interface
PF2e adapter as first rules module
```

---

# 20. First Milestone

Build the smallest version that proves the idea.

## Milestone 1: Deterministic Tactical Engine

Features:

- Load encounter JSON.
- Parse ASCII map.
- Render map with tokens.
- Roll initiative.
- Run turn order.
- Support Stride.
- Support Strike.
- Track HP.
- Track actions remaining.
- Track MAP.
- End combat when one side is defeated.
- Save simulation run.
- Print detailed combat log.

No spells yet.

No complex conditions yet.

No reactions yet.

No hidden information yet.

No LLM required at first.

Use simple AI:

```text
Move toward nearest enemy.
Strike if adjacent.
Strike again if still alive.
End turn.
```

This proves:

- State management
- Initiative
- Movement
- Dice math
- Damage
- Logging
- Persistence

---

# 21. Second Milestone

Add the LLM tactical layer.

Features:

- LLM receives tactical state.
- LLM proposes actions as JSON.
- Validation layer checks actions.
- Invalid actions are rejected.
- LLM gets one repair attempt.
- Valid actions resolve.
- Narration generated from structured results.

Important rule:

The LLM should not directly mutate state.

Only the rules engine can mutate state.

---

# 22. Third Milestone

Add richer PF2e.

Features:

- Conditions
- Spell resources
- Simple spellcasting
- Cover
- Difficult terrain
- Line of sight
- Range increments
- Reactions
- Dying/wounded recovery
- Persistent damage
- Initiative delay/ready
- Better strategy profiles

---

# 23. Fourth Milestone

Add simulation comparison.

Features:

- Scenario hashing
- Parent scenario grouping
- Multiple runs
- Run summaries
- Strategy variation
- Outcome comparison
- Encounter difficulty analysis

Example output:

```text
Scenario: Gatehouse Crawler Ambush
Runs: 10

Party wins: 8
Enemy wins: 2
Average rounds: 4.3
Average PC damage taken: 21.6
PC downed in 3/10 runs
Most dangerous enemy: Gatehouse Crawler
Most effective strategy: crawler blocks choke point while goblins attack at range
```

---

# 24. Example Full Encounter JSON

```json
{
  "ruleset": "pf2e",
  "scenarioId": "gatehouse-crawler-ambush",
  "scenarioName": "Gatehouse Crawler Ambush",
  "scenarioVersion": "1.0.0",
  "map": {
    "width": 20,
    "height": 9,
    "cellSizeFeet": 5,
    "rows": [
      "####################",
      "#..........#.......#",
      "#..........#.......#",
      "#....~.....#.......#",
      "#....~.............#",
      "#....~.....#####...#",
      "#..........#.......#",
      "#..........#.......#",
      "####################"
    ],
    "terrainLegend": {
      "#": {
        "name": "Stone Wall",
        "blocksMovement": true,
        "blocksLineOfSight": true
      },
      ".": {
        "name": "Open Ground",
        "blocksMovement": false,
        "blocksLineOfSight": false
      },
      "~": {
        "name": "Mud",
        "blocksMovement": false,
        "blocksLineOfSight": false,
        "movementMultiplier": 2
      }
    }
  },
  "combatants": [
    {
      "id": "pc_seren",
      "name": "Seren",
      "type": "pc",
      "team": "party",
      "level": 1,
      "token": {
        "display": "R",
        "size": "medium",
        "position": { "x": 4, "y": 6 }
      },
      "hp": {
        "max": 18,
        "current": 11,
        "temporary": 0
      },
      "ac": 17,
      "perception": 5,
      "saves": {
        "fortitude": 4,
        "reflex": 7,
        "will": 5
      },
      "speed": 30,
      "attacks": [
        {
          "id": "rapier",
          "name": "Rapier",
          "type": "melee",
          "attackBonus": 7,
          "damage": "1d6+4",
          "damageType": "piercing",
          "traits": ["deadly d8", "finesse"]
        }
      ],
      "resources": {
        "heroPoints": 1,
        "reactions": {
          "max": 1,
          "current": 1
        }
      },
      "conditions": []
    },
    {
      "id": "pc_brakka",
      "name": "Brakka",
      "type": "pc",
      "team": "party",
      "level": 1,
      "token": {
        "display": "F",
        "size": "medium",
        "position": { "x": 6, "y": 7 }
      },
      "hp": {
        "max": 22,
        "current": 22,
        "temporary": 0
      },
      "ac": 18,
      "perception": 4,
      "saves": {
        "fortitude": 7,
        "reflex": 3,
        "will": 4
      },
      "speed": 25,
      "attacks": [
        {
          "id": "longsword",
          "name": "Longsword",
          "type": "melee",
          "attackBonus": 7,
          "damage": "1d8+4",
          "damageType": "slashing",
          "traits": ["versatile p"]
        }
      ],
      "resources": {
        "reactions": {
          "max": 1,
          "current": 1
        }
      },
      "conditions": []
    },
    {
      "id": "enemy_goblin_1",
      "name": "Goblin Cutter 1",
      "type": "enemy",
      "team": "enemy",
      "level": -1,
      "token": {
        "display": "g",
        "size": "small",
        "position": { "x": 15, "y": 2 }
      },
      "hp": {
        "max": 6,
        "current": 6,
        "temporary": 0
      },
      "ac": 16,
      "perception": 2,
      "saves": {
        "fortitude": 5,
        "reflex": 7,
        "will": 3
      },
      "speed": 25,
      "attacks": [
        {
          "id": "dogslicer",
          "name": "Dogslicer",
          "type": "melee",
          "attackBonus": 8,
          "damage": "1d6+2",
          "damageType": "slashing",
          "traits": ["agile", "backstabber", "finesse"]
        },
        {
          "id": "shortbow",
          "name": "Shortbow",
          "type": "ranged",
          "attackBonus": 8,
          "damage": "1d6",
          "damageType": "piercing",
          "rangeIncrement": 60
        }
      ],
      "resources": {},
      "conditions": [],
      "strategyProfile": "cowardly_skirmisher"
    },
    {
      "id": "enemy_crawler_1",
      "name": "Gatehouse Crawler",
      "type": "enemy",
      "team": "enemy",
      "level": 0,
      "token": {
        "display": "c",
        "size": "medium",
        "position": { "x": 16, "y": 7 }
      },
      "hp": {
        "max": 22,
        "current": 22,
        "temporary": 0
      },
      "ac": 15,
      "perception": 4,
      "saves": {
        "fortitude": 7,
        "reflex": 4,
        "will": 2
      },
      "speed": 20,
      "attacks": [
        {
          "id": "mandibles",
          "name": "Mandibles",
          "type": "melee",
          "attackBonus": 6,
          "damage": "1d8+3",
          "damageType": "piercing",
          "traits": []
        }
      ],
      "resources": {},
      "conditions": [],
      "strategyProfile": "beast"
    }
  ],
  "simulationOptions": {
    "mode": "manual",
    "maxRounds": 10,
    "narration": "high",
    "diceMode": "random",
    "saveRun": true
  }
}
```

---

# 25. Example Combat Log

```text
ROUND 1

Initiative:
Seren rolls Perception: d20 17 + 5 = 22.
Goblin Cutter 1 rolls Perception: d20 14 + 2 = 16.
Brakka rolls Perception: d20 9 + 4 = 13.
Gatehouse Crawler rolls Perception: d20 6 + 4 = 10.

Turn order:
1. Seren — 22
2. Goblin Cutter 1 — 16
3. Brakka — 13
4. Gatehouse Crawler — 10

Seren begins her turn with 3 actions.

Action 1: Stride.
Seren moves from x4 y6 to x8 y6, boots splashing through cold mud and broken straw.
Distance moved: 20 feet.
Actions remaining: 2.

Action 2: Strike with Rapier against Goblin Cutter 1.
Range: adjacent.
Attack roll:
d20 = 13
Rapier attack bonus = +7
Multiple Attack Penalty = 0
Total = 20

Goblin Cutter 1 AC = 16.
20 beats AC 16 by 4.
Result: Hit.

Damage:
1d6+4 piercing.
d6 = 5
Dexterity bonus = +4
Total = 9 piercing.

Goblin Cutter 1 HP: 6 → 0.

The goblin's grin vanishes as Seren drives the rapier clean through its patched armor. It folds backward against the damp stone, its dogslicer clattering uselessly into the mud.

Action 3: Seek.
No hidden enemies detected.
Actions remaining: 0.

Seren ends her turn.
```

---

# 26. Action Resolution Pipeline

Every turn should follow this pipeline:

```text
Start Turn
  ↓
Refresh turn state
  ↓
Build tactical state
  ↓
Get action proposal
  ↓
Validate proposal
  ↓
Repair if invalid
  ↓
Resolve action 1
  ↓
Apply state changes
  ↓
Log event
  ↓
Resolve action 2
  ↓
Apply state changes
  ↓
Log event
  ↓
Resolve action 3
  ↓
Apply state changes
  ↓
Log event
  ↓
End turn effects
  ↓
Check victory
  ↓
Advance initiative
```

---

# 27. LLM Safety Rails

The LLM should be constrained to JSON output.

It should not be allowed to say:

```text
The goblin teleports behind the wizard.
```

unless the goblin has that ability.

Prompt rule:

```text
You are choosing tactics only from the available action list.
Return only JSON.
Do not invent actions, abilities, spells, movement modes, or conditions.
If no useful action is available, choose EndTurn.
```

The validation layer still assumes the LLM may be wrong.

---

# 28. Validation Repair Loop

If the LLM proposes an invalid move:

```json
{
  "type": "Stride",
  "destination": { "x": 4, "y": 1 }
}
```

But x4 y1 is behind a wall, validation returns:

```json
{
  "valid": false,
  "reason": "Destination is blocked by terrain: Stone Wall.",
  "legalAlternatives": [
    { "x": 5, "y": 2 },
    { "x": 6, "y": 2 },
    { "x": 7, "y": 2 }
  ]
}
```

Repair prompt:

```text
Your proposed action was invalid.

Reason:
Destination is blocked by terrain: Stone Wall.

Choose a revised legal action using one of the legal alternatives.
Return only JSON.
```

If repair fails twice, fallback to deterministic AI.

---

# 29. Deterministic Fallback AI

Fallback AI should be boring but reliable.

Basic enemy logic:

```text
If adjacent to enemy:
  Strike best target.
  Strike again if useful.
  Step or Raise Shield.
Else:
  Stride toward nearest reachable enemy.
  If adjacent after moving, Strike.
  End turn.
```

Basic ranged logic:

```text
If line of sight and within range:
  Strike with ranged weapon.
  Strike again if target is weak.
  Take Cover or Step away.
Else:
  Move to nearest tile with line of sight.
```

---

# 30. Map Translation Layer

The map translation layer allows other apps to export encounters without caring about simulator internals.

## 30.1 Generic Import Shape

```json
{
  "source": "amba",
  "sourceVersion": "0.1.0",
  "grid": {
    "cellSizeFeet": 5,
    "width": 20,
    "height": 9
  },
  "terrain": [],
  "walls": [],
  "doors": [],
  "tokens": []
}
```

The adapter maps this to:

```json
{
  "rows": [],
  "terrainLegend": {},
  "tokens": []
}
```

---

## 30.2 VTT Adapter Concept

A Foundry-like scene might include:

```json
{
  "walls": [
    {
      "c": [0, 0, 100, 0],
      "move": 1,
      "sight": 1
    }
  ],
  "tokens": [
    {
      "name": "Goblin",
      "x": 350,
      "y": 200
    }
  ],
  "grid": 100
}
```

Translation:

```text
pixel x / grid size = grid x
pixel y / grid size = grid y
```

Then wall segments become blocking edges or blocking cells.

For the first version, use cell-blocking terrain instead of edge-blocking walls.

Later, edge walls can support more accurate VTT behavior.

---

# 31. Combat State Object

The active combat state should be a single object.

```json
{
  "runId": "run_001",
  "round": 1,
  "initiative": [
    {
      "combatantId": "pc_seren",
      "initiative": 22,
      "status": "active"
    },
    {
      "combatantId": "enemy_goblin_1",
      "initiative": 16,
      "status": "waiting"
    }
  ],
  "activeInitiativeIndex": 0,
  "combatants": {},
  "map": {},
  "turnState": {},
  "eventLog": [],
  "randomSeed": "optional-seed"
}
```

Do not scatter combat state across many untracked variables.

The simulator should be able to serialize and resume the state after every action.

---

# 32. End Conditions

Basic combat end conditions:

```json
{
  "type": "defeatAllEnemies"
}
```

Other future objectives:

| Objective | Description |
|---|---|
| surviveRounds | Survive for X rounds |
| escapeMap | Reach exit tile |
| protectNPC | Keep an NPC alive |
| defeatBoss | Defeat named target |
| captureTarget | Disable but do not kill |
| interruptRitual | Interact with objective before timer ends |
| holdZone | Maintain control of an area |

Example:

```json
{
  "objectives": [
    {
      "id": "defeat_enemies",
      "type": "defeatAllEnemies"
    },
    {
      "id": "protect_mayor",
      "type": "protectNPC",
      "npcId": "npc_mayor"
    }
  ]
}
```

---

# 33. Why Event Sourcing Helps

Instead of only saving final state, save every event.

This allows:

- Replay
- Debugging
- Rule audit
- Narrative export
- Simulation comparison
- Visualization
- Rewinding turns
- Generating play reports

Example event chain:

```text
event_001: initiativeRolled
event_002: turnStarted
event_003: actionProposed
event_004: actionValidated
event_005: diceRolled
event_006: damageApplied
event_007: conditionApplied
event_008: turnEnded
```

---

# 34. First Code Skeleton: TypeScript Interfaces

```ts
export type Team = "party" | "enemy" | "npc";

export type CombatantType = "pc" | "enemy" | "npc";

export interface Position {
  x: number;
  y: number;
}

export interface HpState {
  max: number;
  current: number;
  temporary: number;
}

export interface Attack {
  id: string;
  name: string;
  type: "melee" | "ranged";
  attackBonus: number;
  damage: string;
  damageType: string;
  rangeIncrement?: number;
  traits?: string[];
}

export interface Combatant {
  id: string;
  name: string;
  type: CombatantType;
  team: Team;
  level: number;
  token: {
    display: string;
    size: "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";
    position: Position;
  };
  hp: HpState;
  ac: number;
  perception: number;
  saves: {
    fortitude: number;
    reflex: number;
    will: number;
  };
  speed: number;
  attacks: Attack[];
  resources: Record<string, unknown>;
  conditions: Condition[];
  strategyProfile?: string;
}

export interface Condition {
  id: string;
  value?: number;
  source?: string;
  expires?: {
    timing: "startOfTurn" | "endOfTurn" | "roundEnd" | "manual";
    combatantId?: string;
  };
}

export interface EncounterInput {
  ruleset: string;
  scenarioId: string;
  scenarioName: string;
  scenarioVersion: string;
  map: GridMap;
  combatants: Combatant[];
  simulationOptions: SimulationOptions;
}

export interface GridMap {
  width: number;
  height: number;
  cellSizeFeet: number;
  rows: string[];
  terrainLegend: Record<string, TerrainDef>;
}

export interface TerrainDef {
  name: string;
  blocksMovement: boolean;
  blocksLineOfSight: boolean;
  movementMultiplier?: number;
  providesCover?: "lesser" | "standard" | "greater";
}

export interface SimulationOptions {
  mode: "manual" | "auto" | "hybrid";
  maxRounds: number;
  narration: "none" | "simple" | "high";
  diceMode: "random" | "seeded" | "fixed";
  saveRun: boolean;
}
```

---

# 35. First Code Skeleton: Simulation Loop

```ts
export async function runSimulation(input: EncounterInput) {
  const state = await initializeEncounter(input);

  await persistRunStarted(state);

  while (!isCombatOver(state)) {
    const active = getActiveCombatant(state);

    startTurn(state, active.id);

    await renderUi(state);

    const tacticalState = buildTacticalState(state, active);

    let proposal;

    if (shouldUseLlm(active, state)) {
      proposal = await getLlmActionProposal(tacticalState);
    } else {
      proposal = getFallbackActionProposal(tacticalState);
    }

    const validation = validateActionProposal(proposal, state);

    if (!validation.valid) {
      proposal = await repairOrFallback(proposal, validation, tacticalState);
    }

    const finalValidation = validateActionProposal(proposal, state);

    if (!finalValidation.valid) {
      proposal = getFallbackActionProposal(tacticalState);
    }

    for (const action of proposal.actions) {
      const result = resolveAction(action, state);
      applyResult(result, state);
      await persistEvent(result);
      await renderUi(state);
    }

    endTurn(state, active.id);
    advanceInitiative(state);
  }

  await persistRunCompleted(state);

  return summarizeSimulation(state);
}
```

---

# 36. First Prototype Checklist

Build in this order:

1. JSON schema
2. ASCII map parser
3. Token overlay renderer
4. Dice roller
5. Initiative roller
6. Turn tracker
7. Movement validator
8. Strike resolver
9. HP state updater
10. Combat end detector
11. Event logger
12. SQLite persistence
13. Terminal UI
14. Manual stepping
15. Auto mode
16. LLM action proposal
17. LLM repair loop
18. Rich narration

---

# 37. Important Implementation Rules

## Rule 1: LLM Does Not Own State

The LLM proposes actions.

The engine validates and applies actions.

## Rule 2: Persist After Every Meaningful Event

Do not wait until the end of combat.

If the simulator crashes mid-combat, the run should be recoverable.

## Rule 3: All Dice Are Structured

Never store only the final sentence.

Store the formula, dice, modifiers, total, target DC, result, and state changes.

## Rule 4: Map Is Terrain First, Tokens Second

Never bake tokens into terrain.

## Rule 5: Ruleset Logic Is an Adapter

Do not make PF2e assumptions permanent in the core engine.

## Rule 6: Every Invalid LLM Action Becomes Training Data

Invalid proposal:

```json
{
  "action": "Cast Fireball",
  "reasonRejected": "No remaining prepared uses."
}
```

This can improve future prompts and strategy.

---

# 38. Near-Term Build Recommendation

For your actual first version, build this:

```text
Node + TypeScript
Zod validation
SQLite persistence
Terminal UI
ASCII map renderer
PF2e basic rules adapter
Simple fallback AI
LLM tactical planner after deterministic engine works
```

The first true success case should be:

```text
Load one JSON file.
Show map.
Roll initiative.
Move tokens.
Resolve attacks.
Log all math.
Finish combat.
Save run.
Run same scenario again.
Group both runs under one parent scenario.
Compare results.
```

That proves the architecture.

Everything else can be layered in after that.
