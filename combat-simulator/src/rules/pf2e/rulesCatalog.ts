/**
 * Teaching-oriented PF2e rules blurbs keyed by simulator action heads
 * and related concepts. Not a rules reprint — short references for the CLI.
 */

export type RulesMode = "brief" | "verbose";

export type RulesEntry = {
  id: string;
  /** Aliases accepted by --rules filters */
  aliases: string[];
  title: string;
  /** Simulator action head(s), if any */
  actions: string[];
  brief: string;
  verbose: string[];
  /** Engine status for this topic */
  simStatus: "implemented" | "partial" | "planned";
};

export const RULES_CATALOG: RulesEntry[] = [
  {
    id: "Strike_melee",
    aliases: ["strike_melee", "melee", "strike"],
    title: "Strike (melee)",
    actions: ["Strike_melee"],
    brief: "1 action. Melee attack vs AC within weapon reach (usually adjacent / 5 ft).",
    verbose: [
      "PF2e: Strike is typically 1 action. Roll d20 + attack modifier vs target AC.",
      "Success: deal weapon damage. Critical success (nat 20 or beat AC by 10+): double damage.",
      "Multiple Attack Penalty (MAP): −0 / −5 / −10 on successive attacks that turn (agile differs).",
      "Reach: most melee weapons threaten only adjacent squares (Chebyshev dist ≤ 1).",
      "Reach weapons (trait): can Strike at dist ≤ 2 (10 ft) — sim uses weapon.reach.",
    ],
    simStatus: "implemented",
  },
  {
    id: "Strike_ranged",
    aliases: ["strike_ranged", "ranged", "shoot"],
    title: "Strike (ranged)",
    actions: ["Strike_ranged"],
    brief: "1 action. Ranged attack vs AC within range; needs line of sight; cover may raise AC.",
    verbose: [
      "PF2e: Ranged Strike needs the target within the weapon’s range and a clear line of effect/sight.",
      "Lesser / standard cover grants +1 / +2 circumstance to AC (sim: +2 on cover/barricade, or when LOS crosses a barricade).",
      "MAP applies to ranged Strikes the same as melee unless a feat says otherwise.",
      "Firing into melee has no special penalty in PF2e (unlike some other systems).",
    ],
    simStatus: "implemented",
  },
  {
    id: "Cast_cantrip",
    aliases: ["cast_cantrip", "cantrip"],
    title: "Cast a Spell (cantrip)",
    actions: ["Cast_cantrip"],
    brief: "Usually 2 actions. Unlimited cantrip; spell attack or save; may use MAP on spell attacks.",
    verbose: [
      "PF2e: Cast a Spell has a number of actions printed on the spell (often 2 for attack cantrips).",
      "Cantrips (rank 0) can be cast at will; they heighten with level in full PF2e (sim: fixed L1 numbers).",
      "Spell attack rolls use the same MAP track as Strikes when they are attack rolls.",
      "Save cantrips (e.g. Electric Arc): target rolls save vs your spell DC; often half damage on success.",
    ],
    simStatus: "implemented",
  },
  {
    id: "Cast_spell",
    aliases: ["cast_spell", "spell"],
    title: "Cast a Spell (ranked)",
    actions: ["Cast_spell"],
    brief: "Costs actions printed on the spell; consumes a spell slot / daily use (sim: usesPerCombat).",
    verbose: [
      "PF2e: Ranked spells cost spell slots (or focus, etc.). Sim approximates with usesPerCombat.",
      "Same Cast a Spell activity rules as cantrips for actions, attacks, and saves.",
      "Components / manipulate traits can interact with reactions in full PF2e (see Reactive_strike).",
      "AoE: areaSquareCells (e.g. Grease 2 = 10×10 ft / 2×2) or blastRadius (Chebyshev burst).",
      "leaveTerrain paints lasting map tags — Grease leaves G cells that count as difficult terrain.",
      "Creatures in the area each resolve their own save/damage when the spell is cast.",
    ],
    simStatus: "partial",
  },
  {
    id: "aoe_terrain",
    aliases: ["aoe", "area", "grease", "blast", "fireball", "leave_terrain"],
    title: "Area spells & terrain marks",
    actions: ["Cast_spell", "Cast_cantrip"],
    brief:
      "Square/burst AoE can hit multiple foes and optionally paint lasting terrain (Grease → G on a 2×2).",
    verbose: [
      "areaSquareCells: axis-aligned square including the target cell (2 = 10 ft × 10 ft).",
      "blastRadius: Chebyshev burst centered on the target.",
      "leaveTerrain + terrainGlyph: paint tag onto walkable cells (grease → G); pathing treats grease as difficult.",
      "terrainDurationRounds: how long the mark lasts (default 10 ≈ 1 minute). 0 = until combat end.",
      "Active patches are listed in the status roster with rounds remaining; they clear at round end when expired.",
      "ASCII empty grease cells show G; tokens still draw on top when occupying a greased cell.",
    ],
    simStatus: "partial",
  },
  {
    id: "Heal_ally",
    aliases: ["heal_ally", "heal"],
    title: "Heal (ally)",
    actions: ["Heal_ally"],
    brief: "Usually 2 actions (1–3 action Heal variants exist). Restore HP to a living or dying ally in range.",
    verbose: [
      "PF2e Heal is a 1–3 action spell with different ranges/effects by action cost.",
      "Sim uses a 2-action Heal: 1d8 + mod HP to one ally within rangeCells (teaching approximation).",
      "Healing a dying creature above 0 HP removes Dying, wakes them, and increases Wounded by 1 (PF2e).",
    ],
    simStatus: "partial",
  },
  {
    id: "Dying_recovery",
    aliases: ["dying", "unconscious", "dead", "recovery_check", "wounded"],
    title: "Dying / unconscious / dead (PF2e)",
    actions: [],
    brief: "At 0 HP you fall unconscious with Dying; recovery checks each turn; die at Dying 4.",
    verbose: [
      "Reduced to 0 HP: gain Dying 1 + Wounded (critical hit that drops you adds +1 Dying).",
      "While Dying: unconscious; at the start of your turn attempt a flat recovery check DC 10 + Dying value.",
      "Crit success −2 Dying, success −1, failure +1, crit failure +2. Dying 4 = dead. Dying 0 at 0 HP = unconscious but stable.",
      "Damage while at 0 HP increases Dying. Healing above 0 clears Dying and increases Wounded.",
    ],
    simStatus: "implemented",
  },
  {
    id: "Stride_close",
    aliases: ["stride_close", "stride", "move"],
    title: "Stride (close with foe)",
    actions: ["Stride_close"],
    brief: "1 action. Move up to Speed toward a foe. Leaving threatened squares may provoke reactions.",
    verbose: [
      "PF2e: Stride = 1 action to move up to your Speed (sim: speedCells on the grid).",
      "Diagonals: PF2e uses first diagonal 5 ft, then every other 10 ft; sim approximates with simplified path costs.",
      "Leaving a square threatened by a creature with Reactive Strike / Attack of Opportunity can trigger that reaction.",
      "Step is the safe 5-foot reposition that does not trigger those reactions (see Step_away).",
    ],
    simStatus: "partial",
  },
  {
    id: "Stride_cover",
    aliases: ["stride_cover", "cover"],
    title: "Stride (into cover)",
    actions: ["Stride_cover"],
    brief: "1 action Stride aiming at a cover cell. Cover can raise AC vs ranged / some effects.",
    verbose: [
      "PF2e cover: terrain or creatures can grant circumstance bonuses to AC (and Reflex in some cases).",
      "Sim: cover rail (=) and barricade (B) grant standard cover (+2 AC) vs ranged Strikes / spell attacks.",
      "Barricades are soft cover — walkable and you can shoot over them; cover also applies when the attack line crosses a B cell.",
      "Taking cover can also be its own action in full PF2e; sim paths onto cover/barricade cells.",
    ],
    simStatus: "partial",
  },
  {
    id: "Step_away",
    aliases: ["step_away", "step"],
    title: "Step",
    actions: ["Step_away"],
    brief: "1 action. Move 5 ft (1 square). Does not trigger Reactive Strike / Attack of Opportunity.",
    verbose: [
      "PF2e: Step moves 5 feet into an unoccupied square you can reach; Speed must be at least 10 ft.",
      "Crucially, Step does not trigger reactions that trigger on move-from-threatened-square (AoO / Reactive Strike).",
      "Sim uses Step_away when hurt / high selfPreservation to increase distance by 1 cell.",
    ],
    simStatus: "partial",
  },
  {
    id: "End_turn",
    aliases: ["end_turn", "end"],
    title: "End turn",
    actions: ["End_turn"],
    brief: "Stop spending actions. Unused actions are lost. MAP resets at the start of your next turn.",
    verbose: [
      "PF2e: You may end your turn with actions remaining; they do not carry over.",
      "Reactions refresh for your next turn; MAP resets when your turn begins again.",
      "Sim picks End_turn when no candidate scores above the action threshold.",
    ],
    simStatus: "implemented",
  },
  {
    id: "distance",
    aliases: ["distance", "range", "reach", "squares"],
    title: "Distance, reach, and range",
    actions: [],
    brief: "Grid: 1 square ≈ 5 ft. Melee usually dist≤1; reach weapons dist≤2; spells/weapons use rangeCells.",
    verbose: [
      "PF2e measures in feet on a square grid; adjacent = 5 ft (including diagonals for adjacency).",
      "Weapon reach trait: Strike (and threaten) out to 10 ft typically — sim: weapon.reach (Chebyshev).",
      "Spell/weapon ranges are converted to cells (e.g. 30 ft ≈ 6 cells) via rangeCells.",
      "Sim currently uses Chebyshev distance for adjacency/reach checks; path costs approximate PF2e diagonals.",
      "Not yet modeled: threatened-square tracking for reactions, or precise cover lines beyond cell tags.",
    ],
    simStatus: "partial",
  },
  {
    id: "map",
    aliases: ["map", "multiple_attack_penalty", "penalty"],
    title: "Multiple Attack Penalty (MAP)",
    actions: ["Strike_melee", "Strike_ranged", "Cast_cantrip"],
    brief: "Same turn: 1st attack −0, 2nd −5, 3rd+ −10 (agile: −0/−4/−8). Resets next turn.",
    verbose: [
      "PF2e MAP applies to attack rolls (Strikes and spell attacks) sharing the MAP track.",
      "Agile weapons use a reduced MAP (−4 / −8).",
      "Sim: map counter on the combatant; displayed as d20+mod including the penalty.",
    ],
    simStatus: "implemented",
  },
  {
    id: "Reactive_strike",
    aliases: [
      "reactive_strike",
      "aoo",
      "attack_of_opportunity",
      "opportunity",
      "reaction",
    ],
    title: "Reactive Strike / Attack of Opportunity",
    actions: [],
    brief:
      "Reaction (not everyone has it). Often triggers when a foe leaves a square you threaten. Step avoids it. Reach controls more squares.",
    verbose: [
      "Naming: Legacy PF2e used Attack of Opportunity (fighter feat / some monsters). Remaster often uses Reactive Strike.",
      "Default PCs do NOT all have this — Fighter (and many monsters/NPCs) do. Do not import 5e “everyone threatens.”",
      "Typical trigger: an enemy uses an action with the move trait to leave a square within your reach.",
      "Step specifically does not trigger these reactions. Stride (and many forced moves rules) differ — check the reaction text.",
      "Reach weapons expand threatened squares (usually to 10 ft), enabling chokepoint control on corridors/doorways.",
      "You generally get one reaction per turn; after you use Reactive Strike, you cannot use it again until your next turn.",
      "Sim status: NOT implemented yet — no threaten map, no reaction resolution on leave-square.",
    ],
    simStatus: "planned",
  },
  {
    id: "chokepoint",
    aliases: ["chokepoint", "choke", "control", "threaten"],
    title: "Reach & chokepoint control",
    actions: [],
    brief:
      "Frontliners hold narrow doorways/corridors; ranged/casters stay ~20 ft behind. Reach + Reactive Strike (planned) punishes Strides through threatened squares.",
    verbose: [
      "Space control comes from threatened squares + a reaction that strikes on leave (or similar triggers).",
      "With reach 10 ft in a 5-ft corridor, you may threaten the square in front of you and beyond the doorway.",
      "Enemies can often Step (5 ft, no trigger), wait, or use skills (e.g. Tumble Through) depending on the table’s rules.",
      "Sim: tactics agent hold_chokepoint / deep_retreat_choke when a cell is a wall-flanked corridor.",
      "Until Reactive_strike is implemented, long weapons only affect Strike range — they do not control space via reactions.",
    ],
    simStatus: "partial",
  },
  {
    id: "spatial_threat",
    aliases: [
      "spatial",
      "hazardous",
      "hazard",
      "difficult_terrain",
      "flank_escape",
      "pathing",
    ],
    title: "Hazardous terrain & spatial threat matrix",
    actions: ["Stride_close", "Stride_cover", "Step_away"],
    brief:
      "Pathing respects difficult (2× cost) and hazardous (damage on enter). Flanked actors Step to break the pincer; tanks hold chokes; backliners stay deep.",
    verbose: [
      "Difficult terrain: each square costs +1 movement. Don't burn a second Stride through it when a ranged option exists.",
      "Hazardous terrain (tag hazardous): entering deals static damage; tactics veto unless damage < HP and move secures an immediate kill.",
      "Vulnerable (flanked by enemies): CRITICAL — Step before offense to clear off-guard.",
      "Preventative: with 2+ adjacent foes, Step to wall/corner to deny opposite-side flanks.",
      "Chokepoints: frontliner holds the bottle; keepDistance roles stay ≥20 ft behind.",
      "Module source: src/ai/modules/hazardous-terrain-spatial-threat.json",
    ],
    simStatus: "partial",
  },
  {
    id: "grandmaster_loop",
    aliases: [
      "grandmaster",
      "combat_loop",
      "action_economy",
      "save_arbitrage",
      "map",
      "eot",
    ],
    title: "Grandmaster combat loop core",
    actions: [],
    brief:
      "Six-phase loop: status → space → target → compose role/feat packets (level-banded search) → EoT mitigation → reaction precompute. Never third-strike under normal MAP.",
    verbose: [
      "Step 1: Clear lethal persistent damage / heavy Frightened·Sickened before ranked offense.",
      "Step 2: Spatial matrix (flank break, difficult/hazard pathing) — see spatial_threat.",
      "Step 3: Save arbitrage — prefer save spells on lowest saveBonus; role proxies for brute/caster/mindless.",
      "Step 4: Resolve classId/archetypes/capabilities → role packets + feat overlays; L1–2 picks one packet, L3–6 top-K=3, L7+ beam-expands K=5.",
      "Capability tags (sneak_attack, reactive_strike, heal_font, …) mutate packets and gate tactics skills.",
      "Step 5: Last action prefers Take Cover / Step / End over MAP-10 Strikes.",
      "Step 6: Reactive Strike & Shield Block precompute are planned (reactionAvailable flag only).",
      "Fed by Real-Time Combat State Parser (parseCombatState) each turn.",
      "Modules: grandmaster-combat-loop-core.json, role-action-packets.json, feat-archetype-overlays.json, level-band-reasoning.json",
    ],
    simStatus: "partial",
  },
  {
    id: "build_capabilities",
    aliases: ["feats", "archetypes", "capabilities", "class_packets", "overlays"],
    title: "Classes, feats, and archetypes (capability tags)",
    actions: [],
    brief:
      "Combatants carry classId, archetypes, and capability tags. Overlays compose action packets; search depth scales with level.",
    verbose: [
      "Fixture fields: classId, archetypes[], capabilities[] (optional — inferred from role when omitted).",
      "Role packets: fighter, rogue, cleric, champion, ranger_archer, barbarian, bard, monk, wizard, monster_*.",
      "Overlays: reactive_strike, sneak_attack, flurry_of_blows, shield_block, sudden_charge, inspire_courage, heal_font, cast_focus, …",
      "Level bands: L1–2 shallow; L3–6 K=3; L7–10 beam K=5; L11+ beam + resource gate. ≥4 capabilities bumps band one step.",
      "Tactics skills prefer_off_guard / setup_reactive_strike / font_heal_priority only fire when the capability is present.",
    ],
    simStatus: "partial",
  },
  {
    id: "combat_state_parser",
    aliases: ["state_parser", "combat_state", "parser", "map_tracker"],
    title: "Real-Time Combat State Parser",
    actions: [],
    brief:
      "Live snapshot of round, vitals, action budget/MAP, spatial posture, statuses, and enemy registry — feeds the Grandmaster loop.",
    verbose: [
      "Built each turn from CombatMemory (never hardcoded demo values).",
      "MAP from attack-trait count: normal 0/−5/−10, agile 0/−4/−8.",
      "Flank detection syncs Off-Guard; EOT decay ticks persistent, decrements Frightened, lowers shield, resets MAP.",
      "Module: src/ai/modules/realtime-combat-state-parser.json",
    ],
    simStatus: "implemented",
  },
  {
    id: "initiative",
    aliases: ["initiative", "init"],
    title: "Initiative",
    actions: [],
    brief: "Roll Perception (or other) + d20; act in order each round. Delay can permanently change your slot.",
    verbose: [
      "PF2e combat initiative is often Perception; skills/feats may change the statistic.",
      "Sim: d20 + perceptionBonus at encounter start; Delay may reorder you when you return.",
    ],
    simStatus: "implemented",
  },
  {
    id: "Delay",
    aliases: ["delay", "defer", "hold_turn"],
    title: "Delay",
    actions: ["Delay"],
    brief:
      "Free action when your turn begins. Leave initiative; return after another creature’s turn ends (new permanent initiative). No reactions while Delayed.",
    verbose: [
      "PF2e (Player Core): Trigger — your turn begins. You wait for the right moment; the rest of your turn does not happen yet.",
      "You are removed from the initiative order. Return as a free action when any other creature’s turn ends; this permanently changes your initiative to that new position.",
      "You can’t use reactions until you return. If you Delay a full round without returning, the Delayed turn is lost and your initiative stays at the original position.",
      "Negative start/end-of-turn effects apply when you Delay; you can’t Delay to stretch beneficial effects that would end on your turn.",
      "Sim: AI melee who can’t reach may Delay on early rounds and return after an ally acts; casters who can cast do not Delay (open with magic).",
      "Ref: https://2e.aonprd.com/Actions.aspx?ID=2294",
    ],
    simStatus: "implemented",
  },
];

