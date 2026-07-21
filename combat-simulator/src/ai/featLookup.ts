/**
 * Runtime feat catalog lookup + attempt gating for Grandmaster Step 4 / tactics.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CombatantState, CombatMemory } from "../memory/combatMemory.js";
import { COMBAT_FEAT_STUBS, type CombatFeatStub } from "../ingest/feats/combatStubs.js";
import type { FeatCatalogEntry } from "../ingest/feats/ingestFeats.js";
import { chebyshev } from "../map/grid.js";
import { living } from "../memory/combatMemory.js";

/** Subset of BattlefieldHints used for attempt gates (avoids circular import). */
export type FeatGateHints = {
  alreadyFlanking: boolean;
  hasFlankPath: boolean;
  triageNeeded: boolean;
};

export type FeatAttemptVerdict = {
  featId: string;
  attempt: boolean;
  scoreHint: number;
  reason: string;
};

export type FeatAttemptContext = {
  hints: FeatGateHints;
  /** Resolved capability tags (include role defaults from BuildProfile). */
  capabilities?: string[];
  /** 1–3 action slot being considered; omit for whole-turn scoring. */
  actionSlot?: number;
  /** True when evaluating the packet's third action. */
  isThirdAction?: boolean;
  map?: number;
  actionsLeft?: number;
  reactionAvailable?: boolean;
  /** Defaults to actor.isShieldRaised. */
  shieldRaised?: boolean;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "../..");

let cachedCatalog: FeatCatalogEntry[] | null = null;

function stubToCatalogEntry(stub: CombatFeatStub): FeatCatalogEntry {
  return {
    id: stub.id,
    name: stub.name,
    aonId: null,
    aonUrl: null,
    summary: "",
    level: null,
    traits: [],
    matchedName: null,
    overlayId: stub.overlayId,
    preferPacketIds: stub.preferPacketIds,
    head: stub.head,
    actions: stub.actions,
    frequency: stub.frequency,
    effectClass: stub.effectClass,
    needsOffGuard: stub.needsOffGuard,
    needsRaisedShield: stub.needsRaisedShield,
    needsAdjacentFoe: stub.needsAdjacentFoe,
    needsReactionAvailable: stub.needsReactionAvailable,
    minActions: stub.minActions,
    maxMap: stub.maxMap,
    avoidThirdStrike: stub.avoidThirdStrike,
    scoreHint: stub.scoreHint,
  };
}

/** Load data/feats/catalog.json, or fall back to in-source combat stubs. */
export function loadFeatCatalog(forceReload = false): FeatCatalogEntry[] {
  if (cachedCatalog && !forceReload) return cachedCatalog;

  const candidates = [
    path.join(process.cwd(), "data", "feats", "catalog.json"),
    path.join(PACKAGE_ROOT, "data", "feats", "catalog.json"),
  ];

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as {
        feats?: FeatCatalogEntry[];
      };
      if (Array.isArray(raw.feats) && raw.feats.length > 0) {
        cachedCatalog = raw.feats;
        return cachedCatalog;
      }
    } catch {
      // fall through to stubs
    }
  }

  cachedCatalog = COMBAT_FEAT_STUBS.map(stubToCatalogEntry);
  return cachedCatalog;
}

export function lookupFeat(idOrName: string): FeatCatalogEntry | undefined {
  const key = idOrName.trim().toLowerCase();
  const catalog = loadFeatCatalog();
  return catalog.find(
    (f) =>
      f.id === key ||
      f.name.toLowerCase() === key ||
      (f.matchedName && f.matchedName.toLowerCase() === key) ||
      (f.overlayId && f.overlayId === key),
  );
}

function ownedIds(actor: CombatantState, capabilities?: string[]): Set<string> {
  const caps = capabilities ?? actor.capabilities;
  return new Set([...caps, ...actor.archetypes, ...actor.capabilities]);
}

/** Catalog feats the actor owns (capability / archetype / overlay id match). */
export function featsFor(
  actor: CombatantState,
  capabilities?: string[],
): FeatCatalogEntry[] {
  const owned = ownedIds(actor, capabilities);
  return loadFeatCatalog().filter(
    (f) => owned.has(f.id) || (f.overlayId != null && owned.has(f.overlayId)),
  );
}

function hasAdjacentFoe(mem: CombatMemory, actor: CombatantState): boolean {
  const foes = living(mem, actor.side === "party" ? "enemy" : "party");
  return foes.some((f) => chebyshev(actor.pos, f.pos) <= 1);
}

/**
 * Decide whether an owned combat feat should influence this turn / slot.
 * Legal + utility gate — does not invent new executable heads.
 */
