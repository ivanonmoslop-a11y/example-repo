import { EntityManager, Unit } from "github.com/octarine-public/wrapper/index"

/**
 * Debuffs that change the abuse, matched by name against buffs. The SDK does not
 * expose shatter, heal block or tick interval as queryable properties, so — like any
 * name list — these were verified against the wrapper's modifier exports.
 */

/**
 * Debuffs under which the abuse must never run: Ice Blast shatters (instantly kills)
 * the hero the moment HP drops low; Doom blocks healing, so the refill after the
 * burst never lands; Rupture deals damage on movement, which no tick schedule can
 * dodge — a single step during the 1 HP window is death.
 */
const FORBIDDEN = ["modifier_ice_blast", "modifier_doom_bringer_doom", "modifier_bloodseeker_rupture"]

/** Any effect present that makes the 1 HP burst window lethal no matter the timing. */
export function HasForbiddenDebuff(hero: Unit): boolean {
	return FORBIDDEN.some(name => hero.HasBuffByName(name))
}

/**
 * Ticking debuffs that can kill a hero sitting at 1 HP, with their tick interval in
 * seconds. The burst must finish strictly between two ticks. Where the real interval
 * is uncertain, the SHORTER guess is used: a phantom predicted tick only blocks the
 * burst a little longer, while a missed real tick is death at 1 HP. Intervals at or
 * below the burst cycle (~0.2-0.25s) effectively forbid the abuse while the debuff
 * lasts — under Rot or a Chakram there is no safe gap, and that is the point.
 */
export const KNOWN_DOTS: readonly (readonly [string, number])[] = [
	// items
	["modifier_item_urn_damage", 1],
	["modifier_item_spirit_vessel_damage", 1],
	["modifier_item_radiance_debuff", 1],
	["modifier_item_orb_of_venom_slow", 0.5],
	["modifier_item_orb_of_corrosion", 0.5],
	["modifier_item_meteor_hammer_burn", 0.5],
	["modifier_item_cloak_of_flames_debuff", 0.5],
	["modifier_item_witch_blade_slow", 0.5],
	// 1s and slower hero ticks
	["modifier_viper_nethertoxin", 1],
	["modifier_venomancer_poison_sting", 1],
	["modifier_venomancer_venomous_gale", 1],
	["modifier_venomancer_poison_nova", 1],
	["modifier_huskar_burning_spear_debuff", 1],
	["modifier_necrolyte_heartstopper_aura_effect", 1],
	["modifier_queenofpain_shadow_strike", 3],
	["modifier_maledict", 4],
	["modifier_maledict_dot", 1],
	["modifier_disruptor_thunder_strike", 2],
	["modifier_warlock_shadow_word", 1],
	["modifier_dazzle_poison_touch", 1],
	["modifier_axe_battle_hunger", 1],
	["modifier_alchemist_acid_spray", 1],
	["modifier_abyssal_underlord_firestorm_burn", 1],
	["modifier_sniper_shrapnel_slow", 1],
	// fast or uncertain ticks — conservative short intervals
	["modifier_ogre_magi_ignite", 0.5],
	["modifier_jakiro_dual_breath_burn", 0.5],
	["modifier_jakiro_liquid_fire_burn", 0.5],
	["modifier_jakiro_macropyre_burn", 0.5],
	["modifier_phoenix_fire_spirit_burn", 0.5],
	["modifier_doom_bringer_infernal_blade_burn", 0.5],
	["modifier_doom_bringer_scorched_earth_effect", 0.5],
	["modifier_crystal_maiden_frostbite", 0.5],
	["modifier_arc_warden_flux", 0.5],
	["modifier_dark_willow_bramble_maze", 0.5],
	["modifier_earth_spirit_magnetize", 0.5],
	["modifier_ember_spirit_searing_chains", 0.5],
	["modifier_enigma_midnight_pulse_damage", 0.5],
	["modifier_invoker_chaos_meteor_burn", 0.5],
	["modifier_invoker_ice_wall_slow_debuff", 0.5],
	["modifier_silencer_curse_of_the_silent", 0.5],
	["modifier_viper_poison_attack_slow", 0.5],
	["modifier_viper_viper_strike_slow", 0.5],
	["modifier_snapfire_magma_burn_slow", 0.5],
	["modifier_phoenix_sun_debuff", 0.5],
	// continuous — no safe gap while the debuff is on
	["modifier_death_prophet_spirit_siphon", 0.25],
	["modifier_disruptor_static_storm", 0.25],
	["modifier_shredder_chakram_debuff", 0.25],
	["modifier_pudge_rot", 0.2],
	["modifier_phoenix_sun_ray_slow", 0.2]
]

/**
 * Enemy-centered damage zones: while the hero is within the radius of an enemy
 * carrying the buff, damage can land at any moment (random or rapid pulses with no
 * debuff on the victim), so the abuse is blocked outright — there is no schedule to
 * slip between. Radii are the ability values plus a safety margin for the ramp.
 */
const DANGER_ZONES: readonly (readonly [string, number])[] = [
	["modifier_juggernaut_blade_fury", 350],
	["modifier_razor_eye_of_the_storm", 600],
	["modifier_leshrac_pulse_nova", 550],
	["modifier_leshrac_diabolic_edict", 600],
	["modifier_sand_king_epicenter", 800],
	["modifier_sandking_sand_storm", 625],
	["modifier_crystal_maiden_freezing_field", 900],
	["modifier_gyrocopter_rocket_barrage", 500],
	["modifier_luna_eclipse", 750],
	["modifier_primal_beast_trample", 400]
]

const MAX_ZONE_RADIUS = Math.max(...DANGER_ZONES.map(([, radius]) => radius))

/** True while any enemy damage zone covers the hero. */
export function InDangerZone(hero: Unit): boolean {
	const units = EntityManager.GetEntitiesByClass(Unit)
	for (let i = units.length - 1; i > -1; i--) {
		const unit = units[i]
		if (!unit.IsAlive || !unit.IsEnemy(hero)) {
			continue
		}
		const distance = hero.Distance2D(unit)
		if (distance > MAX_ZONE_RADIUS) {
			continue
		}
		for (const [buff, radius] of DANGER_ZONES) {
			if (distance <= radius && unit.HasBuffByName(buff)) {
				return true
			}
		}
	}
	return false
}
