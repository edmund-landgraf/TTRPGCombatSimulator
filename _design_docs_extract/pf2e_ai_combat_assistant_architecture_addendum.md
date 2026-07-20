
# Addendum: PF2e AI Combat Assistant Findings and Architecture Updates

## Executive Summary

Research into the existing **PF2e AI Combat Assistant** for Foundry VTT reinforced the proposed architecture rather than replacing it.

The existing project demonstrates that:

- Foundry can expose enough tactical state for an LLM.
- An LLM can recommend useful PF2e combat actions.
- The missing piece is not tactical reasoning—it is long-lived simulation, validation, persistence, and adaptive strategy.

Our project therefore extends the idea from a **combat assistant** into a **combat simulation platform**.

---

# What the Existing Assistant Does

The assistant analyzes the current combat state and recommends actions for the active combatant.

It considers:

- Current HP
- Conditions
- Available actions
- Reactions
- Weapons
- Spells
- Feats
- Items
- Allies
- Enemies
- Positioning
- Remaining resources

Conceptually:

Foundry PF2e State
↓
Tactical Snapshot
↓
LLM
↓
Suggested Action

This validates our "tactical snapshot" design.

---

# What Our Simulator Adds

| Existing Assistant | Proposed Simulator |
|-------------------|--------------------|
| One-turn recommendations | Full encounter simulation |
| Suggest actions | Validate and execute actions |
| Current combat only | Persistent combat history |
| No replay | Event-sourced replay |
| No scenario grouping | Scenario hashing and branching |
| No adaptive AI | Strategy evolution across repeated runs |
| No statistics | Win rates, DPR, survival, encounter balance |
| Foundry only | Local engine + Foundry runtime adapter |

---

# Revised Architecture

The biggest design improvement from the research is to move from independent actors to coordinated planning.

## Old Model

Encounter
↓
Actor A → LLM

Actor B → LLM

Actor C → LLM

Each actor plans independently.

Problem:

Enemies may accidentally work against each other.

---

## New Hierarchical Model

Encounter State
↓
Encounter Director (once per round)
↓
Commander Layer
├── Enemy Commander
└── Party Commander
↓
Individual Actor Planner
↓
Rules Validator
↓
Runtime (Foundry or Local Engine)

The commander establishes objectives before any actor plans.

Example:

Enemy Commander:

- Hold the choke point.
- Focus the wounded rogue.
- Preserve the crawler.
- Avoid open ground.

Goblin 1 then plans:

- Move to cover.
- Shoot Seren.

Goblin 2 plans:

- Support Goblin 1.
- Demoralize Brakka.

Crawler plans:

- Block hallway.

The actors now cooperate.

---

# Tactical Snapshot Remains Central

Every actor still receives a fresh tactical snapshot.

The LLM does **not** remember combat state.

The engine or Foundry owns:

- HP
- Conditions
- Initiative
- Actions remaining
- Spell slots
- Resources
- Position
- Terrain

The planner receives these values every turn.

---

# New Planning Pipeline

Start of Round
↓
Read authoritative state
↓
Encounter Director
↓
Commander creates round strategy
↓
For each combatant:
    Build tactical snapshot
    Include commander intent
    Ask LLM for action plan
    Validate
    Execute
    Read state back
    Log event
End Round
Generate summary

---

# Commander Prompt

The commander prompt should be separate from the actor prompt.

Example:

"You control the enemy force for this round.

Objectives:
- Win the encounter.
- Preserve valuable units.
- Use terrain intelligently.

Current battlefield:
...

Return:

{
  "overallPlan": "...",
  "focusTarget": "...",
  "formation": "...",
  "actorAssignments": [...]
}"

Each actor then receives its assignment.

---

# Why This Is Better

Benefits:

- Coordinated tactics
- Less contradictory AI behavior
- More believable encounters
- Easier to implement personalities
- Better adaptive learning between simulation runs

This creates encounters that feel like intelligent groups rather than isolated creatures.

---

# Recommendation

Retain the existing architecture:

State Store
↓
Tactical Snapshot
↓
LLM
↓
Validator
↓
Runtime
↓
State Update

But insert two additional layers:

Encounter Director
Commander

This becomes:

State Store
↓
Encounter Director
↓
Commander
↓
Actor Planner
↓
Validator
↓
Runtime
↓
State Store

This architecture is compatible with both:

- Local simulator runtime
- Foundry VTT runtime

and provides a clear differentiator from existing AI combat assistant modules.
