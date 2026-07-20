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

import { CastMode, CounterSlot, CreateSlots, DangerKind } from "./counters"
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
const MANTA_IMPACT_PROJECTILES = new Set(["alchemist_unstable_concoction_throw", "huskar_life_break"])

const enum AreaMode {
	Caster,
	Delayed,
	Raze,
	Line
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
}

interface CastDef {
	delayKeys?: string[]
	delay?: number
}

const CAST_SPELLS: ReadonlyMap<string, CastDef> = new Map([
	["lion_finger_of_death", { delayKeys: ["damage_delay", "effect_delay", "delay"], delay: 0.25 }],
	["lina_laguna_blade", { delayKeys: ["damage_delay", "effect_delay", "delay"], delay: 0.25 }],
	["zuus_lightning_bolt", { delayKeys: ["strike_delay", "delay"], delay: 0.35 }]
])

const AREA_SPELLS: ReadonlyMap<string, AreaDef> = new Map([
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
		{ radius: 200, mode: AreaMode.Line, length: 1600, delayKeys: ["crack_time"], delay: 3.3 }
	],
	["invoker_sun_strike", { radius: 175, mode: AreaMode.Delayed, delayKeys: ["delay"], delay: 1.7 }],
	["invoker_emp", { radius: 675, mode: AreaMode.Delayed, delayKeys: ["delay"], delay: 2.9, castDetection: false }],
	["kunkka_torrent", { radius: 225, mode: AreaMode.Delayed, delayKeys: ["delay"], delay: 1.6 }],
	["bloodseeker_blood_bath", { radius: 600, mode: AreaMode.Delayed, delayKeys: ["delay"], delay: 2.6 }],
	["kunkka_ghostship", { radius: 425, mode: AreaMode.Delayed }],
	["lina_light_strike_array", { radius: 225, mode: AreaMode.Delayed, delayKeys: ["delay"], delay: 0.5 }],
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
	["warlock_rain_of_chaos", "warlock_rain_of_chaos"]
])

interface Danger {
	kind: DangerKind
	name: string
	timeLeft: number
	route: string
	projID?: number
}

interface PendingCast {
	ability: Ability
	startedAt: number
	lastActiveAt: number
	confirmed: boolean
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
			const ability = proj.Ability ?? lifeBreak
			const abilityName = ability?.Name ?? "projectile"
			const impactDodge = MANTA_IMPACT_PROJECTILES.has(abilityName)
			if (
				proj.Target !== hero ||
				proj.IsAttack ||
				(!proj.IsDodgeable && !impactDodge) ||
				proj.IsDodged ||
				this.handled.has(proj.ID)
			) {
				continue
			}
			const source = proj.Source ?? ability?.Owner
			if (!(source instanceof Unit) || !source.IsEnemy(hero)) {
				continue
			}
			let timeLeft = 0
			if (proj.Position.IsValid) {
				timeLeft = this.TrackingTimeLeft(proj.Position, proj.Speed || ability?.Speed || 1, hero)
			}
			found.push({
				kind: !proj.IsDodgeable && impactDodge ? DangerKind.Cast : DangerKind.Projectile,
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
		this.PowershotDanger(hero, found)
		this.BlastOffDanger(hero, found)
		this.CentaurStompDanger(hero, found)
		const enemies = EntityManager.GetEntitiesByClass(Hero)
		for (const enemy of enemies) {
			if (!enemy.IsEnemy(hero) || !enemy.IsValid || !enemy.IsAlive || !enemy.IsVisible || enemy.IsIllusion) {
				continue
			}
			this.CastDanger(enemy, hero, found)
		}
		this.ThinkerDanger(hero, found)
		this.ZoneDanger(hero, found)
		found.sort((a, b) => a.timeLeft - b.timeLeft)
		return found
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

	private PowershotDanger(hero: Hero, found: Danger[]): void {
		for (const proj of ProjectileManager.AllLinearProjectiles) {
			if (!proj.IsValid || !proj.Position.IsValid) {
				continue
			}
			const source = proj.Source
			if (!(source instanceof Unit) || !source.IsEnemy(hero)) {
				continue
			}
			const ability =
				proj.Ability ??
				(source instanceof Hero
					? source.Spells.find((x): x is Ability => x !== undefined && x.Name === POWERSHOT_NAME)
					: undefined)
			if (ability?.Name !== POWERSHOT_NAME && !proj.ParticlePathNoEcon.includes(POWERSHOT_PARTICLE)) {
				continue
			}
			const dx = hero.Position.x - proj.Position.x
			const dy = hero.Position.y - proj.Position.y
			const along = dx * proj.Forward.x + dy * proj.Forward.y
			const radius = Math.max(ability?.AOERadius ?? 0, POWERSHOT_RADIUS) + hero.HullRadius
			const remaining = Math.max(proj.Distance - proj.Position.Distance2D(proj.Origin), 0)
			if (along < -hero.HullRadius || along > remaining + radius) {
				continue
			}
			if (Math.abs(dx * proj.Forward.y - dy * proj.Forward.x) > radius) {
				continue
			}
			found.push({
				kind: DangerKind.AreaCast,
				name: POWERSHOT_NAME,
				timeLeft: Math.max(along, 0) / Math.max(proj.Speed, 1),
				route: "linear"
			})
		}
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
				"blast-off"
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
				"windup"
			)
		}
	}

