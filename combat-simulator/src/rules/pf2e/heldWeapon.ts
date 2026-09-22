import type { CombatantState } from "../../memory/combatMemory.js";
import type { TacticsGroupId, Weapon } from "../../memory/schemas.js";

/** Resolve which weapon id a combatant starts holding. */
export function resolveDefaultWeaponId(opts: {
  weapons: Weapon[];
  defaultWeaponId?: string;
  tacticsGroup?: TacticsGroupId;
}): string {
  const { weapons, defaultWeaponId, tacticsGroup } = opts;
  if (defaultWeaponId && weapons.some((w) => w.id === defaultWeaponId)) {
    return defaultWeaponId;
  }
  if (tacticsGroup === "archer") {
    const ranged = weapons.find((w) => w.kind === "ranged");
    if (ranged) return ranged.id;
  }
  const melee = weapons.find((w) => w.kind === "melee");
  if (melee) return melee.id;
  return weapons[0]!.id;
}

export function heldWeapon(actor: CombatantState): Weapon | undefined {
  return actor.weapons.find((w) => w.id === actor.heldWeaponId) ?? actor.weapons[0];
}

/** Melee reach of the held weapon (0 if holding a ranged weapon). */
export function heldMeleeReach(actor: CombatantState): number {
  const w = heldWeapon(actor);
  if (!w || w.kind !== "melee") return 0;
  return w.reach ?? 1;
}

export function canSwitchTo(actor: CombatantState, weaponId: string): boolean {
  if (weaponId === actor.heldWeaponId) return false;
  return actor.weapons.some((w) => w.id === weaponId);
}
