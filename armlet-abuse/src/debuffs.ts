import { EntityManager, Unit } from "github.com/octarine-public/wrapper/index"

const FORBIDDEN = ["modifier_ice_blast", "modifier_doom_bringer_doom", "modifier_bloodseeker_rupture"]

export function HasForbiddenDebuff(hero: Unit): boolean {
	return FORBIDDEN.some(name => hero.HasBuffByName(name))
}

export const KNOWN_DOTS: readonly (readonly [string, number])[] = [
	["modifier_item_urn_damage", 1],
	["modifier_item_spirit_vessel_damage", 1],
	["modifier_item_radiance_debuff", 1],
	["modifier_item_orb_of_venom_slow", 0.5],
	["modifier_item_orb_of_corrosion", 0.5],
	["modifier_item_meteor_hammer_burn", 0.5],
	["modifier_item_cloak_of_flames_debuff", 0.5],
	["modifier_item_witch_blade_slow", 0.5],
	["modifier_viper_nethertoxin", 1],
	["modifier_venomancer_poison_sting", 1],
	["modifier_venomancer_poison_sting_ward", 1],
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
	["modifier_venomancer_noxious_plague_primary", 0.5],
	["modifier_venomancer_noxious_plague_secondary", 0.5],
	["modifier_venomancer_snakebite", 0.5],
	["modifier_venomancer_latent_poison", 0.5],
	["modifier_venomancer_sepsis", 0.5],
	["modifier_death_prophet_spirit_siphon", 0.25],
	["modifier_disruptor_static_storm", 0.25],
	["modifier_shredder_chakram_debuff", 0.25],
	["modifier_pudge_rot", 0.2],
	["modifier_phoenix_sun_ray_slow", 0.2]
]

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
