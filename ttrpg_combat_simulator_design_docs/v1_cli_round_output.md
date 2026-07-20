# V1 CLI Round Output

Terminal presentation for each combat round. No graphical UI.

## During the round

For each combatant in initiative order, print turn actions as they resolve (Stride/Strike, rolls, HP changes, rejects).

## End of each round (required order)

### 1. Status roster — all PCs and enemies

List every combatant on both sides:

| Field | Example |
|---|---|
| Id / name / role | `FTR Fighter` |
| HP | `28/28` or `0/12 (downed)` |
| Position | `@ x03y08` |
| Conditions / effects | `frightened 1`, `persistent fire 1d6`, or `—` |
| Round updates | HP/condition deltas since round start |

Group under `PARTY` then `ENEMY`. Include downed combatants.

### 2. ASCII map — positions only

Reprint the letter-token grid. Do **not** encode HP or conditions on the map.

### 3. Round summary paragraph

One prose paragraph summarizing what **every actor** did this round (move, attack, miss, hold, downed). Built from the event log (template). Optional LLM narrate may polish wording only — never change numbers or invent actions.

## Example

```text
--- Status (end of Round 1) ---
PARTY
  FTR  Fighter   hp 28/28  @ x03y07  conditions: —
  WIZ  Wizard    hp 14/16  @ x09y08  conditions: —
  ROG  Rogue     hp 17/17  @ x05y06  conditions: —
  CLR  Cleric    hp 20/20  @ x07y08  conditions: —
ENEMY
  GB1  Blade     hp 7/12   @ x03y05  conditions: —
  GB2  Blade     hp 12/12  @ x09y05  conditions: —
  GA1  Archer    hp 10/10  @ x04y02  conditions: —
  GA2  Archer    hp 10/10  @ x07y02  conditions: —
  SHA  Shaman    hp 15/15  @ x10y02  conditions: —
Updates this round: WIZ −2 (GA1); GB1 −5 (ROG)

=== Round 1 map ===
     x01 x02 x03 x04 x05 x06 x07 x08 x09 x10 x11 x12
y02   #   .   .   a   .   .   a   .   .   S   .   #
y05   #   .   b   .   .   .   .   .   b   .   .   #
y07   #   .   F   .   .   .   .   .   .   .   .   #
y08   #   .   .   .   .   .   C   .   W   .   .   #
y06   #   .   .   .   R   .   .   .   .   .   .   #

--- Round 1 summary ---
The rogue closed on the west blade and cut him for 5. Archer GA1 winged the
wizard for 2 while GA2 missed the cleric. Both blades held the line; the shaman
stayed behind cover. The fighter strode up to engage GB1; the cleric held and
the wizard stayed back after taking the hit.
```

## Run artifacts

Flush the same status block, map, and summary paragraph into `walkthrough.md` for each round.
