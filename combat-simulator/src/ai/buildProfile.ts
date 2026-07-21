/**
 * Resolve class / archetype / capability tags into composed action packets
 * and level-banded search parameters.
 */
import rolePacketsJson from "./modules/role-action-packets.json" with { type: "json" };
import overlaysJson from "./modules/feat-archetype-overlays.json" with { type: "json" };
import levelBandJson from "./modules/level-band-reasoning.json" with { type: "json" };
import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import { living } from "../memory/combatMemory.js";
import type { ActionHead } from "../memory/schemas.js";
import { chebyshev } from "../map/grid.js";
import type { ClassPacket } from "./combatLoop.js";
import { flankApproachPos, isFlanking } from "./flank.js";
import { isFlankedBy, nearestFoe } from "./spatialThreat.js";
import {
  evaluateOwnedFeats,
  lookupFeat,
  type FeatAttemptVerdict,
} from "./featLookup.js";
import {
  archetypeToOverlay,
  resolveArchetypesForActor,
} from "./archetypeLookup.js";

export type RolePacketId =
  | "fighter"
  | "rogue"
  | "cleric"
  | "champion"
  | "ranger_archer"
  | "barbarian"
  | "bard"
  | "monk"
  | "wizard"
  | "monster_brute"
  | "monster_skirmisher"
  | "monster_caster"
  | "monster_controller"
  | "other";

export type MappedHead = ActionHead | "Raise_Shield" | "Trip" | "Tumble_Through" | "Recall_Knowledge";

export type PacketAction = {
  name: string;
  intent: string;
  head: MappedHead;
};

export type ComposedPacket = {
  id: string;
  rolePacket: RolePacketId;
  priority: number;
  score: number;
  actions: [PacketAction, PacketAction, PacketAction];
  overlayIds: string[];
  scoreBreakdown: string[];
  /** Owned combat-feat attempt gates that influenced this packet's score. */
  featAttempts: FeatAttemptVerdict[];
};

export type LevelBand = {
  id: string;
  minLevel: number;
  maxLevel: number;
  maxPacketCandidates: number;
  beamExpand: boolean;
  resourceGate: boolean;
  finishHpThreshold: number;
  resourceAggressiveness: number;
};

export type FeatOverlay = {
  kind: string;
  priorityBonus?: number;
  preferPacketIds?: string[];
  requireOffGuardBias?: boolean;
  reactionHooks?: string[];
  terrainExceptions?: string[];
  resourceGate?: boolean;
  a1Rewrite?: PacketAction;
  a3Rewrite?: PacketAction;
  scoreHints?: Record<string, number>;
};

export type BuildProfile = {
  classId: string;
  rolePacket: RolePacketId;
  capabilities: string[];
  archetypes: string[];
  overlays: { id: string; overlay: FeatOverlay }[];
  levelBand: LevelBand;
  bandBumped: boolean;
  legacyClassPacket: ClassPacket;
};

type RoleDef = {
  archetype: string;
  legacyClassPacket: ClassPacket;
  packets: {
    id: string;
    priority: number;
    actions: { name: string; intent: string; head: string }[];
  }[];
};

const ROLE_PACKETS = rolePacketsJson.rolePackets as Record<string, RoleDef>;
const OVERLAYS = overlaysJson.overlays as Record<string, FeatOverlay>;
const BANDS = levelBandJson.bands as LevelBand[];
const CAP_BUMP = levelBandJson.capabilityBumpThreshold ?? 4;
const WEIGHTS = levelBandJson.scoreWeights as Record<string, number>;

const ROLE_IDS = new Set<string>(Object.keys(ROLE_PACKETS));

function asHead(h: string): MappedHead {
  return h as MappedHead;
}

