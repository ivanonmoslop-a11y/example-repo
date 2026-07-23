import { Ability, GameState, Hero, ImageData } from "github.com/octarine-public/wrapper/index"

const GUARD_SAFETY = 0.02
const MANTA_DAMAGE_LEAD = 0.01
const MANTA_DAMAGE_WINDOW = 0.03
const DARK_PACT_LEAD = 0.45

interface SpellTiming {
	readonly minTimeLeft: number
	readonly maxTimeLeft: number
}

const MANTA_IMPACT_TIMING: SpellTiming = { minTimeLeft: 0.01, maxTimeLeft: 0.1 }
const MANTA_DISPEL_TIMING: SpellTiming = { minTimeLeft: 0, maxTimeLeft: 0.15 }

export const enum CastMode {
	Self,
	NoTarget
}

export const enum DangerKind {
	Projectile,
	Cast,
	AreaCast,
	Debuff
}

export interface CounterDef {
	readonly key: string
	readonly isItem: boolean
	readonly names: string[]
	readonly mode: CastMode
	readonly vsProjectile: boolean
	readonly vsCast: boolean
	readonly vsArea: boolean
	readonly activationDelay: number
	readonly protection: number
	readonly triggerLead?: number
	readonly triggerWindow?: number
	readonly spellTimings?: Readonly<Record<string, SpellTiming>>
	readonly spells?: string[]
	readonly dispel?: boolean
	readonly dispelLead?: number
}

const DARK_PACT_SPELLS = [
	"chaos_knight_chaos_bolt",
	"alchemist_unstable_concoction",
	"alchemist_unstable_concoction_throw",
	"dawnbreaker_solar_guardian",
	"dawnbreaker_fire_wreath",
	"centaur_hoof_stomp",
	"earthshaker_fissure",
	"dragon_knight_dragon_tail",
	"doom_bringer_doom",
	"earth_spirit_rolling_boulder",
	"kunkka_ghostship",
	"life_stealer_open_wounds",
	"legion_commander_duel",
	"huskar_life_break",
	"huskar_inner_fire",
	"mars_spear",
	"ogre_magi_fireblast",
	"ogre_magi_ignite",
	"ogre_magi_unrefined_fireblast",
	"pudge_dismember",
	"primal_beast_pulverize",
	"spirit_breaker_charge_of_darkness",
	"spirit_breaker_nether_strike",
	"slardar_slithereen_crush",
	"sven_storm_bolt",
	"tidehunter_ravage",
	"skeleton_king_hellfire_blast",
	"tusk_snowball",
	"antimage_blink",
	"antimage_mana_void",
	"bloodseeker_blood_bath",
	"drow_ranger_wave_of_silence",
	"gyrocopter_homing_missile",
	"hoodwink_bushwhack",
	"monkey_king_boundless_strike",
	"naga_siren_ensnare",
	"morphling_adaptive_strike_agi",
	"morphling_adaptive_strike_str",
	"sniper_assassinate",
	"vengefulspirit_magic_missile",
	"disruptor_thunder_strike",
	"chen_penitence",
	"dark_willow_terrorize",
	"crystal_maiden_frostbite",
	"ancient_apparition_cold_feet",
	"enchantress_enchant",
	"invoker_cold_snap",
	"grimstroke_spirit_walk",
	"grimstroke_ink_creature",
	"grimstroke_soul_chain",
	"keeper_of_the_light_solar_bind",
	"warlock_shadow_word",
	"jakiro_ice_path",
	"leshrac_split_earth",
	"lina_light_strike_array",
	"sandking_burrowstrike",
	"muerta_dead_shot",
	"pugna_decrepify",
	"queenofpain_blink",
	"queenofpain_shadow_strike",
	"shadow_shaman_shackles",
	"skywrath_mage_ancient_seal",
	"winter_wyvern_winters_curse",
	"silencer_global_silence",
	"warlock_rain_of_chaos",
	"batrider_flaming_lasso",
	"witch_doctor_paralyzing_cask",
	"bane_enfeeble",
	"bane_nightmare",
	"bane_fiends_grip",
	"techies_suicide",
	"windrunner_shackleshot",
	"venomancer_noxious_plague",
	"snapfire_firesnap_cookie",
	"magnataur_reverse_polarity",
	"nyx_assassin_impale",
	"death_prophet_silence",
	"beastmaster_primal_roar",
	"item_rod_of_atos",
	"item_gungir",
	"item_harpoon",
	"item_nullifier",
	"item_ethereal_blade",
	"item_orchid",
	"item_bloodthorn",
	"item_heavens_halberd",
	"item_disperser",
	"enemy_blink"
]