	private AddTimedAreaDanger(
		hero: Hero,
		found: Danger[],
		name: string,
		position: Vector3,
		radius: number,
		timeLeft: number,
		route: string
	): void {
		this.AddZone(name, position.Clone(), radius, GameState.RawGameTime + timeLeft, route)
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
					const areaLeft = castLeft + this.ResolveDelay(abil, abil.Name, area.delayKeys, area.delay)
					const route = area.mode === AreaMode.Delayed ? "cast~" : "cast"
					found.push({
						kind: DangerKind.AreaCast,
						name: abil.Name,
						timeLeft: areaLeft,
						route
					})
					if (area.mode === AreaMode.Delayed || area.mode === AreaMode.Line) {
						this.AddZone(
							abil.Name,
							hero.Position.Clone(),
							radius,
							GameState.RawGameTime + areaLeft,
							area.mode === AreaMode.Delayed ? "cast~" : "line",
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
					route: "cast"
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
		const abilName = buff.Ability?.Name ?? AbilityNameFromModifier(buff.Name)
		const area = AREA_SPELLS.get(abilName)
		if (area === undefined || area.mode !== AreaMode.Delayed) {
			return
		}
		const parent = buff.Parent
		if (parent === undefined || !parent.IsValid) {
			return
		}
		const caster = buff.Caster
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
		const abilName = particle.Ability?.Name ?? this.ResolveParticleArea(particle.PathNoEcon)
		if (abilName === undefined) {
			return
		}
		const area = AREA_SPELLS.get(abilName)
		if (area === undefined || area.mode !== AreaMode.Delayed) {
			return
		}
		const source = particle.Source ?? particle.AttachedTo
		if (source instanceof Unit && !source.IsEnemy()) {
			return
		}
		const pos = this.ControlPoint(particle, 0)
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
				route: zone.route
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
		for (const slot of this.slots) {
			if (!slot.IsShown || !slot.CanUse(hero)) {
				continue
			}
			const danger = dangers.find(x => slot.Matches(x.kind, x.name) && slot.Covers(x.name, x.timeLeft))
			if (danger !== undefined) {
				return [slot, danger]
			}
		}
		return undefined
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
				danger.kind === DangerKind.Projectile ? "proj" : danger.kind === DangerKind.AreaCast ? "area" : "cast"
			dangerText = `${kind}/${danger.route} ${danger.name} ${Math.round(danger.timeLeft * 1000)}ms`
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
		this.debugText = ""
		this.panel.Reset()
		this.escape.Reset()
		this.moveDodge.Reset()
		this.autoDisable.Reset()
	}
})()