/** Infer role packet from classId / role / tactics / side. */
export function inferRolePacket(actor: CombatantState): RolePacketId {
  const classId = (actor.classId || actor.role).toLowerCase();
  const r = actor.role.toLowerCase();
  const g = actor.tacticsGroup;
  const side = actor.side;

  if (ROLE_IDS.has(classId) && classId !== "other") {
    return classId as RolePacketId;
  }

  // Enemies: monster role packets first (don't map onto PC fighter/wizard).
  if (side === "enemy") {
    if (r.includes("shaman") || r.includes("priest") || g === "battlefield_control") {
      return "monster_controller";
    }
    if (
      r.includes("wizard") ||
      r.includes("sorcerer") ||
      r.includes("mage") ||
      r.includes("caster") ||
      g === "blaster"
    ) {
      return "monster_caster";
    }
    if (g === "archer" || r.includes("archer") || r.includes("skirmish")) {
      return "monster_skirmisher";
    }
    if (
      r.includes("blade") ||
      r.includes("brute") ||
      r.includes("ogre") ||
      r.includes("troll") ||
      r.includes("hobgoblin") ||
      g === "frontliner"
    ) {
      return "monster_brute";
    }
    return "monster_brute";
  }

  if (r.includes("monk")) return "monk";
  if (r.includes("bard")) return "bard";
  if (r.includes("rogue") || g === "flanker") return "rogue";
  if (r.includes("cleric") || g === "healer") return "cleric";
  if (r.includes("champion")) return "champion";
  if (r.includes("barbarian")) return "barbarian";
  if (r.includes("ranger") || g === "archer") return "ranger_archer";
  if (
    r.includes("wizard") ||
    r.includes("sorcerer") ||
    r.includes("mage") ||
    g === "blaster" ||
    g === "battlefield_control"
  ) {
    return "wizard";
  }
  if (r.includes("fighter") || r.includes("soldier") || r.includes("warrior")) {
    return "fighter";
  }
  if (g === "buff_debuff") return "bard";
  if (g === "frontliner") return "fighter";
  return "other";
}

/** Default capabilities when fixture omits them (role heuristics). */
export function defaultCapabilities(actor: CombatantState, rolePacket: RolePacketId): string[] {
  if (actor.capabilities.length > 0) return [...actor.capabilities];
  const caps: string[] = [];
  const r = actor.role.toLowerCase();
  if (rolePacket === "fighter" || rolePacket === "champion") {
    caps.push("reactive_strike");
    if ((actor.shieldHardness ?? 0) > 0 || r.includes("champion")) caps.push("shield_block");
  }
  if (rolePacket === "rogue") caps.push("sneak_attack");
  if (rolePacket === "monk") caps.push("flurry_of_blows");
  if (rolePacket === "bard") caps.push("inspire_courage");
  if (rolePacket === "cleric" || actor.spells.some((s) => s.kind === "heal")) {
    caps.push("heal_font");
  }
  if (rolePacket === "wizard" || rolePacket === "monster_caster") {
    if (actor.spells.some((s) => s.rank > 0)) caps.push("cast_focus");
  }
  if (rolePacket === "barbarian") caps.push("sudden_charge");
  // Dedication grants (e.g. champion_dedication → reactive_strike) applied in resolveBuildProfile.
  return caps;
}

export function resolveLevelBand(level: number, capabilityCount: number): {
  band: LevelBand;
  bumped: boolean;
} {
  const lvl = Math.max(1, Math.floor(level));
  let band =
    BANDS.find((b) => lvl >= b.minLevel && lvl <= b.maxLevel) ?? BANDS[BANDS.length - 1]!;
  let bumped = false;
  if (capabilityCount >= CAP_BUMP) {
    const idx = BANDS.findIndex((b) => b.id === band.id);
    if (idx >= 0 && idx < BANDS.length - 1) {
      band = BANDS[idx + 1]!;
      bumped = true;
    }
  }
  return { band, bumped };
}