export const DARK_PACT_NAMES: ReadonlySet<string> = new Set(DARK_PACT_SPELLS)

const MANTA_SPELLS = [
	"axe_culling_blade",
	"axe_berserkers_call",
	"dawnbreaker_solar_guardian",
	"dawnbreaker_fire_wreath",
	"dragon_knight_dragon_tail",
	"chaos_knight_chaos_bolt",
	"doom_bringer_doom",
	"earthshaker_fissure",
	"legion_commander_duel",
	"ogre_magi_fireblast",
	"ogre_magi_ignite",
	"ogre_magi_unrefined_fireblast",
	"pudge_dismember",
	"tidehunter_gush",
	"spirit_breaker_nether_strike",
	"skeleton_king_hellfire_blast",
	"antimage_mana_void",
	"drow_ranger_wave_of_silence_after",
	"medusa_mystic_snake",
	"morphling_adaptive_strike_agi",
	"morphling_adaptive_strike_str",
	"phantom_lancer_spirit_lance",
	"phantom_assassin_stifling_dagger",
	"sniper_assassinate",
	"vengefulspirit_magic_missile",
	"crystal_maiden_crystal_nova",
	"viper_viper_strike",
	"leshrac_split_earth",
	"zuus_thundergods_wrath",
	"tinker_laser",
	"queenofpain_scream_of_pain",
	"snapfire_firesnap_cookie",
	"venomancer_noxious_plague",
	"windrunner_shackleshot",
	"techies_suicide",
	"monkey_king_boundless_strike",
	"obsidian_destroyer_sanity_eclipse",
	"alchemist_unstable_concoction_throw",
	"centaur_hoof_stomp",
	"slardar_slithereen_crush",
	"sven_storm_bolt",
	"huskar_life_break",
	"invoker_emp",
	"magnataur_reverse_polarity",
	"windrunner_powershot",
	"pangolier_shield_crash",
	"warlock_rain_of_chaos",
	"invoker_sun_strike",
	"kunkka_torrent",
	"elder_titan_earth_splitter",
	"roshan_slam",
	"kunkka_ghostship",
	"lion_finger_of_death",
	"lina_laguna_blade",
	"lina_light_strike_array",
	"bloodseeker_blood_bath",
	"pugna_nether_blast",
	"meepo_poof",
	"nevermore_shadowraze1",
	"nevermore_shadowraze2",
	"nevermore_shadowraze3",
	"zuus_lightning_bolt"
]

