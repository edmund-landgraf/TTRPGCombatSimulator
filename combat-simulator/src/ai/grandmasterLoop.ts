/**
 * Programmatic tactical engine entry: parse Grandmaster Combat Loop Core Schema
 * and run Steps 1→6 at the start of every combat turn, producing an explicit
 * 3-action budget using schema node names.
 */
import schemaJson from "./modules/grandmaster-combat-loop-core.json" with { type: "json" };
import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import { living } from "../memory/combatMemory.js";
import { cellId } from "../memory/schemas.js";
import { chebyshev, hasCover } from "../map/grid.js";
import { canCastSpell } from "../rules/pf2e/spell.js";
import type { Candidate } from "./scorer.js";
import { candidateKey, rankCandidates } from "./scorer.js";
import { flankApproachPos, isFlanking } from "./flank.js";
import {
  alreadyHasCover,
  heavyStatusPenalty,
  nearFinishTarget,
  persistentThreat,
  precomputeReactions,
  threatenedByRangedLos,
  weakestSaveFoe,
  type ClassPacket,
  type ReactionPlan,
} from "./combatLoop.js";
import type { CombatStateSnapshot } from "./combatStateParser.js";
import {
  breakFlankStepPos,
  canReachAdjacentInOneStride,
  isFlankedBy,
  nearestFoe,
  pathCells,
  pathCrossesDifficult,
  wallAnchorStepPos,
} from "./spatialThreat.js";
import {
  composePackets,
  gatherBattlefieldHints,
  resolveBuildProfile,
  roleArchetypeLabel,
  selectPacketsForBand,
  type BuildProfile,
  type ComposedPacket,
  type MappedHead,
} from "./buildProfile.js";

export type GrandmasterSchema = typeof schemaJson;

export const GRANDMASTER_SCHEMA: GrandmasterSchema = schemaJson;

export type ActionBudgetSlot = {
  actionIndex: 1 | 2 | 3;
  /** Exact schema node name (priorityAction / action / overrideAction / class matrix). */
  schemaNode: string;
  intent: string;
  /** Best-effort map onto simulator action heads. */
  mappedHead: MappedHead;
  detail: string;
};

export type StepEvaluation = {
  step: 1 | 2 | 3 | 4 | 5 | 6;
  label: string;
  findings: string[];
  activeNodes: string[];
};

export type PacketSelectionLog = {
  rolePacket: string;
  roleArchetype: string;
  levelBand: string;
  bandBumped: boolean;
  capabilities: string[];
  archetypes: string[];
  overlays: string[];
  chosenPacketId: string;
  chosenScore: number;
  alternates: { id: string; score: number }[];
};

export type GrandmasterTurnPlan = {
  schemaName: string;
  version: string;
  systemIntent: string;
  round: number;
  actorId: string;
  actorName: string;
  classPacket: ClassPacket;
  buildProfile?: BuildProfile;
  packetSelection?: PacketSelectionLog;
  steps: StepEvaluation[];
  actionBudget: ActionBudgetSlot[];
  mapPolicy: string;
  reactions: ReactionPlan;
  targetId?: string;
  targetArchetype?: string;
  /** Live parser feed used for this plan (if available). */
  stateFeed?: CombatStateSnapshot;
};

function foesOf(mem: CombatMemory, actor: CombatantState): CombatantState[] {
  return living(mem, actor.side === "party" ? "enemy" : "party");
}

function classifyTarget(foe: CombatantState): {
  archetype: string;
  weakestDefense: string;
  recommended: string;
} {
  const rules = GRANDMASTER_SCHEMA.step3_TacticalTargetSelection.arbitrageRules;
  const r = foe.role.toLowerCase();
  if (
    r.includes("animal") ||
    r.includes("mindless") ||
    r.includes("berserker") ||
    r.includes("beast") ||
    r.includes("zombie")
  ) {
    const rule = rules[2]!;
    return {
      archetype: rule.targetArchetype,
      weakestDefense: rule.weakestDefense,
      recommended: rule.recommendedActions[0]!,
    };
  }
  if (
    r.includes("wizard") ||
    r.includes("shaman") ||
    r.includes("sorcerer") ||
    r.includes("mage") ||
    r.includes("archer")
  ) {
    const rule = rules[1]!;
    return {
      archetype: rule.targetArchetype,
      weakestDefense: rule.weakestDefense,
      recommended: rule.recommendedActions[0]!,
    };
  }
  const rule = rules[0]!;
  return {
    archetype: rule.targetArchetype,
    weakestDefense: rule.weakestDefense,
    recommended: rule.recommendedActions[0]!,
  };
}