export function resolveOverlays(
  capabilities: string[],
  archetypes: string[],
  catalogEntries?: ReturnType<typeof resolveArchetypesForActor>["entries"],
): { id: string; overlay: FeatOverlay }[] {
  const ids = new Set([...capabilities, ...archetypes]);
  const out: { id: string; overlay: FeatOverlay }[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    const o = OVERLAYS[id];
    if (o && !seen.has(id)) {
      seen.add(id);
      out.push({ id, overlay: o });
    }
  }

  // Catalog archetypes: apply overlayId JSON entry and/or synthetic scoreHints.
  for (const entry of catalogEntries ?? []) {
    if (entry.overlayId && OVERLAYS[entry.overlayId] && !seen.has(entry.overlayId)) {
      seen.add(entry.overlayId);
      out.push({ id: entry.overlayId, overlay: OVERLAYS[entry.overlayId]! });
    }
    if (seen.has(entry.id)) continue;
    const synthetic = archetypeToOverlay(entry);
    if (!synthetic) continue;
    // Skip if JSON overlay already covers the same id/overlayId.
    if (entry.overlayId && seen.has(entry.overlayId)) continue;
    seen.add(entry.id);
    out.push({ id: entry.id, overlay: synthetic as FeatOverlay });
  }

  return out;
}

export function resolveBuildProfile(actor: CombatantState): BuildProfile {
  const rolePacket = inferRolePacket(actor);
  const classId = actor.classId || rolePacket;
  const resolvedArch = resolveArchetypesForActor(actor.archetypes);
  const archetypes = resolvedArch.tags;
  const capabilities = [
    ...defaultCapabilities({ ...actor, archetypes }, rolePacket),
    ...resolvedArch.grantCapabilities,
  ].filter((c, i, arr) => arr.indexOf(c) === i);
  const overlays = resolveOverlays(
    capabilities,
    archetypes,
    resolvedArch.entries,
  );
  const { band, bumped } = resolveLevelBand(actor.level, capabilities.length);
  const roleDef = ROLE_PACKETS[rolePacket] ?? ROLE_PACKETS.other!;
  return {
    classId,
    rolePacket,
    capabilities,
    archetypes,
    overlays,
    levelBand: band,
    bandBumped: bumped,
    legacyClassPacket: roleDef.legacyClassPacket,
  };
}

export type BattlefieldHints = {
  flanked: boolean;
  hasFlankPath: boolean;
  alreadyFlanking: boolean;
  triageNeeded: boolean;
  rangedThreatened: boolean;
  nearestFoeId?: string;
  canCast: boolean;
  canHeal: boolean;
};

export function gatherBattlefieldHints(
  mem: CombatMemory,
  actor: CombatantState,
): BattlefieldHints {
  const foes = living(mem, actor.side === "party" ? "enemy" : "party");
  const allies = living(mem, actor.side);
  const nearest = nearestFoe(mem, actor);
  const flanked = isFlankedBy(mem, actor);
  let alreadyFlanking = false;
  if (nearest) alreadyFlanking = isFlanking(mem, actor, nearest);
  const triageNeeded = allies.some(
    (a) => a.id !== actor.id && a.hp > 0 && a.hp / a.maxHp < 0.35,
  );
  const rangedThreatened = foes.some((f) => {
    const ranged = f.weapons.some((w) => w.kind === "ranged");
    const caster = f.spells.some((s) => s.kind === "attack" || s.kind === "save");
    return (ranged || caster) && chebyshev(actor.pos, f.pos) <= 12;
  });
  return {
    flanked,
    hasFlankPath: !!flankApproachPos(mem, actor),
    alreadyFlanking,
    triageNeeded,
    rangedThreatened,
    nearestFoeId: nearest?.id,
    canCast: actor.spells.some((s) => s.kind === "attack" || s.kind === "save"),
    canHeal: actor.spells.some((s) => s.kind === "heal"),
  };
}

function applyOverlayRewrites(
  actions: PacketAction[],
  overlays: { id: string; overlay: FeatOverlay }[],
): PacketAction[] {
  const out = actions.map((a) => ({ ...a }));
  for (const { overlay } of overlays) {
    if (overlay.a1Rewrite) out[0] = { ...overlay.a1Rewrite };
    if (overlay.a3Rewrite) out[2] = { ...overlay.a3Rewrite };
  }
  return out;
}

