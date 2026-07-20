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
	LocalPlayer,
	Modifier,
	NetworkedParticle,
	ProjectileManager,
	RendererSDK,
	Sleeper,
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
const ZONE_CAP = 32
const ZONE_MERGE_DIST = 200

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
}

interface CastDef {
	delayKeys?: string[]
	delay?: number
}

const CAST_SPELLS: ReadonlyMap<string, CastDef> = new Map([
	["lina_laguna_blade", { delayKeys: ["damage_delay", "effect_delay", "delay"], delay: 0.25 }],
	["zuus_lightning_bolt", { delayKeys: ["strike_delay", "delay"], delay: 0.35 }]
])

const AREA_SPELLS: ReadonlyMap<string, AreaDef> = new Map([
	["magnataur_reverse_polarity", { radius: 410, mode: AreaMode.Caster }],
	["enigma_black_hole", { radius: 420, mode: AreaMode.Caster }],
	["faceless_void_chronosphere", { radius: 450, mode: AreaMode.Caster }],
	["tidehunter_ravage", { radius: 1250, mode: AreaMode.Caster }],
	["earthshaker_echo_slam", { radius: 600, mode: AreaMode.Caster }],
	["sandking_epicenter", { radius: 600, mode: AreaMode.Caster }],
	["puck_dream_coil", { radius: 600, mode: AreaMode.Caster }],
	["axe_berserkers_call", { radius: 320, mode: AreaMode.Caster }],
	["disruptor_static_storm", { radius: 450, mode: AreaMode.Caster }],
	["winter_wyvern_winters_curse", { radius: 500, mode: AreaMode.Caster }],
	["void_spirit_astral_step", { radius: 450, mode: AreaMode.Caster }],
	["dark_seer_vacuum", { radius: 500, mode: AreaMode.Caster }],
	["pangolier_shield_crash", { radius: 400, mode: AreaMode.Caster }],
	["meepo_poof", { radius: 400, mode: AreaMode.Caster }],
	["roshan_slam", { radius: 400, mode: AreaMode.Caster }],
	["dark_willow_terrorize", { radius: 600, mode: AreaMode.Caster }],
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
	["kunkka_torrent", { radius: 225, mode: AreaMode.Delayed, delayKeys: ["delay"], delay: 1.6 }],
	["bloodseeker_blood_bath", { radius: 600, mode: AreaMode.Delayed, delayKeys: ["delay"], delay: 2.6 }],
	["kunkka_ghostship", { radius: 425, mode: AreaMode.Delayed }],
	["lina_light_strike_array", { radius: 225, mode: AreaMode.Delayed, delayKeys: ["delay"], delay: 0.5 }],
	["nevermore_shadowraze1", { radius: 250, mode: AreaMode.Raze, offset: 200 }],
	["nevermore_shadowraze2", { radius: 250, mode: AreaMode.Raze, offset: 450 }],
	["nevermore_shadowraze3", { radius: 250, mode: AreaMode.Raze, offset: 700 }]
])

const AREA_PARTICLES: ReadonlyMap<string, string> = new Map([
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
	private readonly zones: { name: string; pos: Vector3; radius: number; impact: number; route: string }[] = []
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
		for (const proj of projs) {
			alive.add(proj.ID)
			if (
				proj.Target !== hero ||
				proj.IsAttack ||
				!proj.IsDodgeable ||
				proj.IsDodged ||
				this.handled.has(proj.ID)
			) {
				continue
			}
			const source = proj.Source
			if (!(source instanceof Unit) || !source.IsEnemy(hero)) {
				continue
			}
			let timeLeft = 0
			if (proj.Position.IsValid) {
				const closing = proj.Speed + (hero.IsMoving ? hero.MoveSpeed : 0)
				timeLeft = proj.Position.Distance(hero.Position) / Math.max(closing, 1)
			}
			found.push({
				kind: DangerKind.Projectile,
				name: proj.Ability?.Name ?? "projectile",
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

	private CastDanger(enemy: Hero, hero: Hero, found: Danger[]): void {
		const lists: Nullable<Ability>[][] = [enemy.Spells, enemy.Items]
		for (const list of lists) {
			for (const abil of list) {
				if (abil === undefined || !abil.IsValid || !abil.IsInAbilityPhase) {
					continue
				}
				const castLeft = Math.max(abil.CastPoint - (GameState.RawGameTime - abil.IsInAbilityPhaseChangeTime), 0)
				const area = AREA_SPELLS.get(abil.Name)
				if (area !== undefined) {
					const proximity = area.mode === AreaMode.Delayed && area.castProximity === true
					if (proximity) {
						if (enemy.Distance2D(hero) > area.radius + hero.HullRadius) {
							continue
						}
					} else if (area.mode === AreaMode.Delayed || !this.InArea(enemy, hero, area)) {
						continue
					}
					const areaLeft = castLeft + this.ResolveDelay(abil, abil.Name, area.delayKeys, area.delay)
					found.push({
						kind: DangerKind.AreaCast,
						name: abil.Name,
						timeLeft: areaLeft,
						route: proximity ? "cast~" : "cast"
					})
					if (area.mode === AreaMode.Line || proximity) {
						this.AddZone(
							abil.Name,
							hero.Position.Clone(),
							area.radius,
							GameState.RawGameTime + areaLeft,
							proximity ? "cast~" : "line"
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
					this.AddZone(abil.Name, hero.Position.Clone(), 200, GameState.RawGameTime + totalLeft, "cast")
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
		this.AddZone(abilName, pos.Clone(), area.radius, GameState.RawGameTime + delay, "part")
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

	private AddZone(name: string, pos: Vector3, radius: number, impact: number, route: string): void {
		const known = this.zones.find(x => x.name === name && x.pos.Distance2D(pos) < ZONE_MERGE_DIST)
		if (known !== undefined) {
			known.impact = Math.min(known.impact, impact)
			return
		}
		this.zones.push({ name, pos, radius, impact, route })
		if (this.zones.length > ZONE_CAP) {
			this.zones.shift()
		}
	}

	private ZoneDanger(hero: Hero, found: Danger[]): void {
		const now = GameState.RawGameTime
		for (let i = this.zones.length - 1; i > -1; i--) {
			const zone = this.zones[i]
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
			const danger = dangers.find(x => slot.Matches(x.kind, x.name) && slot.Covers(x.timeLeft))
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
				counter =
					`${ready.def.key} want${Math.round((want?.timeLeft ?? 0) * 1000)} ` +
					`win[${Math.round(ready.GuardStart * 1000)}..${Math.round(ready.GuardEnd * 1000)}]`
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
		this.debugText = ""
		this.panel.Reset()
		this.escape.Reset()
		this.moveDodge.Reset()
		this.autoDisable.Reset()
	}
})()