function slot(
  actionIndex: 1 | 2 | 3,
  schemaNode: string,
  intent: string,
  mappedHead: ActionBudgetSlot["mappedHead"],
  detail: string,
): ActionBudgetSlot {
  return { actionIndex, schemaNode, intent, mappedHead, detail };
}

function packetToMatrix(chosen: ComposedPacket): {
  a1: { name: string; intent: string; head: MappedHead };
  a2: { name: string; intent: string; head: MappedHead };
  a3: { name: string; intent: string; head: MappedHead };
} {
  return {
    a1: {
      name: chosen.actions[0].name,
      intent: chosen.actions[0].intent,
      head: chosen.actions[0].head,
    },
    a2: {
      name: chosen.actions[1].name,
      intent: chosen.actions[1].intent,
      head: chosen.actions[1].head,
    },
    a3: {
      name: chosen.actions[2].name,
      intent: chosen.actions[2].intent,
      head: chosen.actions[2].head,
    },
  };
}

/**
 * Parse schema and run Steps 1–6. Returns findings + explicit 3-action budget.
 */
export function runGrandmasterLoop(
  mem: CombatMemory,
  actor: CombatantState,
): GrandmasterTurnPlan {
  const seq = GRANDMASTER_SCHEMA.combatLoopSequence;
  const steps: StepEvaluation[] = [];
  const budget: ActionBudgetSlot[] = [];
  const buildProfile = resolveBuildProfile(actor);
  const packet = buildProfile.legacyClassPacket;
  const foes = foesOf(mem, actor);
  const nearest = nearestFoe(mem, actor);
  let target = nearest;
  let targetArchetype: string | undefined;
  let packetSelection: PacketSelectionLog | undefined;
  const state = mem.activeCombatState?.roundTracking.activeActorId === actor.id
    ? mem.activeCombatState
    : undefined;
  const agile = state?.actionBudgetTracker.agileWeaponEquipped ?? false;
  let mapPolicy = agile
    ? "MAP 0 / −4 / −8 (agile) — never third-strike under normal MAP unless finishing"
    : "MAP 0 / −5 / −10 — never third-strike under normal MAP unless finishing a near-dead foe";

  // ─── Step 1: Status Assessment (prefer live parser feed) ───
  const s1Findings: string[] = [];
  const s1Nodes: string[] = [];
  const persist = persistentThreat(actor);
  const statusPen = heavyStatusPenalty(actor);
  let statusOverride: "recovery" | "defensive" | null = null;

  if (state) {
    s1Findings.push(
      `parser feed HP ${state.characterVitals.currentHP}/${state.characterVitals.maxHP} effAC ${state.characterVitals.effectiveAc}`,
    );
    for (const p of state.activeStatusEffects.persistentDamage) {
      if (p.value > 0 && state.characterVitals.currentHP <= p.value * 2) {
        s1Findings.push(`parser: lethal persistent ${p.type}=${p.value}`);
        statusOverride = "recovery";
      }
    }
    for (const d of state.activeStatusEffects.statusDebuffs) {
      if (
        (d.name === "Frightened" || d.name === "Sickened") &&
        typeof d.value === "number" &&
        d.value >= 2
      ) {
        s1Findings.push(`parser: ${d.name}=${d.value}`);
        if (!statusOverride) statusOverride = "defensive";
      }
    }
  }

  if (persist) {
    const node =
      GRANDMASTER_SCHEMA.step1_StatusAssessment.directives[0]!.overrideAction;
    s1Findings.push(
      `persistent ${persist.condition.name} tick=${persist.tick}, hp=${actor.hp} ≤ 2×tick — CRITICAL`,
    );
    s1Nodes.push(node);
    statusOverride = "recovery";
  }
  if (statusPen) {
    const node =
      GRANDMASTER_SCHEMA.step1_StatusAssessment.directives[1]!.overrideAction;
    s1Findings.push(`${statusPen.name} ${statusPen.value ?? 2}+ — accuracy tanked`);
    s1Nodes.push(node);
    if (!statusOverride) statusOverride = "defensive";
  }
  if (statusOverride === "recovery") {
    s1Nodes.push(
      GRANDMASTER_SCHEMA.step1_StatusAssessment.directives[0]!.overrideAction,
    );
  }
  if (statusOverride === "defensive") {
    s1Nodes.push(
      GRANDMASTER_SCHEMA.step1_StatusAssessment.directives[1]!.overrideAction,
    );
  }
  if (!s1Findings.length) s1Findings.push("no life-threatening status overrides");
  steps.push({ step: 1, label: seq[0]!, findings: s1Findings, activeNodes: s1Nodes });

  // ─── Step 2: Spatiotemporal Positioning ───
  const s2Findings: string[] = [];
  const s2Nodes: string[] = [];
  const flanked = state?.spatialCoordinates.isFlanked ?? isFlankedBy(mem, actor);
  let mustStep = false;
  let mustTumble = false;

  if (state) {
    s2Findings.push(
      `@ ${state.spatialCoordinates.currentGridSquare} flanked=${flanked} wall=${state.spatialCoordinates.isAnchoredToWall} cover=${state.spatialCoordinates.nearestCoverSquare ?? "—"}`,
    );
  }

  if (flanked) {
    const node =
      GRANDMASTER_SCHEMA.step2_SpatiotemporalPositioning.directives.flankingEvasion[0]!
        .priorityAction;
    s2Findings.push("off-guard — enemies on opposite sides/corners");
    s2Nodes.push(node);
    mustStep = !!breakFlankStepPos(mem, actor);
    if (!mustStep) {
      const tumble =
        GRANDMASTER_SCHEMA.step2_SpatiotemporalPositioning.directives.flankingEvasion[1]!
          .priorityAction;
      s2Nodes.push(tumble);
      mustTumble = true;
    }
  }

  if (nearest) {
    const approach = pathCells(
      mem,
      actor.pos,
      nearest.pos,
      actor.speedCells * 4,
      actor.id,
    );
    if (approach && pathCrossesDifficult(mem.grid, approach)) {
      const logic =
        GRANDMASTER_SCHEMA.step2_SpatiotemporalPositioning.directives
          .hazardAndTerrainAvoidance[0]!.logic;
      s2Findings.push("path crosses difficult terrain");
      s2Nodes.push(logic);
      if (!canReachAdjacentInOneStride(mem, actor, nearest)) {
        s2Findings.push("abort melee crawl — prefer ranged/spell/ready");
      }
    }
    const stridePath = pathCells(
      mem,
      actor.pos,
      nearest.pos,
      actor.speedCells,
      actor.id,
    );
    if (stridePath) {
      const hazCells = stridePath
        .slice(1)
        .filter((p) => mem.grid.walkable.get(cellId(p))?.tags.includes("hazardous"));
      if (hazCells.length) {
        const logic =
          GRANDMASTER_SCHEMA.step2_SpatiotemporalPositioning.directives
            .hazardAndTerrainAvoidance[1]!.logic;
        s2Findings.push(`hazardous cells on approach: ${hazCells.length}`);
        s2Nodes.push(logic);
      }
    }
  }
  if (!s2Findings.length) s2Findings.push("spatial posture acceptable");
  steps.push({ step: 2, label: seq[1]!, findings: s2Findings, activeNodes: s2Nodes });

  // ─── Step 3: Tactical Target Selection ───
  const s3Findings: string[] = [];
  const s3Nodes: string[] = [];
  if (target) {
    const profile = classifyTarget(target);
    targetArchetype = profile.archetype;
    s3Findings.push(
      `primary target ${target.id} (${target.role}) → ${profile.archetype}; weak ${profile.weakestDefense}`,
    );
    s3Nodes.push(...GRANDMASTER_SCHEMA.step3_TacticalTargetSelection.arbitrageRules
      .find((r) => r.targetArchetype === profile.archetype)!
      .recommendedActions);
    const weakSave = weakestSaveFoe(mem, actor);
    if (weakSave && weakSave.id !== target.id && packet === "wizard") {
      s3Findings.push(
        `save arbitrage retarget ${weakSave.id} (save ${weakSave.saveBonus} < ${target.saveBonus})`,
      );
      target = weakSave;
      targetArchetype = classifyTarget(weakSave).archetype;
    }
  } else {
    s3Findings.push("no living foes");
  }
  steps.push({ step: 3, label: seq[2]!, findings: s3Findings, activeNodes: s3Nodes });

  // ─── Step 4: Action Packet Execution (compose + level-band search) ───
  const s4Findings: string[] = [];
  const s4Nodes: string[] = [];
  const hints = gatherBattlefieldHints(mem, actor);
  if (target && isFlanking(mem, actor, target)) hints.alreadyFlanking = true;
  const composed = composePackets(buildProfile, hints);
  const { chosen, alternates } = selectPacketsForBand(composed, buildProfile, hints);
  packetSelection = {
    rolePacket: buildProfile.rolePacket,
    roleArchetype: roleArchetypeLabel(buildProfile.rolePacket),
    levelBand: buildProfile.levelBand.id,
    bandBumped: buildProfile.bandBumped,
    capabilities: buildProfile.capabilities,
    archetypes: buildProfile.archetypes,
    overlays: buildProfile.overlays.map((o) => o.id),
    chosenPacketId: chosen.id,
    chosenScore: chosen.score,
    alternates: alternates.map((a) => ({ id: a.id, score: a.score })),
  };
  const matrix = packetToMatrix(chosen);
  s4Findings.push(
    `role=${buildProfile.rolePacket} (${packetSelection.roleArchetype}) band=${buildProfile.levelBand.id}` +
      (buildProfile.bandBumped ? " [bumped]" : ""),
  );
  s4Findings.push(
    `caps=[${buildProfile.capabilities.join(",") || "—"}] overlays=[${packetSelection.overlays.join(",") || "—"}]`,
  );
  s4Findings.push(
    `chosen packet: ${chosen.id} score=${chosen.score.toFixed(1)}` +
      (alternates.length
        ? ` | rejected: ${alternates.map((a) => `${a.id}@${a.score.toFixed(1)}`).join(", ")}`
        : ""),
  );
  s4Findings.push(
    `class packet: ${packet} (${GRANDMASTER_SCHEMA.step4_ActionPacketExecution.description})`,
  );
  s4Nodes.push(chosen.id, matrix.a1.name, matrix.a2.name, matrix.a3.name);

  if (statusOverride === "recovery") {
    const recover =
      GRANDMASTER_SCHEMA.step1_StatusAssessment.directives[0]!.overrideAction;
    budget.push(
      slot(1, recover, "Stabilize vs persistent", "Heal_ally", `self-aid hp ${actor.hp}`),
      slot(2, recover, "Second recovery action", "Heal_ally", "continue assisted recovery"),
      slot(
        3,
        GRANDMASTER_SCHEMA.step5_EndOfTurnMitigation.options[0]!.action,
        "Mitigate after recovery",
        "Step_away",
        "defensive close",
      ),
    );
  } else if (statusOverride === "defensive") {
    const def =
      GRANDMASTER_SCHEMA.step1_StatusAssessment.directives[1]!.overrideAction;
    budget.push(
      slot(1, def, "Clear/wait out penalty", "Step_away", statusPen!.name),
      slot(2, def, "Defensive/buff pivot", "Stride_cover", "avoid ranked offense"),
      slot(
        3,
        GRANDMASTER_SCHEMA.step5_EndOfTurnMitigation.options[1]!.action,
        "Layer defense",
        "Stride_cover",
        "Take Cover",
      ),
    );
  } else if (mustStep || mustTumble) {
    const stepNode =
      GRANDMASTER_SCHEMA.step2_SpatiotemporalPositioning.directives.flankingEvasion[0]!
        .priorityAction;
    const tumbleNode =
      GRANDMASTER_SCHEMA.step2_SpatiotemporalPositioning.directives.flankingEvasion[1]!
        .priorityAction;
    budget.push(
      slot(
        1,
        mustStep ? stepNode : tumbleNode,
        "Break flanking line (CRITICAL)",
        mustStep ? "Step_away" : "Tumble_Through",
        mustStep ? "Step to safe square" : "Tumble Through (not yet simulated — Step proxy)",
      ),
      slot(2, matrix.a2.name, matrix.a2.intent, matrix.a2.head, `vs ${target?.id ?? "?"}`),
      slot(3, matrix.a3.name, matrix.a3.intent, matrix.a3.head, "press or mitigate"),
    );
  } else {
    let a1 = matrix.a1;
    if (
      (buildProfile.rolePacket === "fighter" || buildProfile.rolePacket === "champion") &&
      target
    ) {
      const flank = flankApproachPos(mem, actor);
      if (isFlanking(mem, actor, target)) {
        a1 = {
          name: matrix.a2.name,
          intent: "Already off-guard — fish crit at MAP 0",
          head: "Strike_melee",
        };
      } else if (!flank && a1.head === "Stride_close") {
        a1 = {
          name: "Stride to engage",
          intent: matrix.a1.intent,
          head: "Stride_close",
        };
      }
    }
    const hasSaveOrAttack = actor.spells.some(
      (s) =>
        (s.kind === "save" || s.kind === "attack") &&
        target &&
        canCastSpell(mem, actor, target, s),
    );
    let a2 = matrix.a2;
    let a3 = matrix.a3;
    if (
      (buildProfile.rolePacket === "wizard" ||
        buildProfile.rolePacket === "monster_caster") &&
      !hasSaveOrAttack
    ) {
      a2 = {
        name: "Strike",
        intent: "No legal 2-action spell — ranged/cantrip pressure",
        head: actor.weapons.some((w) => w.kind === "ranged") ? "Strike_ranged" : "Cast_cantrip",
      };
      a3 = {
        name: GRANDMASTER_SCHEMA.step5_EndOfTurnMitigation.options[1]!.action,
        intent: "Mitigate",
        head: "Stride_cover",
      };
    }
    if (buildProfile.rolePacket === "bard") {
      const support = actor.spells.find((s) => s.tactic === "support" || s.tactic === "control");
      if (!support && buildProfile.capabilities.includes("inspire_courage") === false) {
        a1 = {
          name: "Cast cantrip / control",
          intent: matrix.a1.intent,
          head: "Cast_cantrip",
        };
      }
    }
    // Rogue without flank path: prefer ranged poke if chosen flank packet
    if (
      buildProfile.rolePacket === "rogue" &&
      chosen.id.includes("flank") &&
      target &&
      !isFlanking(mem, actor, target) &&
      !flankApproachPos(mem, actor)
    ) {
      a1 = { name: "Hold / cover", intent: "No flank path — stay back", head: "Stride_cover" };
      a2 = { name: "Strike ranged", intent: "Bow while waiting for flank", head: "Strike_ranged" };
      a3 = { name: "End", intent: "Preserve", head: "End_turn" };
    }

    budget.push(
      slot(1, a1.name, a1.intent, a1.head, `packet ${chosen.id}`),
      slot(2, a2.name, a2.intent, a2.head, target ? `target ${target.id}` : "no target"),
      slot(3, a3.name, a3.intent, a3.head, "action 3"),
    );
  }
  steps.push({ step: 4, label: seq[3]!, findings: s4Findings, activeNodes: s4Nodes });

  // ─── Step 5: End of Turn Optimization ───
  const s5Findings: string[] = [];
  const s5Nodes: string[] = [];
  const opts = GRANDMASTER_SCHEMA.step5_EndOfTurnMitigation.options;
  const last = budget[2]!;
  const meleeThreat = foes.some((f) => chebyshev(actor.pos, f.pos) <= 1);
  const needCover = threatenedByRangedLos(mem, actor) && !alreadyHasCover(mem, actor);
  const anchor = wallAnchorStepPos(mem, actor);

  const isOffensiveHead = (h: ActionBudgetSlot["mappedHead"]) =>
    h === "Strike_melee" || h === "Strike_ranged" || h === "Trip";

  if (isOffensiveHead(last.mappedHead)) {
    // Never plan a third Strike under MAP — rewrite action 3 to mitigation node.
    if (needCover) {
      last.schemaNode = opts[1]!.action;
      last.intent = opts[1]!.reasoning;
      last.mappedHead = "Stride_cover";
      last.detail = "EoT Take Cover (rewrite — MAP constraint)";
      s5Nodes.push(opts[1]!.action);
      s5Findings.push("rewrote action 3 → Take Cover (ranged LOS)");
    } else if (meleeThreat && anchor) {
      last.schemaNode = opts[0]!.action;
      last.intent = opts[0]!.reasoning;
      last.mappedHead = "Step_away";
      last.detail = "EoT Anchor to Wall/Corner";
      s5Nodes.push(opts[0]!.action);
      s5Findings.push("rewrote action 3 → Anchor to Wall/Corner");
    } else {
      last.schemaNode = opts[2]!.action;
      last.intent = opts[2]!.reasoning;
      last.mappedHead = "Raise_Shield";
      last.detail = "EoT Raise a Shield / End (no third strike)";
      s5Nodes.push(opts[2]!.action);
      s5Findings.push("rewrote action 3 → Raise a Shield (MAP: no third strike)");
    }
    mapPolicy =
      "enforced: action 3 is mitigation — never third-strike under normal MAP";
  } else {
    s5Findings.push(`action 3 already mitigation/utility: ${last.schemaNode}`);
    s5Nodes.push(last.schemaNode);
  }
  if (hasCover(mem.grid, actor.pos)) s5Findings.push("already in cover");
  steps.push({ step: 5, label: seq[4]!, findings: s5Findings, activeNodes: s5Nodes });

  // ─── Step 6: Off-Turn Reaction Pre-Computation ───
  const reactions = precomputeReactions(actor);
  const s6Nodes = GRANDMASTER_SCHEMA.step6_OffTurnReactionPreComputation.triggers.map(
    (t) => t.name,
  );
  const s6Findings = [
    reactions.note,
    ...GRANDMASTER_SCHEMA.step6_OffTurnReactionPreComputation.triggers.map(
      (t) => `${t.name}: ${t.triggerCondition}`,
    ),
  ];
  steps.push({ step: 6, label: seq[5]!, findings: s6Findings, activeNodes: s6Nodes });

  return {
    schemaName: GRANDMASTER_SCHEMA.schemaName,
    version: GRANDMASTER_SCHEMA.version,
    systemIntent: GRANDMASTER_SCHEMA.systemIntent,
    round: mem.round,
    actorId: actor.id,
    actorName: actor.name,
    classPacket: packet,
    buildProfile,
    packetSelection,
    steps,
    actionBudget: budget,
    mapPolicy,
    reactions,
    targetId: target?.id,
    targetArchetype,
    stateFeed: state,
  };
}