function scorePacket(
  packetId: string,
  basePriority: number,
  profile: BuildProfile,
  hints: BattlefieldHints,
  actions: PacketAction[],
  featAttempts: FeatAttemptVerdict[],
): { score: number; breakdown: string[]; overlayIds: string[]; featAttempts: FeatAttemptVerdict[] } {
  let score = basePriority * (WEIGHTS.basePriority ?? 1);
  const breakdown: string[] = [`basePriority=${basePriority}`];
  const overlayIds: string[] = [];
  const attemptsById = new Map(featAttempts.map((f) => [f.featId, f]));
  const packetFeatAttempts: FeatAttemptVerdict[] = [];

  for (const { id, overlay } of profile.overlays) {
    overlayIds.push(id);
    const featGate = attemptsById.get(id);
    if (featGate) packetFeatAttempts.push(featGate);

    const bonus = overlay.priorityBonus ?? 0;
    if (bonus) {
      const prefer = overlay.preferPacketIds?.includes(packetId) ?? false;
      let applied = prefer ? bonus : bonus * 0.25;
      // Catalog gate: do not prefer a packet for a feat that should not be attempted.
      if (featGate && prefer && !featGate.attempt) {
        applied = bonus * 0.1;
        breakdown.push(`featSkip:${id}:${featGate.reason}`);
      } else if (featGate && prefer && featGate.attempt) {
        score += featGate.scoreHint * 0.35 * (WEIGHTS.capabilityHint ?? 1);
        breakdown.push(`featTry:${id}+${featGate.scoreHint.toFixed(1)}`);
      }
      score += applied * (WEIGHTS.overlayPriorityBonus ?? 1);
      breakdown.push(`${id}+${applied.toFixed(1)}`);
    }
    if (overlay.preferPacketIds?.includes(packetId)) {
      if (!featGate || featGate.attempt) {
        score += 1.5;
        breakdown.push(`prefer:${id}`);
      }
    }
    if (overlay.scoreHints) {
      for (const [k, v] of Object.entries(overlay.scoreHints)) {
        let apply = v * 0.35;
        if (k === "flankSetup" && (hints.hasFlankPath || !hints.alreadyFlanking)) apply = v;
        if (k === "offGuardStrike" && hints.alreadyFlanking) apply = v;
        if (k === "triage" || k === "fontHeal") apply = hints.triageNeeded ? v : v * 0.2;
        if (k === "mathBuffFirst") apply = v;
        if (k === "reactionSetup" || k === "eotAdjacent") apply = v * 0.6;
        if (k === "shieldLayer") apply = v * 0.5;
        if (featGate && !featGate.attempt) apply *= 0.25;
        score += apply * (WEIGHTS.capabilityHint ?? 1);
        breakdown.push(`hint:${k}=${apply.toFixed(1)}`);
      }
    }
    if (overlay.requireOffGuardBias && packetId.includes("flank")) {
      score += 1.2;
      breakdown.push("offGuardBias");
    }
  }

  // Catalog feats without an overlay key that prefer this packet.
  for (const verdict of featAttempts) {
    if (profile.overlays.some((o) => o.id === verdict.featId)) continue;
    const feat = lookupFeat(verdict.featId);
    const prefers = feat?.preferPacketIds?.includes(packetId) ?? false;
    if (!prefers) continue;
    packetFeatAttempts.push(verdict);
    if (verdict.attempt) {
      score += verdict.scoreHint * 0.35 * (WEIGHTS.capabilityHint ?? 1);
      breakdown.push(`featTry:${verdict.featId}+${verdict.scoreHint.toFixed(1)}`);
    } else {
      breakdown.push(`featSkip:${verdict.featId}:${verdict.reason}`);
    }
  }

  if (hints.flanked && actions[0]?.head === "Step_away") {
    score += 3;
    breakdown.push("escapeFlank");
  }
  if (hints.triageNeeded && actions.some((a) => a.head === "Heal_ally")) {
    score += WEIGHTS.battlefieldTriage ?? 2;
    breakdown.push("triage");
  }
  if (hints.alreadyFlanking && packetId.includes("flank")) {
    score += 0.5;
    breakdown.push("alreadyFlanking");
  }
  if (!hints.alreadyFlanking && (packetId.includes("flank") || packetId.includes("sneak"))) {
    score += WEIGHTS.battlefieldFlankReady ?? 1.5;
    breakdown.push("seekFlank");
  }
  if (hints.rangedThreatened && actions.some((a) => a.head === "Stride_cover")) {
    score += WEIGHTS.battlefieldRangedLos ?? 0.8;
    breakdown.push("coverVsRanged");
  }
  if (!hints.canCast && actions.some((a) => a.head === "Cast_spell" || a.head === "Cast_cantrip")) {
    score -= 2;
    breakdown.push("noCastPenalty");
  }
  if (!hints.canHeal && actions.some((a) => a.head === "Heal_ally")) {
    score -= 1.5;
    breakdown.push("noHealPenalty");
  }

  // Soft MAP: prefer packets that don't third-strike
  if (actions[2]?.head === "Strike_melee" || actions[2]?.head === "Strike_ranged") {
    score += WEIGHTS.mapWastePenalty ?? -2;
    breakdown.push("a3StrikePenalty");
  }

  if (profile.levelBand.resourceGate) {
    const dumpsFocus = profile.overlays.some((o) => o.overlay.resourceGate);
    if (dumpsFocus && actions.some((a) => a.head === "Cast_spell")) {
      const agg = profile.levelBand.resourceAggressiveness;
      if (agg < 0.5 && !hints.triageNeeded) {
        score += WEIGHTS.resourceDumpPenalty ?? -1.5;
        breakdown.push("resourceGate");
      }
    }
  }

  return { score, breakdown, overlayIds, featAttempts: packetFeatAttempts };
}