export function listRulesIds(): string[] {
  return RULES_CATALOG.map((e) => e.id);
}

function normalizeToken(s: string): string {
  return s.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Resolve user filter tokens to catalog entries. Empty filter → all. */
export function resolveRulesEntries(filter: string[]): RulesEntry[] {
  if (filter.length === 0 || (filter.length === 1 && filter[0] === "all")) {
    return RULES_CATALOG;
  }
  const found: RulesEntry[] = [];
  const missing: string[] = [];
  for (const raw of filter) {
    const tok = normalizeToken(raw);
    const hit = RULES_CATALOG.find(
      (e) =>
        normalizeToken(e.id) === tok ||
        e.aliases.some((a) => normalizeToken(a) === tok) ||
        e.actions.some((a) => normalizeToken(a) === tok),
    );
    if (hit) {
      if (!found.includes(hit)) found.push(hit);
    } else {
      missing.push(raw);
    }
  }
  if (missing.length) {
    throw new Error(
      `Unknown rules topic(s): ${missing.join(", ")}. Try: ${listRulesIds().join(", ")}`,
    );
  }
  return found;
}

export function formatRulesHelp(): string {
  const lines = [
    "Usage:",
    "  npm run sim -- --rules                 # all topics, brief",
    "  npm run sim -- --rules all --rules-mode verbose",
    "  npm run sim -- --rules Strike_melee,Step,Reactive_strike",
    "  npm run sim -- --rules aoo --rules-mode verbose",
    "",
    "Topics:",
  ];
  for (const e of RULES_CATALOG) {
    const acts = e.actions.length ? ` [${e.actions.join(", ")}]` : "";
    lines.push(`  ${e.id}${acts} (${e.simStatus})`);
  }
  return lines.join("\n");
}

export function formatRules(entries: RulesEntry[], mode: RulesMode): string {
  const blocks: string[] = [];
  blocks.push(`PF2e rules reference (${mode}) — teaching blurbs for this simulator`);
  blocks.push("");

  for (const e of entries) {
    if (mode === "brief") {
      blocks.push(`[${e.simStatus}] ${e.title} (${e.id})`);
      blocks.push(`  ${e.brief}`);
      blocks.push("");
    } else {
      blocks.push("═".repeat(60));
      blocks.push(`${e.title}`);
      blocks.push(`id: ${e.id}  |  sim: ${e.simStatus}`);
      if (e.actions.length) blocks.push(`actions: ${e.actions.join(", ")}`);
      if (e.aliases.length) blocks.push(`aliases: ${e.aliases.join(", ")}`);
      blocks.push("");
      blocks.push(e.brief);
      blocks.push("");
      for (const line of e.verbose) {
        blocks.push(`  • ${line}`);
      }
      blocks.push("");
    }
  }

  if (mode === "brief") {
    blocks.push("Tip: --rules-mode verbose for full blurbs. --rules help for topic list.");
  }
  return blocks.join("\n").trimEnd() + "\n";
}
