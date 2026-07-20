import type { ActionHead, TacticsGroupId as SchemaGroupId } from "../memory/schemas.js";

/** Minimal actor shape (avoids circular import with combatMemory). */
type TacticsActor = {
  role: string;
  tacticsGroup?: SchemaGroupId;
  tacticsSecondary?: SchemaGroupId;
};

const ACTION_HEADS: ActionHead[] = [
  "Strike_melee",
  "Strike_ranged",
  "Cast_cantrip",
  "Cast_spell",
  "Heal_ally",
  "Stride_close",
  "Stride_cover",
  "Step_away",
  "Delay",
  "End_turn",
];

/** How strongly secondary pulls weight multipliers toward its profile (0–1). */
const SECONDARY_BLEND = 0.4;

/** Built-in NWN-style tactics groups — one per combatant. */
export const TACTICS_GROUP_IDS = [
  "frontliner",
  "archer",
  "flanker",
  "buff_debuff",
  "battlefield_control",
  "blaster",
  "healer",
] as const;

export type TacticsGroupId = (typeof TACTICS_GROUP_IDS)[number];

export type TacticsGroupDef = {
  id: TacticsGroupId;
  label: string;
  hint: string;
  /** Multipliers applied on top of aiProfile.weights (missing = 1). */
  weightMult: Partial<Record<ActionHead, number>>;
  featureBias: {
    preferCover?: number;
    selfPreservation?: number;
    focusCaster?: number;
  };
  /** Behavior flags consumed by scorer / tactics agent. */
  flags: {
    preferRanged: boolean;
    preferMelee: boolean;
    keepDistance: boolean;
    seekFlank: boolean;
    openWithBuffs: boolean;
    healAllies: boolean;
    aggressive: boolean;
    preferControl: boolean;
    preferBlast: boolean;
  };
};