const ITEM_DEFS: CounterDef[] = [
	{
		key: "manta",
		isItem: true,
		names: ["item_manta"],
		mode: CastMode.NoTarget,
		vsProjectile: true,
		vsCast: true,
		vsArea: true,
		activationDelay: 0,
		protection: 0.12,
		triggerLead: MANTA_DAMAGE_LEAD,
		triggerWindow: MANTA_DAMAGE_WINDOW,
		spellTimings: {
			axe_culling_blade: MANTA_IMPACT_TIMING,
			axe_berserkers_call: MANTA_IMPACT_TIMING,
			dawnbreaker_solar_guardian: MANTA_IMPACT_TIMING,
			dawnbreaker_fire_wreath: MANTA_IMPACT_TIMING,
			dragon_knight_dragon_tail: MANTA_IMPACT_TIMING,
			chaos_knight_chaos_bolt: MANTA_IMPACT_TIMING,
			doom_bringer_doom: MANTA_IMPACT_TIMING,
			earthshaker_fissure: MANTA_IMPACT_TIMING,
			legion_commander_duel: MANTA_IMPACT_TIMING,
			ogre_magi_fireblast: MANTA_IMPACT_TIMING,
			ogre_magi_ignite: MANTA_IMPACT_TIMING,
			ogre_magi_unrefined_fireblast: MANTA_IMPACT_TIMING,
			pudge_dismember: MANTA_IMPACT_TIMING,
			tidehunter_gush: MANTA_IMPACT_TIMING,
			spirit_breaker_nether_strike: MANTA_IMPACT_TIMING,
			skeleton_king_hellfire_blast: MANTA_IMPACT_TIMING,
			antimage_mana_void: MANTA_IMPACT_TIMING,
			drow_ranger_wave_of_silence_after: MANTA_DISPEL_TIMING,
			medusa_mystic_snake: MANTA_IMPACT_TIMING,
			morphling_adaptive_strike_agi: MANTA_IMPACT_TIMING,
			morphling_adaptive_strike_str: MANTA_IMPACT_TIMING,
			phantom_lancer_spirit_lance: MANTA_IMPACT_TIMING,
			phantom_assassin_stifling_dagger: MANTA_IMPACT_TIMING,
			sniper_assassinate: MANTA_IMPACT_TIMING,
			vengefulspirit_magic_missile: MANTA_IMPACT_TIMING,
			crystal_maiden_crystal_nova: MANTA_IMPACT_TIMING,
			viper_viper_strike: MANTA_IMPACT_TIMING,
			leshrac_split_earth: MANTA_IMPACT_TIMING,
			zuus_thundergods_wrath: MANTA_IMPACT_TIMING,
			tinker_laser: MANTA_IMPACT_TIMING,
			queenofpain_scream_of_pain: MANTA_IMPACT_TIMING,
			snapfire_firesnap_cookie: MANTA_IMPACT_TIMING,
			venomancer_noxious_plague: MANTA_IMPACT_TIMING,
			windrunner_shackleshot: MANTA_IMPACT_TIMING,
			techies_suicide: MANTA_IMPACT_TIMING,
			monkey_king_boundless_strike: MANTA_IMPACT_TIMING,
			obsidian_destroyer_sanity_eclipse: MANTA_IMPACT_TIMING,
			alchemist_unstable_concoction_throw: MANTA_IMPACT_TIMING,
			centaur_hoof_stomp: MANTA_IMPACT_TIMING,
			slardar_slithereen_crush: MANTA_IMPACT_TIMING,
			sven_storm_bolt: MANTA_IMPACT_TIMING,
			huskar_life_break: MANTA_IMPACT_TIMING,
			invoker_emp: MANTA_IMPACT_TIMING,
			magnataur_reverse_polarity: MANTA_IMPACT_TIMING,
			windrunner_powershot: MANTA_IMPACT_TIMING,
			elder_titan_earth_splitter: MANTA_IMPACT_TIMING,
			lion_finger_of_death: MANTA_IMPACT_TIMING,
			lina_laguna_blade: MANTA_IMPACT_TIMING,
			lina_light_strike_array: MANTA_IMPACT_TIMING
		},
		spells: MANTA_SPELLS
	},
	{
		key: "eul",
		isItem: true,
		names: ["item_cyclone", "item_wind_waker"],
		mode: CastMode.Self,
		vsProjectile: true,
		vsCast: true,
		vsArea: true,
		activationDelay: 0,
		protection: 2.5
	},
	{
		key: "lotus",
		isItem: true,
		names: ["item_lotus_orb"],
		mode: CastMode.Self,
		vsProjectile: true,
		vsCast: true,
		vsArea: false,
		activationDelay: 0,
		protection: 5
	},
	{
		key: "glimmer",
		isItem: true,
		names: ["item_glimmer_cape"],
		mode: CastMode.Self,
		vsProjectile: true,
		vsCast: true,
		vsArea: false,
		activationDelay: 0,
		protection: 5
	},
	{
		key: "bkb",
		isItem: true,
		names: ["item_black_king_bar"],
		mode: CastMode.NoTarget,
		vsProjectile: true,
		vsCast: true,
		vsArea: true,
		activationDelay: 0,
		protection: 5
	}
]

const ABILITY_DEFS: CounterDef[] = [
	{
		key: "phase_shift",
		isItem: false,
		names: ["puck_phase_shift"],
		mode: CastMode.NoTarget,
		vsProjectile: true,
		vsCast: true,
		vsArea: true,
		activationDelay: 0,
		protection: 3.25
	},
	{
		key: "blade_fury",
		isItem: false,
		names: ["juggernaut_blade_fury"],
		mode: CastMode.NoTarget,
		vsProjectile: true,
		vsCast: true,
		vsArea: true,
		activationDelay: 0,
		protection: 5
	},
	{
		key: "rage",
		isItem: false,
		names: ["life_stealer_rage"],
		mode: CastMode.NoTarget,
		vsProjectile: true,
		vsCast: true,
		vsArea: true,
		activationDelay: 0,
		protection: 5
	},
	{
		key: "shadow_realm",
		isItem: false,
		names: ["dark_willow_shadow_realm"],
		mode: CastMode.NoTarget,
		vsProjectile: true,
		vsCast: true,
		vsArea: true,
		activationDelay: 0,
		protection: 4
	},
	{
		key: "aphotic_shield",
		isItem: false,
		names: ["abaddon_aphotic_shield"],
		mode: CastMode.Self,
		vsProjectile: true,
		vsCast: true,
		vsArea: false,
		activationDelay: 0,
		protection: 15
	},
	{
		key: "dark_pact",
		isItem: false,
		names: ["slark_dark_pact"],
		mode: CastMode.NoTarget,
		vsProjectile: false,
		vsCast: false,
		vsArea: false,
		activationDelay: 0,
		protection: 0,
		dispel: true,
		dispelLead: DARK_PACT_LEAD,
		spells: DARK_PACT_SPELLS
	}
]