/** Compose and rank packet templates for this build + battlefield. */
export function composePackets(
  mem: CombatMemory,
  actor: CombatantState,
  profile: BuildProfile,
  hints: BattlefieldHints,
): ComposedPacket[] {
  const roleDef = ROLE_PACKETS[profile.rolePacket] ?? ROLE_PACKETS.other!;
  const composed: ComposedPacket[] = [];
  const featAttempts = evaluateOwnedFeats(mem, actor, {
    hints,
    capabilities: profile.capabilities,
  });

  for (const raw of roleDef.packets) {
    let actions = raw.actions.slice(0, 3).map((a) => ({
      name: a.name,
      intent: a.intent,
      head: asHead(a.head),
    }));
    while (actions.length < 3) {
      actions.push({
        name: "End turn",
        intent: "No further action",
        head: "End_turn",
      });
    }
    actions = applyOverlayRewrites(actions, profile.overlays);
    const { score, breakdown, overlayIds, featAttempts: packetFeats } = scorePacket(
      raw.id,
      raw.priority,
      profile,
      hints,
      actions,
      featAttempts,
    );
    composed.push({
      id: raw.id,
      rolePacket: profile.rolePacket,
      priority: raw.priority,
      score,
      actions: [actions[0]!, actions[1]!, actions[2]!],
      overlayIds,
      scoreBreakdown: breakdown,
      featAttempts: packetFeats,
    });
  }

  // Cross-role emergency: if triage + heal_font, inject focus_fire_wounded from cleric if missing
  if (
    hints.triageNeeded &&
    profile.capabilities.includes("heal_font") &&
    !composed.some((p) => p.id === "focus_fire_wounded")
  ) {
    const cleric = ROLE_PACKETS.cleric?.packets.find((p) => p.id === "focus_fire_wounded");
    if (cleric) {
      const actions = cleric.actions.map((a) => ({
        name: a.name,
        intent: a.intent,
        head: asHead(a.head),
      }));
      const { score, breakdown, overlayIds, featAttempts: packetFeats } = scorePacket(
        cleric.id,
        cleric.priority + 4,
        profile,
        hints,
        actions,
        featAttempts,
      );
      composed.push({
        id: cleric.id,
        rolePacket: profile.rolePacket,
        priority: cleric.priority + 4,
        score: score + 2,
        actions: [actions[0]!, actions[1]!, actions[2]!],
        overlayIds,
        scoreBreakdown: [...breakdown, "injected:triage"],
        featAttempts: packetFeats,
      });
    }
  }

  return composed.sort((a, b) => b.score - a.score || b.priority - a.priority);
}