/** Pretty-print plan for CLI / walkthrough. */
export function formatGrandmasterPlan(plan: GrandmasterTurnPlan): string[] {
  const lines: string[] = [];
  const ps = plan.packetSelection;
  const roleTag = ps
    ? `${ps.rolePacket}/${ps.chosenPacketId}@${ps.levelBand}`
    : plan.classPacket;
  lines.push(
    `  GM-LOOP v${plan.version} [${roleTag}] target=${plan.targetId ?? "—"} (${plan.targetArchetype ?? "n/a"})`,
  );
  if (ps) {
    lines.push(
      `  BUILD: caps=[${ps.capabilities.join(",") || "—"}] overlays=[${ps.overlays.join(",") || "—"}]` +
        (ps.bandBumped ? " band↑" : ""),
    );
    if (ps.alternates.length) {
      lines.push(
        `  REJECTED: ${ps.alternates.map((a) => `${a.id}@${a.score.toFixed(1)}`).join(", ")}`,
      );
    }
  }
  for (const s of plan.steps) {
    lines.push(`  ${s.label}`);
    for (const f of s.findings) lines.push(`    · ${f}`);
    if (s.activeNodes.length) {
      lines.push(`    nodes: ${s.activeNodes.map((n) => `"${n}"`).join("; ")}`);
    }
  }
  lines.push(`  MAP policy: ${plan.mapPolicy}`);
  lines.push("  3-ACTION BUDGET:");
  for (const a of plan.actionBudget) {
    lines.push(
      `    A${a.actionIndex}: "${a.schemaNode}" → ${a.mappedHead} — ${a.intent}${a.detail ? ` (${a.detail})` : ""}`,
    );
  }
  lines.push(`  REACTIONS: ${plan.reactions.note}`);
  return lines;
}