export class CounterSlot {
	public enabled = true
	public ability: Nullable<Ability>

	constructor(public readonly def: CounterDef) {}

	public get IsFound(): boolean {
		return this.ability !== undefined && this.ability.IsValid
	}

	public get IsShown(): boolean {
		return this.def.isItem || this.IsFound
	}

	public get RequiredTime(): number {
		const abil = this.ability
		return abil !== undefined && abil.IsValid ? abil.CastPoint : 0
	}

	public get GuardStart(): number {
		return this.RequiredTime + this.def.activationDelay + GameState.InputLag + GUARD_SAFETY
	}

	public get GuardEnd(): number {
		return this.GuardStart + Math.max(this.def.protection - GUARD_SAFETY * 2, 0)
	}

	public get TimingStart(): number {
		if (this.def.triggerLead !== undefined) {
			return this.RequiredTime + this.def.activationDelay + GameState.InputLag + this.def.triggerLead
		}
		return this.GuardStart
	}

	public get TimingEnd(): number {
		if (this.def.triggerLead !== undefined) {
			return this.TimingStart + (this.def.triggerWindow ?? 0)
		}
		return this.GuardEnd
	}

	public get DispelLead(): number {
		return this.def.dispelLead ?? 0
	}

	public TimingStartFor(name: string): number {
		if (this.def.dispel === true) {
			return 0
		}
		return this.def.spellTimings?.[name]?.minTimeLeft ?? this.TimingStart
	}

	public TimingEndFor(name: string): number {
		if (this.def.dispel === true) {
			return this.DispelLead
		}
		return this.def.spellTimings?.[name]?.maxTimeLeft ?? this.TimingEnd
	}

	public Covers(name: string, timeLeft: number): boolean {
		if (this.def.dispel === true) {
			return timeLeft <= this.DispelLead
		}
		return timeLeft >= this.TimingStartFor(name) && timeLeft <= this.TimingEndFor(name)
	}

	public get Texture(): string {
		const abil = this.ability
		const name = abil !== undefined && abil.IsValid ? abil.Name : this.def.names[0]
		return this.def.isItem ? ImageData.GetItemTexture(name) : ImageData.GetSpellTexture(name)
	}

	public Matches(kind: DangerKind, name: string): boolean {
		if (this.def.dispel === true) {
			return this.def.spells !== undefined && this.def.spells.includes(name)
		}
		if (kind === DangerKind.Debuff) {
			return false
		}
		if (kind === DangerKind.Projectile) {
			return this.def.vsProjectile
		}
		const list = this.def.spells
		if (list !== undefined) {
			return list.includes(name)
		}
		return kind === DangerKind.AreaCast ? this.def.vsArea : this.def.vsCast
	}

	public CanUse(hero: Hero): boolean {
		const abil = this.ability
		if (!this.enabled || abil === undefined || !abil.IsValid || !abil.CanBeCasted()) {
			return false
		}
		return this.def.isItem ? !hero.IsMuted : !hero.IsSilenced
	}

	public Resolve(hero: Hero): void {
		const abil = this.ability
		if (abil !== undefined && abil.IsValid && abil.Owner === hero) {
			return
		}
		this.ability = this.def.isItem
			? hero.Items.find(x => this.def.names.includes(x.Name))
			: hero.Spells.find((x): x is Ability => x !== undefined && this.def.names.includes(x.Name))
	}
}

export function CreateSlots(): CounterSlot[] {
	return [...ITEM_DEFS, ...ABILITY_DEFS].map(def => new CounterSlot(def))
}
