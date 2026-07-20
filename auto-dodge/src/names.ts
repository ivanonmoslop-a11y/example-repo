const MODIFIER_PREFIX = "modifier_"

const TRIM_SUFFIXES = ["_thinker", "_debuff", "_stun", "_slow", "_burn", "_disarm"]

const MODIFIER_ALIASES: ReadonlyMap<string, string> = new Map([
	["bloodseeker_bloodbath", "bloodseeker_blood_bath"],
	["warlock_golem_permanent_immolation_debuff", "warlock_rain_of_chaos"],
	["sandking_impale", "sandking_burrowstrike"]
])

export function AbilityNameFromModifier(modifierName: string): string {
	if (!modifierName.startsWith(MODIFIER_PREFIX)) {
		return modifierName
	}
	let name = modifierName.slice(MODIFIER_PREFIX.length)
	for (const suffix of TRIM_SUFFIXES) {
		if (name.endsWith(suffix)) {
			name = name.slice(0, name.length - suffix.length)
			break
		}
	}
	return MODIFIER_ALIASES.get(name) ?? name
}
