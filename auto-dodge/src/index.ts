import {
	Ability,
	AbilityData,
	Color,
	DOTA_ABILITY_BEHAVIOR,
	DOTA_UNIT_TARGET_TEAM,
	DOTAGameState,
	DOTAGameUIState,
	EntityManager,
	EventsSDK,
	GameRules,
	GameState,
	Hero,
	huskar_life_break,
	LocalPlayer,
	Modifier,
	NetworkedParticle,
	ProjectileManager,
	RendererSDK,
	Sleeper,
	techies_suicide,
	Thinker,
	Unit,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { CastMode, CounterSlot, CreateSlots, DangerKind, DARK_PACT_NAMES } from "./counters"
import { AutoDisable, CreateDisableSlots, DISABLE_TRIGGER_AGE } from "./disable"
import { BlinkEscape } from "./escape"
import { MenuManager } from "./menu"
import { CreateMoveDodgeSlots, MoveDodge } from "./moveDodge"
import { AbilityNameFromModifier } from "./names"
import { DodgePanel } from "./panel"

const CAST_RANGE_BUFFER = 250
const FACING_ANGLE = 0.45
const DODGE_SLEEP_MS = 600
const CAST_CONFIRM_GRACE = 0.2
const ZONE_CAP = 32
const ZONE_MERGE_DIST = 200
const POWERSHOT_NAME = "windrunner_powershot"
const POWERSHOT_PARTICLE = "windrunner_spell_powershot"
const POWERSHOT_RADIUS = 125
const GUST_AFTER_NAME = "drow_ranger_wave_of_silence_after"
const EARTH_SPLITTER_NAME = "elder_titan_earth_splitter"
const EARTH_SPLITTER_PARTICLE = "elder_titan_earth_splitter"
const SCREAM_NAME = "queenofpain_scream_of_pain"
const SCREAM_PARTICLES = ["queen_scream_of_pain", "scream_of_pain"]
const LAGUNA_PARTICLE = "lina_spell_laguna_blade"
const AFTER_EFFECT_LIFETIME = 0.2
const STARBREAKER_DURATION = 1.1
const LINA_DAMAGE_DELAY = 0.25
const GHOSTSHIP_DELAY = 1.4
const MANTA_IMPACT_PROJECTILES = new Set([
	"alchemist_unstable_concoction_throw",
	"huskar_life_break",
	"dragon_knight_dragon_tail",
	"chaos_knight_chaos_bolt",
	"ogre_magi_ignite",
	"tidehunter_gush",
	"skeleton_king_hellfire_blast",
	"medusa_mystic_snake",
	"morphling_adaptive_strike_agi",
	"morphling_adaptive_strike_str",
	"phantom_lancer_spirit_lance",
	"phantom_assassin_stifling_dagger",
	"sniper_assassinate",
	"vengefulspirit_magic_missile",
	"viper_viper_strike",
	"venomancer_noxious_plague",
	"windrunner_shackleshot",
	SCREAM_NAME
])

const TRACKING_PARTICLE_NAMES: ReadonlyMap<string, string> = new Map([
	["mystic_snake", "medusa_mystic_snake"],
	["queen_scream", SCREAM_NAME],
	["scream_of_pain", SCREAM_NAME]
])

const TARGET_DELAY_MODIFIERS: ReadonlyMap<string, string> = new Map([
	["modifier_lina_laguna_blade", "lina_laguna_blade"],
	["modifier_lion_finger_of_death", "lion_finger_of_death"],
	["modifier_lion_finger_of_death_delay", "lion_finger_of_death"]
])

const DARK_PACT_ITEM_MODIFIERS: ReadonlyMap<string, string> = new Map([
	["modifier_rod_of_atos_debuff", "item_rod_of_atos"],
	["modifier_item_gungir_root", "item_gungir"],
	["modifier_gungir_ensnare", "item_gungir"],
	["modifier_item_harpoon", "item_harpoon"],
	["modifier_item_harpoon_slow", "item_harpoon"],
	["modifier_item_nullifier_mute", "item_nullifier"],
	["modifier_item_ethereal_blade_slow", "item_ethereal_blade"],
	["modifier_item_ethereal_blade_ethereal", "item_ethereal_blade"],
	["modifier_item_orchid_malevolence", "item_orchid"],
	["modifier_item_bloodthorn_debuff", "item_bloodthorn"],
	["modifier_item_heavens_halberd_debuff", "item_heavens_halberd"],
	["modifier_item_heavens_halberd_disarm", "item_heavens_halberd"],
	["modifier_item_disperser_slow", "item_disperser"],
	["modifier_item_disperser_debuff", "item_disperser"]
])

const enum AreaMode {
	Caster,
	Delayed,
	Raze,
	Line,
	Global,
	Radial
}

interface AreaDef {
	radius: number
	mode: AreaMode
	offset?: number
	length?: number
	delayKeys?: string[]
	delay?: number
	castProximity?: boolean
	castDetection?: boolean
	radiusKeys?: string[]
	speedKeys?: string[]
	speed?: number
}

interface CastDef {
	delayKeys?: string[]
	delay?: number
}

const CAST_SPELLS: ReadonlyMap<string, CastDef> = new Map([
	["lion_finger_of_death", { delay: LINA_DAMAGE_DELAY }],
	["lina_laguna_blade", { delay: LINA_DAMAGE_DELAY }],
	["zuus_lightning_bolt", { delayKeys: ["strike_delay", "delay"], delay: 0.35 }]
])

const AREA_SPELLS: ReadonlyMap<string, AreaDef> = new Map([
	["earthshaker_fissure", { radius: 150, mode: AreaMode.Line, length: 1400 }],
	["magnataur_reverse_polarity", { radius: 430, mode: AreaMode.Caster, radiusKeys: ["pull_radius", "push_radius"] }],
	["enigma_black_hole", { radius: 420, mode: AreaMode.Caster }],
	["faceless_void_chronosphere", { radius: 450, mode: AreaMode.Caster }],
	["tidehunter_ravage", { radius: 1250, mode: AreaMode.Caster }],
	["earthshaker_echo_slam", { radius: 600, mode: AreaMode.Caster }],
	["sandking_epicenter", { radius: 600, mode: AreaMode.Caster }],
	["puck_dream_coil", { radius: 600, mode: AreaMode.Caster }],
	["axe_berserkers_call", { radius: 315, mode: AreaMode.Caster }],
	["centaur_hoof_stomp", { radius: 325, mode: AreaMode.Caster }],
	["slardar_slithereen_crush", { radius: 325, mode: AreaMode.Caster }],
	["monkey_king_boundless_strike", { radius: 150, mode: AreaMode.Line, length: 1100 }],
	["obsidian_destroyer_sanity_eclipse", { radius: 500, mode: AreaMode.Delayed }],
	["disruptor_static_storm", { radius: 450, mode: AreaMode.Caster }],
	["winter_wyvern_winters_curse", { radius: 500, mode: AreaMode.Caster }],
	["void_spirit_astral_step", { radius: 450, mode: AreaMode.Caster }],
	["dark_seer_vacuum", { radius: 500, mode: AreaMode.Caster }],
	["pangolier_shield_crash", { radius: 400, mode: AreaMode.Caster }],
	["meepo_poof", { radius: 400, mode: AreaMode.Caster }],
	["roshan_slam", { radius: 400, mode: AreaMode.Caster }],
	[
		"warlock_rain_of_chaos",
		{
			radius: 600,
			mode: AreaMode.Delayed,
			delayKeys: ["effect_delay", "impact_delay", "golem_spawn_delay", "delay"],
			delay: 0.2,
			castProximity: true
		}
	],
	["pugna_nether_blast", { radius: 350, mode: AreaMode.Line, length: 700, delayKeys: ["delay"], delay: 0.4 }],
	[
		"elder_titan_earth_splitter",
		{
			radius: 200,
			mode: AreaMode.Line,
			length: 1600,
			delayKeys: ["crack_time"],
			delay: 3.3,
			castDetection: false
		}
	],
	["invoker_sun_strike", { radius: 175, mode: AreaMode.Delayed, delayKeys: ["delay"], delay: 1.7 }],
	["invoker_emp", { radius: 675, mode: AreaMode.Delayed, delayKeys: ["delay"], delay: 2.9, castDetection: false }],
	["kunkka_torrent", { radius: 225, mode: AreaMode.Delayed, delayKeys: ["delay"], delay: 1.6 }],
	["bloodseeker_blood_bath", { radius: 600, mode: AreaMode.Delayed, delayKeys: ["delay"], delay: 2.6 }],
	["kunkka_ghostship", { radius: 425, mode: AreaMode.Delayed, delay: GHOSTSHIP_DELAY }],
	["jakiro_ice_path", { radius: 275, mode: AreaMode.Delayed, delayKeys: ["path_delay"], delay: 1 }],
	["crystal_maiden_crystal_nova", { radius: 425, mode: AreaMode.Delayed }],
	["leshrac_split_earth", { radius: 150, mode: AreaMode.Delayed, delayKeys: ["delay"], delay: 0.35 }],
	[
		"lina_light_strike_array",
		{
			radius: 225,
			mode: AreaMode.Delayed,
			delayKeys: ["light_strike_array_delay_time", "delay"],
			delay: 0.5,
			radiusKeys: ["light_strike_array_aoe"]
		}
	],
	[
		SCREAM_NAME,
		{
			radius: 550,
			mode: AreaMode.Radial,
			radiusKeys: ["area_of_effect"],
			speedKeys: ["projectile_speed"],
			speed: 900
		}
	],
	["zuus_thundergods_wrath", { radius: 0, mode: AreaMode.Global }],
	["nevermore_shadowraze1", { radius: 250, mode: AreaMode.Raze, offset: 200 }],
	["nevermore_shadowraze2", { radius: 250, mode: AreaMode.Raze, offset: 450 }],
	["nevermore_shadowraze3", { radius: 250, mode: AreaMode.Raze, offset: 700 }]
])

const AREA_PARTICLES: ReadonlyMap<string, string> = new Map([
	["invoker_emp", "invoker_emp"],
	["invoker_sun_strike", "invoker_sun_strike"],
	["kunkka_spell_torrent", "kunkka_torrent"],
	["bloodseeker_bloodritual", "bloodseeker_blood_bath"],
	["blood_rite", "bloodseeker_blood_bath"],
	["lina_spell_light_strike_array", "lina_light_strike_array"],
	["leshrac_split_earth", "leshrac_split_earth"],
	["warlock_rain_of_chaos", "warlock_rain_of_chaos"]
])

interface Danger {
	kind: DangerKind
	name: string
	timeLeft: number
	route: string
	projID?: number
	committed?: boolean
}

const SILENCE_PRECAST: ReadonlySet<string> = new Set([
	"silencer_global_silence",
	"death_prophet_silence",
	"skywrath_mage_ancient_seal",
	"item_orchid",
	"item_bloodthorn"
])

const SILENCE_CAST_SPELLS: ReadonlySet<string> = new Set(["silencer_global_silence", "death_prophet_silence"])

const DARK_PACT_LINEAR_PARTICLES: ReadonlyMap<string, string> = new Map([
	["wave_of_silence", "drow_ranger_wave_of_silence"],
	["drow_ranger_gust", "drow_ranger_wave_of_silence"],
	["mars_spear", "mars_spear"]
])

const ENEMY_BLINK_NAME = "enemy_blink"
const BLINK_DISPEL_AGE = 0.5
const CHARGE_NAME = "spirit_breaker_charge_of_darkness"
const CHARGE_SPEED = 550

interface PendingCast {
	ability: Ability
	startedAt: number
	lastActiveAt: number
	confirmed: boolean
}

interface AfterEffect {
	name: string
	modifier: string
	expiresAt: number
}

interface LineZone {
	index: number
	name: string
	start: Vector3
	end: Vector3
	radius: number
	impact: number
}

interface RadialWave {
	index: number
	name: string
	origin: Vector3
	radius: number
	speed: number
	startedAt: number
}

interface TargetEffect {
	name: string
	modifier: string
	impact: number
	expiresAt: number
}

new (class AutoDodge {
	private readonly menu = new MenuManager()
	private readonly slots = CreateSlots()
	private readonly moveSlots = CreateMoveDodgeSlots()
	private readonly disableSlots = CreateDisableSlots()
	private readonly panel = new DodgePanel(this.slots, this.moveSlots, this.disableSlots)
	private readonly escape = new BlinkEscape()
	private readonly moveDodge = new MoveDodge(this.moveSlots)
	private readonly autoDisable = new AutoDisable(this.disableSlots)
	private readonly sleeper = new Sleeper()
	private readonly handled = new Set<number>()
	private readonly pendingCasts = new Map<string, PendingCast>()
	private readonly afterEffects: AfterEffect[] = []
	private readonly lineZones: LineZone[] = []
	private readonly radialWaves: RadialWave[] = []
	private readonly targetEffects: TargetEffect[] = []
	private readonly zones: {
		name: string
		pos: Vector3
		radius: number
		impact: number
		route: string
		predictedCast?: string
	}[] = []
	private debugText = ""

	constructor() {
		this.menu.PanelKey.OnPressed(() => this.panel.Toggle())
		EventsSDK.on("ModifierCreated", this.ModifierCreated.bind(this))
		EventsSDK.on("ParticleCreated", this.OnParticle.bind(this))
		EventsSDK.on("ParticleUpdated", this.OnParticle.bind(this))
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("Draw", this.Draw.bind(this))
		EventsSDK.on("GameEnded", this.GameEnded.bind(this))
	}

	private get Hero(): Nullable<Hero> {
		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsValid) {
			return undefined
		}
		return hero
	}

	private get InGame(): boolean {
		if (GameState.UIState !== DOTAGameUIState.DOTA_GAME_UI_DOTA_INGAME) {
			return false
		}
		return GameRules?.GameState === DOTAGameState.DOTA_GAMERULES_STATE_GAME_IN_PROGRESS
	}

	private PostDataUpdate(): void {
		this.debugText = ""
		if (!this.menu.State.value || !this.InGame) {
			return
		}
		const hero = this.Hero
		if (hero === undefined) {
			return
		}
		for (const counter of this.slots) {
			counter.Resolve(hero)
		}
		this.escape.Tick(hero, this.panel.blinkAway, this.panel.autoDisable)
		this.autoDisable.Tick(hero, this.panel.autoDisable, this.escape.BlinkTargets(hero, DISABLE_TRIGGER_AGE))
		this.moveDodge.moveDodgeEnabled = this.panel.moveDodgeEnabled
		this.moveDodge.blockControl = this.panel.blockControl
		this.moveDodge.Tick(hero)
		if (!hero.IsAlive) {
			return
		}
		const dangers = this.FindDangers(hero)
		this.UpdateDebug(hero, dangers)
		if (dangers.length === 0) {
			return
		}
		if (this.sleeper.Sleeping("dodge")) {
			return
		}
		if (hero.IsStunned || hero.IsHexed || hero.IsInvulnerable) {
			return
		}
		const picked = this.PickCounter(hero, dangers)
		if (picked === undefined) {
			return
		}
		this.UseCounter(hero, picked[0], picked[1])
	}

	private FindDangers(hero: Hero): Danger[] {
		const found: Danger[] = []
		const alive = new Set<number>()
		const projs = ProjectileManager.AllTrackingProjectiles
		const lifeBreaks = EntityManager.GetEntitiesByClass(huskar_life_break)
		for (const proj of projs) {
			alive.add(proj.ID)
			const lifeBreak = lifeBreaks.find(x => x.CurrentProjectile === proj)
			const particleName = this.ResolveTrackingParticleName(proj.ParticlePathNoEcon)
			const rawSource = proj.Source
			const particleAbility =
				rawSource instanceof Hero && particleName !== undefined
					? rawSource.Spells.find((x): x is Ability => x !== undefined && x.Name === particleName)
					: undefined
			const impactAbilities =
				rawSource instanceof Hero
					? rawSource.Spells.filter(
							(x): x is Ability => x !== undefined && MANTA_IMPACT_PROJECTILES.has(x.Name)
					  )
					: []
			const sourceAbility = impactAbilities.length === 1 ? impactAbilities[0] : undefined
			const ability = proj.Ability ?? lifeBreak ?? particleAbility ?? sourceAbility
			const abilityName = ability?.Name ?? particleName ?? "projectile"
			const impactDodge = MANTA_IMPACT_PROJECTILES.has(abilityName)
			const dispelDodge = DARK_PACT_NAMES.has(abilityName)
			if (
				proj.Target !== hero ||
				proj.IsAttack ||
				(!proj.IsDodgeable && !impactDodge && !dispelDodge) ||
				proj.IsDodged ||
				this.handled.has(proj.ID)
			) {
				continue
			}
			const source = ability?.Owner ?? rawSource
			if (!(source instanceof Unit) || !source.IsEnemy(hero)) {
				continue
			}
			let timeLeft = 0
			if (proj.Position.IsValid) {
				timeLeft = this.TrackingTimeLeft(proj.Position, proj.Speed || ability?.Speed || 1, hero)
			}
			found.push({
				kind: !proj.IsDodgeable && (impactDodge || dispelDodge) ? DangerKind.Cast : DangerKind.Projectile,
				name: abilityName,
				timeLeft,
				route: "proj",
				projID: proj.ID
			})
		}
		for (const id of this.handled) {
			if (!alive.has(id)) {
				this.handled.delete(id)
			}
		}
		this.LinearProjectileDanger(hero, found)
		this.BlastOffDanger(hero, found)
		this.CentaurStompDanger(hero, found)
		this.StarbreakerDanger(hero, found)
		this.SolarGuardianDanger(hero, found)
		this.CookieDanger(hero, found)
		this.AfterEffectDanger(hero, found)
		this.TargetEffectDanger(hero, found)
		this.LineZoneDanger(hero, found)
		this.RadialWaveDanger(hero, found)
		const enemies = EntityManager.GetEntitiesByClass(Hero)
		for (const enemy of enemies) {
			if (!enemy.IsEnemy(hero) || !enemy.IsValid || !enemy.IsAlive || !enemy.IsVisible || enemy.IsIllusion) {
				continue
			}
			this.CastDanger(enemy, hero, found)
		}
		this.ThinkerDanger(hero, found)
		this.ZoneDanger(hero, found)
		this.DispelDebuffDanger(hero, found)
		this.SilenceCastDanger(hero, found)
		this.ChargeDanger(hero, found)
		this.BlinkDanger(hero, found)
		found.sort((a, b) => a.timeLeft - b.timeLeft)
		return found
	}

	private DispelDebuffDanger(hero: Hero, found: Danger[]): void {
		for (const buff of hero.Buffs) {
			const caster = buff.Caster
			if (caster instanceof Unit && !caster.IsEnemy(hero)) {
				continue
			}
			const name = this.DispelName(buff)
			if (name === undefined) {
				continue
			}
			found.push({ kind: DangerKind.Debuff, name, timeLeft: 0.01, route: "debuff" })
		}
	}

	private BlinkDanger(hero: Hero, found: Danger[]): void {
		if (this.escape.BlinkTargets(hero, BLINK_DISPEL_AGE).length === 0) {
			return
		}
		found.push({ kind: DangerKind.Debuff, name: ENEMY_BLINK_NAME, timeLeft: 0.01, route: "blink" })
	}

	private SilenceCastDanger(hero: Hero, found: Danger[]): void {
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!enemy.IsValid || !enemy.IsAlive || !enemy.IsVisible || enemy.IsIllusion || !enemy.IsEnemy(hero)) {
				continue
			}
			for (const abil of enemy.Spells) {
				if (
					abil === undefined ||
					!abil.IsValid ||
					!abil.IsInAbilityPhase ||
					!SILENCE_CAST_SPELLS.has(abil.Name)
				) {
					continue
				}
				if (abil.Name === "death_prophet_silence" && enemy.Distance(hero) > abil.CastRange + abil.AOERadius) {
					continue
				}
				const castLeft = Math.max(abil.CastPoint - (GameState.RawGameTime - abil.IsInAbilityPhaseChangeTime), 0)
				found.push({
					kind: DangerKind.Cast,
					name: abil.Name,
					timeLeft: castLeft,
					route: "silence",
					committed: false
				})
			}
		}
	}

	private ChargeDanger(hero: Hero, found: Danger[]): void {
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!enemy.IsValid || !enemy.IsAlive || !enemy.IsEnemy(hero) || !enemy.IsChargeOfDarkness) {
				continue
			}
			const distance = Math.max(enemy.Distance2D(hero) - hero.HullRadius, 0)
			found.push({
				kind: DangerKind.Cast,
				name: CHARGE_NAME,
				timeLeft: distance / CHARGE_SPEED,
				route: "charge"
			})
		}
	}

	private DispelName(buff: Modifier): Nullable<string> {
		const abilName = buff.Ability?.Name
		if (abilName !== undefined && DARK_PACT_NAMES.has(abilName)) {
			return abilName
		}
		const derived = AbilityNameFromModifier(buff.Name)
		if (DARK_PACT_NAMES.has(derived)) {
			return derived
		}
		return DARK_PACT_ITEM_MODIFIERS.get(buff.Name)
	}

	private TrackingTimeLeft(position: Vector3, speed: number, hero: Hero): number {
		const dx = hero.Position.x - position.x
		const dy = hero.Position.y - position.y
		const distance = Math.sqrt(dx * dx + dy * dy)
		if (!hero.IsMoving || distance <= 1) {
			return distance / Math.max(speed, 1)
		}
		const velocityX = Math.cos(hero.RotationRad) * hero.MoveSpeed
		const velocityY = Math.sin(hero.RotationRad) * hero.MoveSpeed
		const movingAway = (velocityX * dx + velocityY * dy) / distance
		return distance / Math.max(speed - movingAway, 1)
	}

	private ResolveTrackingParticleName(path: string): Nullable<string> {
		for (const [needle, name] of TRACKING_PARTICLE_NAMES) {
			if (path.includes(needle)) {
				return name
			}
		}
		return undefined
	}

	private LinearProjectileDanger(hero: Hero, found: Danger[]): void {
		for (const proj of ProjectileManager.AllLinearProjectiles) {
			if (!proj.IsValid || !proj.Position.IsValid) {
				continue
			}
			const source = proj.Source
			if (!(source instanceof Unit) || !source.IsEnemy(hero)) {
				continue
			}
			const isPowershot =
				proj.Ability?.Name === POWERSHOT_NAME || proj.ParticlePathNoEcon.includes(POWERSHOT_PARTICLE)
			const dispelName = isPowershot
				? undefined
				: this.ResolveLinearDispel(proj.Ability?.Name, proj.ParticlePathNoEcon)
			if (!isPowershot && dispelName === undefined) {
				continue
			}
			const ability =
				proj.Ability ??
				(source instanceof Hero
					? source.Spells.find(
							(x): x is Ability =>
								x !== undefined && x.Name === (isPowershot ? POWERSHOT_NAME : dispelName)
					  )
					: undefined)
			const dx = hero.Position.x - proj.Position.x
			const dy = hero.Position.y - proj.Position.y
			const along = dx * proj.Forward.x + dy * proj.Forward.y
			const spellRadius = Math.max(ability?.AOERadius ?? 0, isPowershot ? POWERSHOT_RADIUS : 100)
			const radius = spellRadius + hero.HullRadius
			const remaining = Math.max(proj.Distance - proj.Position.Distance2D(proj.Origin), 0)
			if (along < -hero.HullRadius || along > remaining + radius) {
				continue
			}
			if (Math.abs(dx * proj.Forward.y - dy * proj.Forward.x) > radius) {
				continue
			}
			found.push({
				kind: isPowershot ? DangerKind.AreaCast : DangerKind.Cast,
				name: isPowershot ? POWERSHOT_NAME : (dispelName as string),
				timeLeft: Math.max(along, 0) / Math.max(proj.Speed, 1),
				route: "linear"
			})
		}
	}

	private ResolveLinearDispel(abilityName: Nullable<string>, path: string): Nullable<string> {
		if (abilityName !== undefined && DARK_PACT_NAMES.has(abilityName)) {
			return abilityName
		}
		if (path.length === 0) {
			return undefined
		}
		for (const [needle, name] of DARK_PACT_LINEAR_PARTICLES) {
			if (path.includes(needle)) {
				return name
			}
		}
		return undefined
	}

	private BlastOffDanger(hero: Hero, found: Danger[]): void {
		for (const ability of EntityManager.GetEntitiesByClass(techies_suicide)) {
			const owner = ability.Owner
			if (
				owner === undefined ||
				!owner.IsValid ||
				!owner.IsAlive ||
				!owner.IsEnemy(hero) ||
				!ability.TargetPosition.IsValid
			) {
				continue
			}
			const buff = owner.GetBuffByName("modifier_techies_suicide_leap")
			if (buff === undefined) {
				continue
			}
			const duration = ability.GetSpecialValue("duration") || 0.75
			const timeLeft = buff.RemainingTime > 0 ? buff.RemainingTime : Math.max(duration - buff.ElapsedTime, 0)
			this.AddTimedAreaDanger(
				hero,
				found,
				ability.Name,
				ability.TargetPosition,
				Math.max(ability.AOERadius, 400),
				timeLeft,
				"blast-off",
				false
			)
		}
	}

	private CentaurStompDanger(hero: Hero, found: Danger[]): void {
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!enemy.IsValid || !enemy.IsAlive || !enemy.IsEnemy(hero)) {
				continue
			}
			const buff = enemy.GetBuffByName("modifier_centaur_hoof_stomp_windup")
			if (buff === undefined) {
				continue
			}
			const ability =
				buff.Ability ??
				enemy.Spells.find((x): x is Ability => x !== undefined && x.Name === "centaur_hoof_stomp")
			const windup = ability?.GetSpecialValue("windup_time") || 0.5
			const timeLeft = buff.RemainingTime > 0 ? buff.RemainingTime : Math.max(windup - buff.ElapsedTime, 0)
			this.AddTimedAreaDanger(
				hero,
				found,
				"centaur_hoof_stomp",
				enemy.Position,
				Math.max(ability?.AOERadius ?? 0, 325),
				timeLeft,
				"windup",
				false
			)
		}
	}

	private StarbreakerDanger(hero: Hero, found: Danger[]): void {
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!enemy.IsValid || !enemy.IsAlive || !enemy.IsEnemy(hero)) {
				continue
			}
			const buff = enemy.GetBuffByName("modifier_dawnbreaker_fire_wreath_caster")
			if (buff === undefined) {
				continue
			}
			const ability =
				buff.Ability ??
				enemy.Spells.find((x): x is Ability => x !== undefined && x.Name === "dawnbreaker_fire_wreath")
			const duration = Math.max(
				ability?.GetSpecialValue("duration") ?? 0,
				ability?.GetSpecialValue("total_duration") ?? 0,
				buff.Duration > 0 ? buff.Duration : 0,
				STARBREAKER_DURATION
			)
			const timeLeft = Math.max(duration - buff.ElapsedTime, 0)
			this.AddTimedAreaDanger(
				hero,
				found,
				"dawnbreaker_fire_wreath",
				enemy.Position,
				Math.max(
					ability?.AOERadius ?? 0,
					ability?.GetSpecialValue("smash_radius") ?? 0,
					ability?.GetSpecialValue("swipe_radius") ?? 0,
					300
				),
				timeLeft,
				"starbreaker-smash",
				false
			)
		}
	}

	private SolarGuardianDanger(hero: Hero, found: Danger[]): void {
		const now = GameState.RawGameTime
		for (const marker of EntityManager.GetEntitiesByClass(Unit)) {
			const buff = marker.GetBuffByName("modifier_dawnbreaker_solar_guardian_thinker")
			const ability = buff?.Ability
			const caster = buff?.Caster
			if (buff === undefined || !(caster instanceof Unit) || !caster.IsEnemy(hero)) {
				continue
			}
			let channel = ability?.MaxChannelTime ?? 1.7
			let airtime = ability?.GetSpecialValue("airtime_duration") || 0.8
			if (ability?.OwnerHasScepter) {
				channel = ability.GetSpecialValue("scepter_channel_time") || channel
				airtime = ability.GetSpecialValue("airtime_scepter_bonus") || airtime
			}
			const total = channel + airtime
			const timeLeft = Math.max(buff.CreationTime + total - now, 0)
			this.AddTimedAreaDanger(
				hero,
				found,
				"dawnbreaker_solar_guardian",
				marker.Position,
				Math.max(ability?.AOERadius ?? 0, ability?.GetSpecialValue("radius") ?? 0, 400),
				timeLeft,
				"solar-landing",
				false
			)
		}
	}

	private CookieDanger(hero: Hero, found: Danger[]): void {
		for (const unit of EntityManager.GetEntitiesByClass(Unit)) {
			const buff = unit.GetBuffByName("modifier_snapfire_firesnap_cookie_short_hop")
			const ability = buff?.Ability
			const caster = buff?.Caster
			if (buff === undefined || buff.RemainingTime <= 0 || !(caster instanceof Unit) || !caster.IsEnemy(hero)) {
				continue
			}
			this.AddTimedAreaDanger(
				hero,
				found,
				"snapfire_firesnap_cookie",
				unit.Position,
				Math.max(ability?.AOERadius ?? 0, ability?.GetSpecialValue("impact_radius") ?? 0, 300),
				buff.RemainingTime,
				"cookie-landing",
				false
			)
		}
	}

	private AfterEffectDanger(hero: Hero, found: Danger[]): void {
		const now = GameState.RawGameTime
		for (let i = this.afterEffects.length - 1; i > -1; i--) {
			const effect = this.afterEffects[i]
			if (now > effect.expiresAt || !hero.HasBuffByName(effect.modifier)) {
				this.afterEffects.splice(i, 1)
				continue
			}
			found.push({ kind: DangerKind.Cast, name: effect.name, timeLeft: 0.01, route: "after-effect" })
		}
	}

	private TargetEffectDanger(hero: Hero, found: Danger[]): void {
		const now = GameState.RawGameTime
		for (let i = this.targetEffects.length - 1; i > -1; i--) {
			const effect = this.targetEffects[i]
			if (now > effect.expiresAt) {
				this.targetEffects.splice(i, 1)
				continue
			}
			if (now > effect.impact && !hero.HasBuffByName(effect.modifier)) {
				continue
			}
			found.push({
				kind: DangerKind.Cast,
				name: effect.name,
				timeLeft: Math.max(effect.impact - now, 0),
				route: "target-modifier"
			})
		}
	}

	private LineZoneDanger(hero: Hero, found: Danger[]): void {
		const now = GameState.RawGameTime
		for (let i = this.lineZones.length - 1; i > -1; i--) {
			const line = this.lineZones[i]
			if (now > line.impact) {
				this.lineZones.splice(i, 1)
				continue
			}
			if (this.DistanceToSegment(hero.Position, line.start, line.end) > line.radius + hero.HullRadius) {
				continue
			}
			found.push({
				kind: DangerKind.AreaCast,
				name: line.name,
				timeLeft: line.impact - now,
				route: "particle-line"
			})
		}
	}

	private RadialWaveDanger(hero: Hero, found: Danger[]): void {
		const now = GameState.RawGameTime
		for (let i = this.radialWaves.length - 1; i > -1; i--) {
			const wave = this.radialWaves[i]
			const elapsed = Math.max(now - wave.startedAt, 0)
			const lifetime = (wave.radius + hero.HullRadius) / wave.speed + 0.2
			if (elapsed > lifetime) {
				this.radialWaves.splice(i, 1)
				continue
			}
			const distance = wave.origin.Distance2D(hero.Position)
			if (distance > wave.radius + hero.HullRadius) {
				continue
			}
			const remaining = distance - hero.HullRadius - elapsed * wave.speed
			if (remaining < 0) {
				continue
			}
			found.push({
				kind: DangerKind.AreaCast,
				name: wave.name,
				timeLeft: remaining / wave.speed,
				route: "radial-wave"
			})
		}
	}

	private DistanceToSegment(point: Vector3, start: Vector3, end: Vector3): number {
		const dx = end.x - start.x
		const dy = end.y - start.y
		const lengthSq = dx * dx + dy * dy
		if (lengthSq <= 1) {
			return point.Distance2D(start)
		}
		const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq
		const clamped = Math.max(0, Math.min(projection, 1))
		const closestX = start.x + dx * clamped
		const closestY = start.y + dy * clamped
		const pointDx = point.x - closestX
		const pointDy = point.y - closestY
		return Math.sqrt(pointDx * pointDx + pointDy * pointDy)
	}

	private AddTimedAreaDanger(
		hero: Hero,
		found: Danger[],
		name: string,
		position: Vector3,
		radius: number,
		timeLeft: number,
		route: string,
		persist = true
	): void {
		if (persist) {
			this.AddZone(name, position.Clone(), radius, GameState.RawGameTime + timeLeft, route)
		}
		if (position.Distance2D(hero.Position) > radius + hero.HullRadius) {
			return
		}
		found.push({ kind: DangerKind.AreaCast, name, timeLeft, route })
	}

	private CastDanger(enemy: Hero, hero: Hero, found: Danger[]): void {
		const lists: Nullable<Ability>[][] = [enemy.Spells, enemy.Items]
		for (const list of lists) {
			for (const abil of list) {
				if (abil === undefined || !abil.IsValid || !abil.IsInAbilityPhase) {
					continue
				}
				const castKey = `${enemy.Index}:${abil.Name}`
				const startedAt = abil.IsInAbilityPhaseChangeTime
				let pending = this.pendingCasts.get(castKey)
				if (pending === undefined || pending.startedAt !== startedAt) {
					pending = { ability: abil, startedAt, lastActiveAt: GameState.RawGameTime, confirmed: false }
					this.pendingCasts.set(castKey, pending)
				}
				pending.lastActiveAt = GameState.RawGameTime
				if (abil.CooldownChangeTime >= startedAt - 0.05 && abil.Cooldown > 0) {
					pending.confirmed = true
				}
				const castLeft = Math.max(abil.CastPoint - (GameState.RawGameTime - abil.IsInAbilityPhaseChangeTime), 0)
				const area = AREA_SPELLS.get(abil.Name)
				if (area !== undefined) {
					if (area.castDetection === false) {
						continue
					}
					const keyedRadius = Math.max(0, ...(area.radiusKeys ?? []).map(x => abil.GetSpecialValue(x)))
					const radius = Math.max(abil.AOERadius, keyedRadius, area.radius)
					const resolvedArea = radius === area.radius ? area : { ...area, radius }
					let detected = false
					if (area.mode === AreaMode.Delayed) {
						if (area.castProximity === true) {
							detected = enemy.Distance2D(hero) <= radius + hero.HullRadius
						} else if (abil.CastRange > 0 && abil.CastRange < 5000) {
							detected =
								enemy.Distance(hero) <= abil.CastRange + CAST_RANGE_BUFFER &&
								enemy.FindRotationAngle(hero) <= FACING_ANGLE
						}
					} else {
						detected = this.InArea(enemy, hero, resolvedArea)
					}
					if (!detected) {
						continue
					}
					let areaLeft = castLeft + this.ResolveDelay(abil, abil.Name, area.delayKeys, area.delay)
					if (area.mode === AreaMode.Radial) {
						const speed = this.ResolveDelay(abil, abil.Name, area.speedKeys, area.speed)
						areaLeft += enemy.Distance2D(hero) / Math.max(speed, 1)
					}
					const route =
						area.mode === AreaMode.Delayed
							? "cast~"
							: area.mode === AreaMode.Radial
							? "cast-radial"
							: "cast"
					found.push({
						kind: DangerKind.AreaCast,
						name: abil.Name,
						timeLeft: areaLeft,
						route,
						committed: pending.confirmed
					})
					if (
						area.mode === AreaMode.Delayed ||
						area.mode === AreaMode.Line ||
						area.mode === AreaMode.Radial
					) {
						this.AddZone(
							abil.Name,
							hero.Position.Clone(),
							radius,
							GameState.RawGameTime + areaLeft,
							route,
							castKey
						)
					}
					continue
				}
				const known = CAST_SPELLS.get(abil.Name)
				if (
					known === undefined &&
					(!abil.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_UNIT_TARGET) ||
						!abil.HasTargetTeam(DOTA_UNIT_TARGET_TEAM.DOTA_UNIT_TARGET_TEAM_ENEMY) ||
						abil.Speed > 0)
				) {
					continue
				}
				if (enemy.Distance(hero) > abil.CastRange + CAST_RANGE_BUFFER) {
					continue
				}
				if (enemy.FindRotationAngle(hero) > FACING_ANGLE) {
					continue
				}
				const castDelay = this.ResolveDelay(abil, abil.Name, known?.delayKeys, known?.delay)
				const totalLeft = castLeft + castDelay
				found.push({
					kind: DangerKind.Cast,
					name: abil.Name,
					timeLeft: totalLeft,
					route: "cast",
					committed: pending.confirmed
				})
				if (known !== undefined && castDelay > 0) {
					this.AddZone(
						abil.Name,
						hero.Position.Clone(),
						200,
						GameState.RawGameTime + totalLeft,
						"cast",
						castKey
					)
				}
			}
		}
	}

	private ResolveDelay(
		abil: Nullable<Ability>,
		name: string,
		keys: Nullable<string[]>,
		fallback: Nullable<number>
	): number {
		if (keys === undefined) {
			return fallback ?? 0
		}
		if (abil !== undefined && abil.IsValid) {
			for (const key of keys) {
				const value = abil.GetSpecialValue(key)
				if (value > 0) {
					return value
				}
			}
		}
		const data = AbilityData.GetAbilityByName(name)
		if (data !== undefined) {
			for (const key of keys) {
				const value = data.GetSpecialValue(key, 1, name)
				if (value > 0) {
					return value
				}
			}
		}
		return fallback ?? 0
	}

	private InArea(enemy: Hero, hero: Hero, area: AreaDef): boolean {
		if (area.mode === AreaMode.Global) {
			return true
		}
		const limit = area.radius + hero.HullRadius
		if (area.mode === AreaMode.Line) {
			return this.InLine(enemy, hero, area, limit)
		}
		if (area.mode !== AreaMode.Raze) {
			return enemy.Distance2D(hero) <= limit
		}
		const angle = enemy.RotationRad
		const dist = area.offset ?? 0
		const center = new Vector3(
			enemy.Position.x + Math.cos(angle) * dist,
			enemy.Position.y + Math.sin(angle) * dist,
			enemy.Position.z
		)
		return center.Distance2D(hero.Position) <= limit
	}

	private InLine(enemy: Hero, hero: Hero, area: AreaDef, limit: number): boolean {
		const angle = enemy.RotationRad
		const fx = Math.cos(angle)
		const fy = Math.sin(angle)
		const dx = hero.Position.x - enemy.Position.x
		const dy = hero.Position.y - enemy.Position.y
		const along = dx * fx + dy * fy
		if (along < -hero.HullRadius || along > (area.length ?? 0) + area.radius) {
			return false
		}
		return Math.abs(dx * fy - dy * fx) <= limit
	}

	private ModifierCreated(buff: Modifier): void {
		const hero = this.Hero
		const caster = buff.Caster
		const delayedTarget = TARGET_DELAY_MODIFIERS.get(buff.Name)
		if (
			hero !== undefined &&
			buff.Parent === hero &&
			delayedTarget !== undefined &&
			caster instanceof Unit &&
			caster.IsEnemy(hero)
		) {
			const targetDelay = buff.RemainingTime > 0 ? buff.RemainingTime : LINA_DAMAGE_DELAY
			const impact = GameState.RawGameTime + targetDelay
			const known = this.targetEffects.find(x => x.name === delayedTarget && x.expiresAt >= GameState.RawGameTime)
			if (known === undefined) {
				this.targetEffects.push({
					name: delayedTarget,
					modifier: buff.Name,
					impact,
					expiresAt: impact + 0.1
				})
			} else {
				known.impact = Math.min(known.impact, impact)
				known.expiresAt = Math.max(known.expiresAt, impact + 0.1)
			}
		}
		if (
			hero !== undefined &&
			buff.Parent === hero &&
			buff.Name === "modifier_drowranger_wave_of_silence" &&
			caster instanceof Unit &&
			caster.IsEnemy(hero)
		) {
			this.afterEffects.push({
				name: GUST_AFTER_NAME,
				modifier: buff.Name,
				expiresAt: GameState.RawGameTime + AFTER_EFFECT_LIFETIME
			})
		}
		const abilName = buff.Ability?.Name ?? AbilityNameFromModifier(buff.Name)
		const area = AREA_SPELLS.get(abilName)
		if (area === undefined || area.mode !== AreaMode.Delayed) {
			return
		}
		const parent = buff.Parent
		if (parent === undefined || !parent.IsValid) {
			return
		}
		if (caster instanceof Unit && !caster.IsEnemy()) {
			return
		}
		const delay = this.ResolveDelay(buff.Ability, abilName, area.delayKeys, area.delay)
		this.AddZone(
			abilName,
			parent.Position.Clone(),
			Math.max(area.radius, buff.Ability?.AOERadius ?? 0),
			GameState.RawGameTime + delay,
			"mod"
		)
	}

	private OnParticle(particle: NetworkedParticle): void {
		this.UpdateLagunaEffect(particle)
		this.UpdateEarthSplitterLine(particle)
		this.UpdateScreamWave(particle)
		const abilName = particle.Ability?.Name ?? this.ResolveParticleArea(particle.PathNoEcon)
		if (abilName === undefined) {
			return
		}
		const area = AREA_SPELLS.get(abilName)
		if (area === undefined || area.mode !== AreaMode.Delayed) {
			return
		}
		const source = particle.Ability?.Owner ?? particle.Source ?? particle.AttachedTo
		if (source instanceof Unit && !source.IsEnemy()) {
			return
		}
		const attachedPos = particle.AttachedTo instanceof Unit ? particle.AttachedTo.Position : undefined
		const modifierPos =
			particle.ModifiersAttachedTo instanceof Unit ? particle.ModifiersAttachedTo.Position : undefined
		const pos =
			this.ControlPoint(particle, 0) ??
			(attachedPos?.IsValid === true ? attachedPos : modifierPos?.IsValid === true ? modifierPos : undefined)
		if (pos === undefined) {
			return
		}
		const delay = this.ResolveDelay(undefined, abilName, area.delayKeys, area.delay)
		this.AddZone(
			abilName,
			pos.Clone(),
			Math.max(area.radius, particle.Ability?.AOERadius ?? 0),
			GameState.RawGameTime + delay,
			"part"
		)
	}

	private UpdateLagunaEffect(particle: NetworkedParticle): void {
		const ability = particle.Ability
		if (ability?.Name !== "lina_laguna_blade" && !particle.PathNoEcon.includes(LAGUNA_PARTICLE)) {
			return
		}
		const hero = this.Hero
		const caster = ability?.Owner ?? particle.Source
		if (hero === undefined || particle.Target !== hero || !(caster instanceof Unit) || !caster.IsEnemy(hero)) {
			return
		}
		const now = GameState.RawGameTime
		const impact = now + LINA_DAMAGE_DELAY
		const known = this.targetEffects.find(x => x.name === "lina_laguna_blade" && x.expiresAt >= now)
		if (known === undefined) {
			this.targetEffects.push({
				name: "lina_laguna_blade",
				modifier: "modifier_lina_laguna_blade",
				impact,
				expiresAt: impact + 0.1
			})
			return
		}
		known.impact = Math.min(known.impact, impact)
		known.expiresAt = Math.max(known.expiresAt, impact + 0.1)
	}

	private UpdateEarthSplitterLine(particle: NetworkedParticle): void {
		const ability = particle.Ability
		if (ability?.Name !== EARTH_SPLITTER_NAME && !particle.PathNoEcon.includes(EARTH_SPLITTER_PARTICLE)) {
			return
		}
		const source = ability?.Owner ?? particle.Source ?? particle.AttachedTo
		if (!(source instanceof Unit) || !source.IsEnemy()) {
			return
		}
		const points = [...particle.ControlPoints.values(), ...particle.ControlPointsFallback.values()].filter(
			x => x.IsValid
		)
		if (points.length === 0) {
			return
		}
		const cp0 = this.ControlPoint(particle, 0)
		const cp1 = this.ControlPoint(particle, 1)
		let start = cp0 ?? source.Position
		let end = cp1 ?? points[0]
		let longest = start.Distance2D(end)
		if (cp0 === undefined || cp1 === undefined || longest < 32) {
			for (let i = 0; i < points.length; i++) {
				for (let j = i + 1; j < points.length; j++) {
					const distance = points[i].Distance2D(points[j])
					if (distance > longest) {
						start = points[i]
						end = points[j]
						longest = distance
					}
				}
			}
		}
		if (longest < 32) {
			return
		}
		const radius = Math.max(ability?.AOERadius ?? 0, ability?.GetSpecialValue("crack_width") ?? 0, 200)
		const known = this.lineZones.find(x => x.index === particle.Index)
		if (known !== undefined) {
			known.start = start.Clone()
			known.end = end.Clone()
			known.radius = radius
			return
		}
		const delay = this.ResolveDelay(ability, EARTH_SPLITTER_NAME, ["crack_time"], 3.3)
		this.lineZones.push({
			index: particle.Index,
			name: EARTH_SPLITTER_NAME,
			start: start.Clone(),
			end: end.Clone(),
			radius,
			impact: GameState.RawGameTime + delay
		})
	}

	private UpdateScreamWave(particle: NetworkedParticle): void {
		if (!SCREAM_PARTICLES.some(x => particle.PathNoEcon.includes(x))) {
			return
		}
		const ability = particle.Ability
		const caster = ability?.Owner ?? particle.Source
		if (!(caster instanceof Unit) || !caster.IsEnemy()) {
			return
		}
		const attached = particle.AttachedTo ?? particle.ModifiersAttachedTo
		const origin = attached instanceof Unit ? attached.Position : caster.Position
		const radius = Math.max(ability?.AOERadius ?? 0, ability?.GetSpecialValue("area_of_effect") ?? 0, 550)
		const speed = Math.max(ability?.Speed ?? 0, ability?.GetSpecialValue("projectile_speed") ?? 0, 900)
		const known = this.radialWaves.find(x => x.index === particle.Index)
		if (known !== undefined) {
			known.origin = origin.Clone()
			known.radius = radius
			known.speed = speed
			return
		}
		this.radialWaves.push({
			index: particle.Index,
			name: SCREAM_NAME,
			origin: origin.Clone(),
			radius,
			speed,
			startedAt: GameState.RawGameTime
		})
	}

	private ResolveParticleArea(path: string): Nullable<string> {
		if (path.length === 0) {
			return undefined
		}
		for (const [needle, name] of AREA_PARTICLES) {
			if (path.includes(needle)) {
				return name
			}
		}
		return undefined
	}

	private ControlPoint(particle: NetworkedParticle, index: number): Nullable<Vector3> {
		const cp = particle.ControlPoints.get(index)
		if (cp !== undefined && cp.IsValid) {
			return cp
		}
		const fallback = particle.ControlPointsFallback.get(index)
		return fallback !== undefined && fallback.IsValid ? fallback : undefined
	}

	private AddZone(
		name: string,
		pos: Vector3,
		radius: number,
		impact: number,
		route: string,
		predictedCast?: string
	): void {
		const known = this.zones.find(x => x.name === name && x.pos.Distance2D(pos) < ZONE_MERGE_DIST)
		if (known !== undefined) {
			known.impact = Math.min(known.impact, impact)
			if (predictedCast === undefined) {
				known.predictedCast = undefined
			}
			return
		}
		this.zones.push({ name, pos, radius, impact, route, predictedCast })
		if (this.zones.length > ZONE_CAP) {
			this.zones.shift()
		}
	}

	private ZoneDanger(hero: Hero, found: Danger[]): void {
		const now = GameState.RawGameTime
		for (let i = this.zones.length - 1; i > -1; i--) {
			const zone = this.zones[i]
			let committed = true
			if (zone.predictedCast !== undefined) {
				const pending = this.pendingCasts.get(zone.predictedCast)
				if (
					pending !== undefined &&
					pending.ability.CooldownChangeTime >= pending.startedAt - 0.05 &&
					pending.ability.Cooldown > 0
				) {
					pending.confirmed = true
				}
				if (
					pending === undefined ||
					(!pending.confirmed &&
						!pending.ability.IsInAbilityPhase &&
						now - pending.lastActiveAt > CAST_CONFIRM_GRACE)
				) {
					this.zones.splice(i, 1)
					continue
				}
				committed = pending.confirmed
			}
			if (now > zone.impact) {
				this.zones.splice(i, 1)
				continue
			}
			if (zone.pos.Distance2D(hero.Position) > zone.radius + hero.HullRadius) {
				continue
			}
			found.push({
				kind: DangerKind.AreaCast,
				name: zone.name,
				timeLeft: zone.impact - now,
				route: zone.route,
				committed
			})
		}
	}

	private ThinkerDanger(hero: Hero, found: Danger[]): void {
		const now = GameState.RawGameTime
		for (const thinker of EntityManager.GetEntitiesByClass(Thinker)) {
			if (!thinker.IsValid || !thinker.IsAlive) {
				continue
			}
			for (const buff of thinker.Buffs) {
				const abilName = buff.Ability?.Name ?? AbilityNameFromModifier(buff.Name)
				const area = AREA_SPELLS.get(abilName)
				if (area === undefined || area.mode !== AreaMode.Delayed) {
					continue
				}
				const caster = buff.Caster
				if (caster instanceof Unit && !caster.IsEnemy(hero)) {
					continue
				}
				const radius = Math.max(area.radius, buff.Ability?.AOERadius ?? 0)
				if (thinker.Position.Distance2D(hero.Position) > radius + hero.HullRadius) {
					continue
				}
				const delay = this.ResolveDelay(buff.Ability, abilName, area.delayKeys, area.delay)
				const impact = delay > 0 ? buff.CreationTime + delay : buff.DieTime
				found.push({
					kind: DangerKind.AreaCast,
					name: abilName,
					timeLeft: Math.max(impact - now, 0),
					route: "think"
				})
			}
		}
	}

	private PickCounter(hero: Hero, dangers: Danger[]): Nullable<[CounterSlot, Danger]> {
		for (let i = 0; i < this.slots.length; i++) {
			const slot = this.slots[i]
			if (!slot.IsShown || !slot.CanUse(hero)) {
				continue
			}
			for (const danger of dangers) {
				if (!slot.Matches(danger.kind, danger.name) || !slot.Covers(danger.name, danger.timeLeft)) {
					continue
				}
				if (!this.DispelAllowed(slot, danger)) {
					continue
				}
				if (this.HigherPriorityHandles(hero, i, danger)) {
					continue
				}
				return [slot, danger]
			}
		}
		return undefined
	}

	private DispelAllowed(slot: CounterSlot, danger: Danger): boolean {
		if (slot.def.dispel !== true) {
			return true
		}
		return danger.committed !== false || SILENCE_PRECAST.has(danger.name)
	}

	private HigherPriorityHandles(hero: Hero, index: number, danger: Danger): boolean {
		for (let j = 0; j < index; j++) {
			const other = this.slots[j]
			if (!other.IsShown || !other.CanUse(hero) || !other.Matches(danger.kind, danger.name)) {
				continue
			}
			if (this.DispelAllowed(other, danger)) {
				return true
			}
		}
		return false
	}

	private UseCounter(hero: Hero, slot: CounterSlot, danger: Danger): void {
		const abil = slot.ability
		if (abil === undefined) {
			return
		}
		if (hero.IsChanneling && !this.panel.cancelAnimation) {
			return
		}
		if (this.panel.cancelAnimation && (hero.IsChanneling || hero.IsAttacking)) {
			hero.OrderStop(false)
		}
		if (slot.def.mode === CastMode.Self) {
			hero.CastTarget(abil, hero)
		} else {
			hero.CastNoTarget(abil)
		}
		this.sleeper.Sleep(DODGE_SLEEP_MS, "dodge")
		if (danger.projID !== undefined) {
			this.handled.add(danger.projID)
		}
	}

	private UpdateDebug(hero: Hero, dangers: Danger[]): void {
		if (!this.menu.ShowDebug.value) {
			return
		}
		const state = this.sleeper.Sleeping("dodge") ? "cd" : "watch"
		const cancel = this.panel.cancelAnimation ? "cancel:on" : "cancel:off"
		const danger = dangers[0]
		let dangerText = "no danger"
		if (danger !== undefined) {
			const kind =
				danger.kind === DangerKind.Projectile
					? "proj"
					: danger.kind === DangerKind.AreaCast
					? "area"
					: danger.kind === DangerKind.Debuff
					? "debuff"
					: "cast"
			const commit = danger.committed === false ? " windup" : ""
			dangerText = `${kind}/${danger.route} ${danger.name} ${Math.round(danger.timeLeft * 1000)}ms${commit}`
			if (dangers.length > 1) {
				dangerText += ` +${dangers.length - 1}`
			}
		}
		const picked = this.PickCounter(hero, dangers)
		let counter = picked !== undefined ? picked[0].def.key : "none"
		if (picked === undefined && danger !== undefined) {
			const ready = this.slots.find(
				x => x.IsShown && x.CanUse(hero) && dangers.some(d => x.Matches(d.kind, d.name))
			)
			if (ready !== undefined) {
				const want = dangers.find(d => ready.Matches(d.kind, d.name))
				const wantName = want?.name ?? ""
				counter =
					`${ready.def.key} want${Math.round((want?.timeLeft ?? 0) * 1000)} ` +
					`win[${Math.round(ready.TimingStartFor(wantName) * 1000)}..${Math.round(
						ready.TimingEndFor(wantName) * 1000
					)}]`
			}
		}
		this.debugText = `${state} | ${dangerText} | ${counter} | ${cancel} | ${this.escape.Status} | ${this.moveDodge.Status} | ${this.autoDisable.Status}`
	}

	private Draw(): void {
		if (!this.menu.State.value || !this.InGame) {
			return
		}
		this.panel.Draw()
		if (this.debugText.length === 0) {
			return
		}
		const hero = this.Hero
		if (hero === undefined) {
			return
		}
		const pos = RendererSDK.WorldToScreen(hero.RealPosition)
		if (pos === undefined) {
			return
		}
		RendererSDK.Text(this.debugText, pos, Color.White)
	}

	private GameEnded(): void {
		this.sleeper.FullReset()
		this.handled.clear()
		this.zones.length = 0
		this.pendingCasts.clear()
		this.afterEffects.length = 0
		this.lineZones.length = 0
		this.radialWaves.length = 0
		this.targetEffects.length = 0
		this.debugText = ""
		this.panel.Reset()
		this.escape.Reset()
		this.moveDodge.Reset()
		this.autoDisable.Reset()
	}
})()