/** Map a budget slot onto the best live candidate (for guided execution). */
export function preferCandidateForSlot(
  mem: CombatMemory,
  actor: CombatantState,
  slot: ActionBudgetSlot,
  visited: Set<string>,
  targetId?: string,
): Candidate | null {
  const ranked = rankCandidates(mem, actor, visited);
  const head = slot.mappedHead;

  const raiseOrEnd = (): Candidate | null => {
    const cover = ranked.find((c) => c.head === "Stride_cover");
    if (cover) return cover;
    const step = ranked.find((c) => c.head === "Step_away");
    if (step) return step;
    return { head: "End_turn", score: 1 };
  };

  if (head === "Raise_Shield" || head === "Recall_Knowledge" || head === "Tumble_Through") {
    if (head === "Tumble_Through") {
      const step = ranked.find((c) => c.head === "Step_away");
      if (step) return step;
    }
    if (head === "Recall_Knowledge") {
      const cast = ranked.find(
        (c) =>
          (c.head === "Cast_spell" || c.head === "Cast_cantrip") &&
          (!targetId || ("targetId" in c && c.targetId === targetId)),
      );
      if (cast) return cast;
    }
    return raiseOrEnd();
  }

  if (head === "Trip") {
    const stride = ranked.find((c) => c.head === "Stride_close");
    if (stride) return stride;
    const strike = ranked.find(
      (c) =>
        c.head === "Strike_melee" && (!targetId || c.targetId === targetId),
    );
    return strike ?? null;
  }

  const match = ranked.find((c) => {
    if (c.head !== head) return false;
    if (
      targetId &&
      (c.head === "Strike_melee" ||
        c.head === "Strike_ranged" ||
        c.head === "Cast_cantrip" ||
        c.head === "Cast_spell" ||
        c.head === "Heal_ally") &&
      "targetId" in c
    ) {
      // Heal_ally self for recovery packets
      if (c.head === "Heal_ally" && slot.schemaNode.includes("Recovery")) {
        return c.targetId === actor.id || c.targetId === targetId;
      }
      return c.targetId === targetId || c.head === "Heal_ally";
    }
    return true;
  });
  if (match) return match;

  // Soft fallbacks
  if (head === "Strike_melee") {
    return ranked.find((c) => c.head === "Strike_ranged") ?? null;
  }
  if (head === "Cast_spell") {
    return (
      ranked.find((c) => c.head === "Cast_cantrip") ??
      ranked.find((c) => c.head === "Strike_ranged") ??
      null
    );
  }
  if (head === "Heal_ally") {
    return ranked.find((c) => c.head === "Heal_ally") ?? null;
  }
  return null;
}

