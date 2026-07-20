
# Addendum: Combat Knowledge Graph and Imperfect Information

## Motivation

A significant improvement to the simulator architecture is to replace the idea of sending the **entire tactical snapshot** to every actor each turn.

Instead, introduce a **Combat Knowledge Graph (CKG)** that is continuously updated throughout the encounter.

The Combat Knowledge Graph becomes the authoritative model of what is known about the battlefield, while each actor receives only a filtered view based on what that actor could reasonably know.

This more closely models tabletop play and real battlefield decision making.

---

# Core Principle

Separate:

- **Objective Reality** (the true combat state)
- **Actor Knowledge** (what an individual creature believes is true)

The engine always knows the objective reality.

The LLM controlling an actor should only receive that actor's knowledge.

---

# Architecture

```text
                Objective Combat State
                         │
                         ▼
              Combat Knowledge Graph
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   PC Knowledge     Enemy Knowledge   NPC Knowledge
        │                │                │
        ▼                ▼                ▼
 Individual Tactical Snapshot (filtered)
        │
        ▼
      LLM Planner
        │
        ▼
 Rules Validator / Runtime
        │
        ▼
State Update → Combat Knowledge Graph
```

---

# Building the Knowledge Graph

The graph is updated whenever:

- A creature moves.
- A creature attacks.
- A spell is cast.
- A sound is heard.
- A door opens.
- A creature is revealed or hidden.
- A condition becomes visible.
- Someone communicates information.
- Recall Knowledge succeeds.
- A perception check changes awareness.

Each event updates objective reality and then propagates knowledge to actors who could observe or infer it.

---

# What Filters an Actor's View?

Each tactical snapshot should be filtered by:

- Vision and line of sight
- Lighting
- Distance
- Concealment
- Hidden/Invisible conditions
- Hearing and other senses
- Successful Recall Knowledge
- Languages and communication
- Team communication
- Prior observations
- Memory of previous rounds

Example:

A goblin behind a wall should not know that the wizard drank a potion unless:

- it saw the action,
- another goblin reported it,
- or another reasonable information source exists.

---

# Tactical Snapshot Becomes Personalized

Instead of one global snapshot, each actor receives:

```text
Objective Combat State
        ↓
Knowledge Filter
        ↓
Actor-Specific Tactical Snapshot
```

This allows:

- Different actors to make different decisions from the same battlefield.
- Hidden information to remain hidden.
- Scouts and sentries to become valuable.
- Communication abilities to matter.

---

# Recall Knowledge

Recall Knowledge should update the actor's knowledge graph rather than objective state.

Example:

A successful check may reveal:

- weakness to fire
- resistance to cold
- regeneration
- dangerous reactions
- spellcasting tradition

Those facts become available to that actor (and optionally allies if communicated).

---

# Communication Layer

Actors should be able to share information.

Examples:

- "The rogue is almost down!"
- "The cleric is concentrating on a spell."
- "The troll regenerates unless burned."

Different creatures communicate differently.

Examples:

- Military units share information efficiently.
- Animals mostly communicate immediate threats.
- Mind-linked creatures may share perfect information.

---

# Advantages

Compared to sending every actor the complete tactical state each turn, the Combat Knowledge Graph provides:

- More believable tactics
- Imperfect information
- Better stealth gameplay
- Better scouting gameplay
- More realistic monster intelligence
- Reduced omniscience
- Cleaner separation between engine state and AI perception

---

# Relationship to Existing AI Combat Assistants

Current AI combat assistants generally operate on a single global tactical context.

The Combat Knowledge Graph extends that model by introducing actor-specific perception and memory.

This is a significant architectural enhancement for:

- AI-vs-AI simulations
- Solo play
- GM assistance
- Encounter balance testing
- Narrative realism

The result is that AI creatures behave more like independent participants in a shared world rather than perfectly informed agents.