export function shouldAttemptFeat(
  mem: CombatMemory,
  actor: CombatantState,
  featId: string,
  ctx: FeatAttemptContext,
): FeatAttemptVerdict {
  const feat = lookupFeat(featId);
  if (!feat) {
    return {
      featId,
      attempt: false,
      scoreHint: 0,
      reason: "unknown feat (not in combat catalog)",
    };
  }

  const owned = ownedIds(actor, ctx.capabilities);
  if (!owned.has(feat.id) && !(feat.overlayId && owned.has(feat.overlayId))) {
    return {
      featId: feat.id,
      attempt: false,
      scoreHint: 0,
      reason: "not owned",
    };
  }

  const map = ctx.map ?? actor.map;
  const actionsLeft = ctx.actionsLeft ?? actor.actionsLeft;
  const reactionAvailable = ctx.reactionAvailable ?? actor.reactionAvailable;
  const shieldRaised = ctx.shieldRaised ?? actor.isShieldRaised;
  const hints = ctx.hints;

  if (feat.minActions != null && actionsLeft < feat.minActions) {
    return {
      featId: feat.id,
      attempt: false,
      scoreHint: 0,
      reason: `need ${feat.minActions} actions (have ${actionsLeft})`,
    };
  }

  if (feat.actions > 0 && actionsLeft < feat.actions) {
    return {
      featId: feat.id,
      attempt: false,
      scoreHint: 0,
      reason: `costs ${feat.actions} actions (have ${actionsLeft})`,
    };
  }

  if (feat.maxMap != null && map > feat.maxMap) {
    return {
      featId: feat.id,
      attempt: false,
      scoreHint: 0,
      reason: `MAP ${map} > max ${feat.maxMap}`,
    };
  }

  if (feat.avoidThirdStrike && ctx.isThirdAction) {
    return {
      featId: feat.id,
      attempt: false,
      scoreHint: 0,
      reason: "avoid third-strike / keep reaction setup on A3",
    };
  }

  if (feat.needsReactionAvailable && !reactionAvailable) {
    return {
      featId: feat.id,
      attempt: false,
      scoreHint: 0,
      reason: "reaction already spent",
    };
  }

  if (feat.needsRaisedShield && !shieldRaised) {
    return {
      featId: feat.id,
      attempt: false,
      scoreHint: 0,
      reason: "shield not raised",
    };
  }

  if (feat.needsAdjacentFoe && !hasAdjacentFoe(mem, actor)) {
    // Sudden Charge / close-and-strike: still attempt when we need to close.
    if (feat.effectClass === "setup" && feat.head === "Stride_close") {
      return {
        featId: feat.id,
        attempt: true,
        scoreHint: feat.scoreHint,
        reason: "close distance (setup)",
      };
    }
    return {
      featId: feat.id,
      attempt: false,
      scoreHint: 0,
      reason: "no adjacent foe",
    };
  }

  if (feat.needsOffGuard) {
    if (hints.alreadyFlanking) {
      return {
        featId: feat.id,
        attempt: true,
        scoreHint: feat.scoreHint,
        reason: "already flanking (Off-Guard)",
      };
    }
    if (hints.hasFlankPath) {
      // Prefer setup first — do not treat the Strike as the attempt yet.
      return {
        featId: feat.id,
        attempt: false,
        scoreHint: feat.scoreHint * 0.25,
        reason: "Off-Guard not ready — Stride to flank first",
      };
    }
    return {
      featId: feat.id,
      attempt: false,
      scoreHint: 0,
      reason: "no Off-Guard / no flank path",
    };
  }

  if (feat.effectClass === "healBias" && !hints.triageNeeded) {
    return {
      featId: feat.id,
      attempt: false,
      scoreHint: feat.scoreHint * 0.2,
      reason: "no triage target",
    };
  }

  if (feat.effectClass === "reaction" && feat.needsAdjacentFoe !== false) {
    if (!hasAdjacentFoe(mem, actor) && !hints.alreadyFlanking) {
      return {
        featId: feat.id,
        attempt: true,
        scoreHint: feat.scoreHint * 0.6,
        reason: "set up reaction geometry",
      };
    }
  }

  return {
    featId: feat.id,
    attempt: true,
    scoreHint: feat.scoreHint,
    reason: "legal and useful",
  };
}

/** Evaluate all owned catalog feats for Step 4 logging / scoring. */
export function evaluateOwnedFeats(
  mem: CombatMemory,
  actor: CombatantState,
  ctx: FeatAttemptContext,
): FeatAttemptVerdict[] {
  return featsFor(actor, ctx.capabilities).map((f) =>
    shouldAttemptFeat(mem, actor, f.id, ctx),
  );
}