export function budgetSlotForAction(
  plan: GrandmasterTurnPlan,
  actionSlot: number,
): ActionBudgetSlot | undefined {
  return plan.actionBudget.find((a) => a.actionIndex === actionSlot);
}

/** Guide pick: prefer planned candidate if tactics-legal; else null (caller uses scorer). */
export function guidedChoice(
  mem: CombatMemory,
  actor: CombatantState,
  plan: GrandmasterTurnPlan,
  actionSlot: number,
  visited: Set<string>,
): Candidate | null {
  const slot = budgetSlotForAction(plan, actionSlot);
  if (!slot) return null;
  const preferred = preferCandidateForSlot(mem, actor, slot, visited, plan.targetId);
  if (!preferred) return null;
  // Block illegal third strikes even if plan drifted.
  if (
    (preferred.head === "Strike_melee" || preferred.head === "Strike_ranged") &&
    actor.map >= 2
  ) {
    const tgt =
      "targetId" in preferred ? mem.combatants.get(preferred.targetId) : undefined;
    if (!tgt || !nearFinishTarget(tgt)) {
      return preferCandidateForSlot(
        mem,
        actor,
        {
          ...slot,
          mappedHead: "Raise_Shield",
          schemaNode: GRANDMASTER_SCHEMA.step5_EndOfTurnMitigation.options[2]!.action,
        },
        visited,
        plan.targetId,
      );
    }
  }
  return preferred;
}

export { candidateKey };

/** Append GM plans into tactics markdown. */
export function formatGrandmasterPlansMarkdown(plans: GrandmasterTurnPlan[]): string {
  if (!plans.length) return "";
  const lines: string[] = [
    "",
    "# Grandmaster Combat Loop plans",
    "",
    `Schema: **${GRANDMASTER_SCHEMA.schemaName}** v${GRANDMASTER_SCHEMA.version}`,
    "",
    GRANDMASTER_SCHEMA.systemIntent,
    "",
  ];
  for (const p of plans) {
    lines.push(`## Round ${p.round} — ${p.actorId} (${p.actorName})`);
    lines.push("");
    lines.push(...formatGrandmasterPlan(p).map((l) => l.replace(/^  /, "")));
    lines.push("");
  }
  return lines.join("\n");
}
