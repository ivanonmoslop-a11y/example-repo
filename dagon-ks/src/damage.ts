import {
	Hero,
	Item,
	item_ethereal_blade,
	Unit
} from "github.com/octarine-public/wrapper/index"

const IMMUNITY_MODIFIERS = [
	"modifier_abaddon_borrowed_time",
	"modifier_dazzle_shallow_grave",
	"modifier_oracle_false_promise_timer",
	"modifier_kunkka_ghost_ship_damage_absorb",
	"modifier_nyx_assassin_burrow",
	"modifier_obsidian_destroyer_astral_imprisonment_prison",
	"modifier_shadow_demon_disruption",
	"modifier_eul_cyclone",
	"modifier_invoker_tornado",
	"modifier_winter_wyvern_winters_curse_aura",
	"modifier_tusk_snowball_movement",
	"modifier_phoenix_supernova_hiding",
	"modifier_templar_assassin_meld",
	"modifier_slark_shadow_dance",
	"modifier_snowball_movement_friendly"
]

export function isImmune(target: Unit): boolean {
	if (target.IsMagicImmune) return true
	if (target.IsInvulnerable) return true
	if (target.HasAegis) return true
	if (target.IsAvoidTotalDamage) return true
	for (const mod of IMMUNITY_MODIFIERS) {
		if (target.HasBuffByName(mod)) return true
	}
	return false
}

export function isLinkensBlocked(target: Unit): boolean {
	return target.IsLinkensProtected || target.HasLinkenAtTime(0)
}

export function distanceBetween(a: Unit, b: Unit): number {
	return a.Position.Distance2D(b.Position)
}

export function canDagonKill(hero: Unit, dagon: Item, target: Unit): boolean {
	if (isImmune(target)) return false
	if (isLinkensBlocked(target)) return false
	if (distanceBetween(hero, target) > dagon.CastRange) return false
	const damage = dagon.GetDamage(target)
	return target.HP <= damage
}

export function canEbladeComboKill(
	hero: Unit,
	dagon: Item,
	eblade: item_ethereal_blade,
	target: Unit
): boolean {
	if (isImmune(target)) return false
	if (isLinkensBlocked(target)) return false
	const maxRange = Math.min(eblade.CastRange, dagon.CastRange)
	if (distanceBetween(hero, target) > maxRange) return false

	const ebladeDmg = eblade.GetDamage(target)
	let dagonDmg = dagon.GetDamage(target)

	if (!target.IsEthereal) {
		const currentMres = target.GetMagicalDamageResist()
		if (currentMres < 1) {
			dagonDmg = dagonDmg * 1.4
		}
	}

	return target.HP <= ebladeDmg + dagonDmg
}

export function getHeroPriority(hero: Hero): number {
	if (hero.MaxHP > 2200) return 1
	if (hero.MaxHP > 1600) return 2
	return 3
}