export const TACTICS_GROUPS: Record<TacticsGroupId, TacticsGroupDef> = {
  frontliner: {
    id: "frontliner",
    label: "Frontliner (melee)",
    hint: "Close and strike; hold the line; soft control via threatened space.",
    weightMult: {
      Strike_melee: 1.25,
      Strike_ranged: 0.35,
      Stride_close: 1.35,
      Stride_cover: 0.4,
      Step_away: 0.35,
      End_turn: 0.8,
    },
    featureBias: { selfPreservation: 0.3, focusCaster: 0.45 },
    flags: {
      preferRanged: false,
      preferMelee: true,
      keepDistance: false,
      seekFlank: false,
      openWithBuffs: false,
      healAllies: false,
      aggressive: true,
      preferControl: false,
      preferBlast: false,
    },
  },
  archer: {
    id: "archer",
    label: "Archer tactics",
    hint: "Shoot from the back line; do not walk into the scrum.",
    weightMult: {
      Strike_ranged: 1.4,
      Strike_melee: 0.25,
      Stride_close: 0.25,
      Stride_cover: 0.45,
      Step_away: 1.25,
      End_turn: 0.9,
    },
    featureBias: { preferCover: 0.25, selfPreservation: 0.7, focusCaster: 0.5 },
    flags: {
      preferRanged: true,
      preferMelee: false,
      keepDistance: true,
      seekFlank: false,
      openWithBuffs: false,
      healAllies: false,
      aggressive: true,
      preferControl: false,
      preferBlast: false,
    },
  },
  flanker: {
    id: "flanker",
    label: "Flanker / sneak",
    hint: "Stay back and shoot until a flank opens, then sneak attack.",
    weightMult: {
      Strike_melee: 1.2,
      Strike_ranged: 1.15,
      Stride_close: 0.75,
      Stride_cover: 0.4,
      Step_away: 0.7,
      End_turn: 0.9,
    },
    featureBias: { selfPreservation: 0.55 },
    flags: {
      preferRanged: true,
      preferMelee: false,
      keepDistance: true,
      seekFlank: true,
      openWithBuffs: false,
      healAllies: false,
      aggressive: true,
      preferControl: false,
      preferBlast: false,
    },
  },
  buff_debuff: {
    id: "buff_debuff",
    label: "Buff / debuff tactics",
    hint: "Open with support/debuff spells, then heal or soft offense.",
    weightMult: {
      Cast_spell: 1.35,
      Cast_cantrip: 1.1,
      Heal_ally: 1.2,
      Strike_melee: 0.35,
      Strike_ranged: 0.55,
      Stride_close: 0.35,
      Step_away: 1.1,
      End_turn: 0.85,
    },
    featureBias: { preferCover: 0.5, selfPreservation: 0.85 },
    flags: {
      preferRanged: true,
      preferMelee: false,
      keepDistance: true,
      seekFlank: false,
      openWithBuffs: true,
      healAllies: true,
      aggressive: false,
      preferControl: false,
      preferBlast: false,
    },
  },
  battlefield_control: {
    id: "battlefield_control",
    label: "Battlefield control",
    hint: "Prefer control/CC spells and denial positioning over raw damage.",
    weightMult: {
      Cast_spell: 1.45,
      Cast_cantrip: 1.15,
      Strike_melee: 0.3,
      Strike_ranged: 0.5,
      Stride_close: 0.45,
      Stride_cover: 0.7,
      Step_away: 1.05,
      End_turn: 0.85,
    },
    featureBias: { preferCover: 0.55, selfPreservation: 0.8 },
    flags: {
      preferRanged: true,
      preferMelee: false,
      keepDistance: true,
      seekFlank: false,
      openWithBuffs: false,
      healAllies: false,
      aggressive: false,
      preferControl: true,
      preferBlast: false,
    },
  },
  blaster: {
    id: "blaster",
    label: "Blaster / direct damage",
    hint: "Keep distance and cast attack spells/cantrips.",
    weightMult: {
      Cast_cantrip: 1.4,
      Cast_spell: 1.25,
      Strike_melee: 0.3,
      Strike_ranged: 0.55,
      Stride_close: 0.3,
      Stride_cover: 0.55,
      Step_away: 1.2,
      End_turn: 0.85,
    },
    featureBias: { preferCover: 0.4, selfPreservation: 0.85, focusCaster: 0.4 },
    flags: {
      preferRanged: true,
      preferMelee: false,
      keepDistance: true,
      seekFlank: false,
      openWithBuffs: false,
      healAllies: false,
      aggressive: true,
      preferControl: false,
      preferBlast: true,
    },
  },
  healer: {
    id: "healer",
    label: "Healer / triage",
    hint: "Heal critical allies first; light mid-line support afterward.",
    weightMult: {
      Heal_ally: 1.55,
      Cast_cantrip: 1.05,
      Cast_spell: 1.0,
      Strike_melee: 0.7,
      Strike_ranged: 0.5,
      Stride_close: 0.7,
      Step_away: 0.7,
      End_turn: 0.85,
    },
    featureBias: { selfPreservation: 0.45 },
    flags: {
      preferRanged: false,
      preferMelee: true,
      keepDistance: false,
      seekFlank: false,
      openWithBuffs: false,
      healAllies: true,
      aggressive: false,
      preferControl: false,
      preferBlast: false,
    },
  },
};

export function isTacticsGroupId(v: unknown): v is TacticsGroupId {
  return typeof v === "string" && (TACTICS_GROUP_IDS as readonly string[]).includes(v);
}

export function listTacticsGroups(): { id: TacticsGroupId; label: string; hint: string }[] {
  return TACTICS_GROUP_IDS.map((id) => ({
    id,
    label: TACTICS_GROUPS[id].label,
    hint: TACTICS_GROUPS[id].hint,
  }));
}