/** Beam-expand: rough full-turn utility from action heads + battlefield. */
export function beamScorePacket(
  packet: ComposedPacket,
  hints: BattlefieldHints,
  profile: BuildProfile,
): number {
  let s = packet.score;
  for (const a of packet.actions) {
    if (a.head === "Strike_melee" || a.head === "Strike_ranged") {
      s += (WEIGHTS.beamDamageEv ?? 0.15) * 8;
    }
    if (a.head === "Cast_spell" || a.head === "Cast_cantrip") {
      s += (WEIGHTS.beamDamageEv ?? 0.15) * 10;
    }
    if (a.head === "Heal_ally") {
      s += (WEIGHTS.beamHealEv ?? 0.2) * (hints.triageNeeded ? 20 : 5);
    }
    if (
      a.head === "Raise_Shield" ||
      a.head === "Stride_cover" ||
      a.head === "Step_away" ||
      a.head === "End_turn"
    ) {
      s += WEIGHTS.beamMitigation ?? 0.5;
    }
  }
  if (profile.capabilities.includes("sneak_attack") && hints.alreadyFlanking) {
    s += 2;
  }
  if (profile.capabilities.includes("reactive_strike") && packet.actions[2]?.head === "Raise_Shield") {
    s += 1.2;
  }
  return s;
}

export function selectPacketsForBand(
  composed: ComposedPacket[],
  profile: BuildProfile,
  hints: BattlefieldHints,
): { chosen: ComposedPacket; alternates: ComposedPacket[]; evaluated: ComposedPacket[] } {
  const k = Math.max(1, profile.levelBand.maxPacketCandidates);
  const shortlist = composed.slice(0, Math.max(k, composed.length > 0 ? 1 : 0));
  if (shortlist.length === 0) {
    const fallback: ComposedPacket = {
      id: "generic_pressure",
      rolePacket: "other",
      priority: 1,
      score: 0,
      actions: [
        { name: "Stride", intent: "Position", head: "Stride_close" },
        { name: "Strike", intent: "Offense", head: "Strike_melee" },
        { name: "Mitigate", intent: "EoT", head: "Raise_Shield" },
      ],
      overlayIds: [],
      scoreBreakdown: ["fallback"],
      featAttempts: [],
    };
    return { chosen: fallback, alternates: [], evaluated: [fallback] };
  }

  let evaluated = shortlist;
  if (profile.levelBand.beamExpand) {
    evaluated = shortlist
      .map((p) => ({
        ...p,
        score: beamScorePacket(p, hints, profile),
        scoreBreakdown: [...p.scoreBreakdown, `beam=${beamScorePacket(p, hints, profile).toFixed(1)}`],
      }))
      .sort((a, b) => b.score - a.score);
  }

  const chosen = evaluated[0]!;
  const alternates = evaluated.slice(1);
  return { chosen, alternates, evaluated };
}

export function hasCapability(actor: CombatantState, cap: string): boolean {
  const profile = resolveBuildProfile(actor);
  return profile.capabilities.includes(cap) || profile.archetypes.includes(cap);
}

export function roleArchetypeLabel(rolePacket: RolePacketId): string {
  return ROLE_PACKETS[rolePacket]?.archetype ?? "Generic";
}
