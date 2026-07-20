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
