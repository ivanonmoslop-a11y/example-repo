import { Unit } from "github.com/octarine-public/wrapper/index"

/**
 * Debuffs that change the abuse, matched by name against the hero's buffs. The SDK
 * does not expose shatter or tick interval as queryable properties, so — like any
 * name list — these were verified against tools/dumps/dump_mod_names.json.
 */

/**
 * Ancient Apparition Ice Blast: while it is on the hero, dropping under the kill
 * threshold shatters (instantly kills) the hero. A burst parks the hero at 1 HP, so
 * it is an instant death — the abuse must be forbidden outright.
 */
const SHATTER = ["modifier_ice_blast"]

/**
 * Ticking debuffs that can kill a hero sitting at 1 HP. The burst must finish strictly
 * between two ticks. Interval per tick is 1s for all of these.
 */
export const KNOWN_DOTS: readonly (readonly [string, number])[] = [
	["modifier_item_urn_damage", 1],
	["modifier_item_spirit_vessel_damage", 1],
	["modifier_ice_blast", 1],
	["modifier_doom_bringer_doom", 1],
	["modifier_viper_nethertoxin", 1],
	["modifier_venomancer_poison_sting", 1],
	["modifier_venomancer_venomous_gale", 1],
	["modifier_venomancer_poison_nova", 1],
	["modifier_huskar_burning_spear_debuff", 1],
	["modifier_item_radiance_debuff", 1],
	["modifier_necrolyte_heartstopper_aura_effect", 1]
]

/** Any effect present that would shatter-kill the hero the moment HP hits 1. */
export function HasShatter(hero: Unit): boolean {
	return SHATTER.some(name => hero.HasBuffByName(name))
}