/** Role → default group when fixture omits tacticsGroup. */
export function defaultTacticsGroupForRole(role: string): TacticsGroupId {
  const r = role.toLowerCase();
  if (r.includes("rogue")) return "flanker";
  if (r.includes("archer") || r.includes("bow")) return "archer";
  if (r.includes("cleric") || r.includes("healer") || r.includes("priest")) return "healer";
  if (r.includes("shaman") || r.includes("wizard") || r.includes("sorcerer") || r.includes("mage")) {
    return "blaster";
  }
  if (r.includes("controller") || r.includes("enchanter")) return "battlefield_control";
  if (r.includes("bard") || r.includes("support")) return "buff_debuff";
  if (
    r.includes("fighter") ||
    r.includes("blade") ||
    r.includes("soldier") ||
    r.includes("warrior") ||
    r.includes("barbarian") ||
    r.includes("champion")
  ) {
    return "frontliner";
  }
  return "frontliner";
}

export function resolveTacticsGroup(
  group: TacticsGroupId | undefined,
  role: string,
): TacticsGroupId {
  return group && isTacticsGroupId(group) ? group : defaultTacticsGroupForRole(role);
}

function mergeTacticsProfiles(
  primary: TacticsGroupDef,
  secondary: TacticsGroupDef | undefined,
): TacticsGroupDef {
  if (!secondary || secondary.id === primary.id) return primary;

  const weightMult: Partial<Record<ActionHead, number>> = {};
  for (const head of ACTION_HEADS) {
    const p = primary.weightMult[head] ?? 1;
    const s = secondary.weightMult[head] ?? 1;
    weightMult[head] = p * (1 + (s - 1) * SECONDARY_BLEND);
  }

  const featureBias = {
    preferCover:
      (primary.featureBias.preferCover ?? 0) +
      (secondary.featureBias.preferCover ?? 0) * SECONDARY_BLEND,
    selfPreservation:
      (primary.featureBias.selfPreservation ?? 0) +
      (secondary.featureBias.selfPreservation ?? 0) * SECONDARY_BLEND,
    focusCaster:
      (primary.featureBias.focusCaster ?? 0) +
      (secondary.featureBias.focusCaster ?? 0) * SECONDARY_BLEND,
  };

  // Primary wins melee/ranged stance; secondary OR-soft skills (flank, heal, control, …).
  const flags = {
    preferRanged: primary.flags.preferRanged,
    preferMelee: primary.flags.preferMelee,
    keepDistance: primary.flags.keepDistance || secondary.flags.keepDistance,
    seekFlank: primary.flags.seekFlank || secondary.flags.seekFlank,
    openWithBuffs: primary.flags.openWithBuffs || secondary.flags.openWithBuffs,
    healAllies: primary.flags.healAllies || secondary.flags.healAllies,
    aggressive: primary.flags.aggressive || secondary.flags.aggressive,
    preferControl: primary.flags.preferControl || secondary.flags.preferControl,
    preferBlast: primary.flags.preferBlast || secondary.flags.preferBlast,
  };

  return {
    id: primary.id,
    label: `${primary.label} + ${secondary.label}`,
    hint: `${primary.hint} Secondary: ${secondary.hint}`,
    weightMult,
    featureBias,
    flags,
  };
}

/** Resolved primary (+ optional secondary blend) profile for scoring. */
export function tacticsGroupOf(actor: TacticsActor): TacticsGroupDef {
  const primaryId = resolveTacticsGroup(actor.tacticsGroup, actor.role);
  const primary = TACTICS_GROUPS[primaryId];
  const secondary =
    actor.tacticsSecondary &&
    isTacticsGroupId(actor.tacticsSecondary) &&
    actor.tacticsSecondary !== primaryId
      ? TACTICS_GROUPS[actor.tacticsSecondary]
      : undefined;
  return mergeTacticsProfiles(primary, secondary);
}

export function groupFlags(actor: TacticsActor): TacticsGroupDef["flags"] {
  return tacticsGroupOf(actor).flags;
}
