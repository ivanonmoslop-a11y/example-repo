import {
	dotaunitorder_t,
	EntityManager,
	EventsSDK,
	ExecuteOrder,
	GameState,
	GridNav,
	Hero,
	ImageData,
	ProjectileManager,
	Sleeper,
	Thinker,
	Unit,
	Vector3
} from "github.com/octarine-public/wrapper/index"

const DODGE_MARGIN = 60
const BLOCK_TAIL = 0.15
const MOVE_SLEEP_MS = 120
const CAST_FACING_ANGLE = 0.55
const CAST_LINE_TAIL = 0.35
const SEARCH_ANGLES = 16
const SEARCH_STEP = 60
const SEARCH_MAX = 1300

const enum DodgeKind {
	Linear,
	Circle
}

const enum CastGeo {
	None,
	Line,
	Self,
	Raze
}

export interface SpellDef {
	readonly name: string
	readonly kind: DodgeKind
	readonly radius: number
	readonly castGeo: CastGeo
	readonly lineLength?: number
	readonly razeDist?: number
	readonly particle?: string
}

const SPELLS: SpellDef[] = [
	{
		name: "pudge_meat_hook",
		kind: DodgeKind.Linear,
		radius: 100,
		castGeo: CastGeo.Line,
		lineLength: 1300,
		particle: "pudge_meathook"
	},
	{ name: "clinkz_burning_barrage", kind: DodgeKind.Linear, radius: 125, castGeo: CastGeo.Line },
	{ name: "dragon_knight_breathe_fire", kind: DodgeKind.Linear, radius: 275, castGeo: CastGeo.Line },
	{ name: "drow_ranger_wave_of_silence", kind: DodgeKind.Linear, radius: 250, castGeo: CastGeo.Line },
	{
		name: "earth_spirit_rolling_boulder",
		kind: DodgeKind.Linear,
		radius: 110,
		castGeo: CastGeo.Line,
		lineLength: 1500,
		particle: "espirit_rollingboulder"
	},
	{
		name: "grimstroke_stroke_of_fate",
		kind: DodgeKind.Linear,
		radius: 150,
		castGeo: CastGeo.Line,
		lineLength: 1500
	},
	{ name: "invoker_deafening_blast", kind: DodgeKind.Linear, radius: 225, castGeo: CastGeo.Line },
	{ name: "invoker_tornado", kind: DodgeKind.Linear, radius: 200, castGeo: CastGeo.Line },
	{ name: "kunkka_ghostship", kind: DodgeKind.Linear, radius: 425, castGeo: CastGeo.Line },
	{ name: "lina_dragon_slave", kind: DodgeKind.Linear, radius: 275, castGeo: CastGeo.Line },
	{ name: "lion_impale", kind: DodgeKind.Linear, radius: 125, castGeo: CastGeo.Line },
	{ name: "nyx_assassin_impale", kind: DodgeKind.Linear, radius: 125, castGeo: CastGeo.Line },
	{ name: "mars_spear", kind: DodgeKind.Linear, radius: 130, castGeo: CastGeo.Line },
	{ name: "mirana_arrow", kind: DodgeKind.Linear, radius: 115, castGeo: CastGeo.Line, lineLength: 3000 },
	{ name: "morphling_waveform", kind: DodgeKind.Linear, radius: 150, castGeo: CastGeo.Line },
	{
		name: "pangolier_swashbuckle",
		kind: DodgeKind.Linear,
		radius: 175,
		castGeo: CastGeo.Line,
		lineLength: 1100,
		particle: "pangolier_swashbuckler"
	},
	{
		name: "sandking_burrowstrike",
		kind: DodgeKind.Linear,
		radius: 150,
		castGeo: CastGeo.Line,
		particle: "sandking_burrowstrike"
	},
	{ name: "shadow_demon_shadow_poison", kind: DodgeKind.Linear, radius: 200, castGeo: CastGeo.Line },
	{ name: "shredder_chakram", kind: DodgeKind.Linear, radius: 200, castGeo: CastGeo.Line },
	{ name: "venomancer_venomous_gale", kind: DodgeKind.Linear, radius: 200, castGeo: CastGeo.Line },
	{ name: "windrunner_powershot", kind: DodgeKind.Linear, radius: 125, castGeo: CastGeo.Line, lineLength: 2600 },
	{ name: "hoodwink_sharpshooter", kind: DodgeKind.Linear, radius: 125, castGeo: CastGeo.Line, lineLength: 3000 },
	{ name: "magnataur_shockwave", kind: DodgeKind.Linear, radius: 175, castGeo: CastGeo.Line },
	{
		name: "monkey_king_boundless_strike",
		kind: DodgeKind.Linear,
		radius: 175,
		castGeo: CastGeo.Line,
		particle: "monkey_king_strike"
	},
	{
		name: "snapfire_scatterblast",
		kind: DodgeKind.Linear,
		radius: 300,
		castGeo: CastGeo.Line,
		lineLength: 800,
		particle: "snapfire_shotgun"
	},
	{ name: "muerta_dead_shot", kind: DodgeKind.Linear, radius: 125, castGeo: CastGeo.Line },
	{ name: "ancient_apparition_ice_blast", kind: DodgeKind.Linear, radius: 300, castGeo: CastGeo.None },
	{ name: "jakiro_ice_path", kind: DodgeKind.Linear, radius: 150, castGeo: CastGeo.None },
	{ name: "snapfire_firesnap_cookie", kind: DodgeKind.Circle, radius: 250, castGeo: CastGeo.None },
	{ name: "bloodseeker_blood_rite", kind: DodgeKind.Circle, radius: 600, castGeo: CastGeo.None },
	{ name: "death_prophet_silence", kind: DodgeKind.Circle, radius: 425, castGeo: CastGeo.None },
	{ name: "invoker_sun_strike", kind: DodgeKind.Circle, radius: 175, castGeo: CastGeo.None },
	{ name: "kunkka_torrent", kind: DodgeKind.Circle, radius: 225, castGeo: CastGeo.None },
	{ name: "leshrac_split_earth", kind: DodgeKind.Circle, radius: 225, castGeo: CastGeo.None },
	{ name: "lina_light_strike_array", kind: DodgeKind.Circle, radius: 225, castGeo: CastGeo.None },
	{ name: "tiny_avalanche", kind: DodgeKind.Circle, radius: 275, castGeo: CastGeo.None },
	{ name: "faceless_void_chronosphere", kind: DodgeKind.Circle, radius: 450, castGeo: CastGeo.None },
	{ name: "dawnbreaker_solar_guardian", kind: DodgeKind.Circle, radius: 400, castGeo: CastGeo.None },
	{ name: "nevermore_shadowraze1", kind: DodgeKind.Circle, radius: 250, castGeo: CastGeo.Raze, razeDist: 200 },
	{ name: "nevermore_shadowraze2", kind: DodgeKind.Circle, radius: 250, castGeo: CastGeo.Raze, razeDist: 450 },
	{ name: "nevermore_shadowraze3", kind: DodgeKind.Circle, radius: 250, castGeo: CastGeo.Raze, razeDist: 700 },
	{ name: "tidehunter_ravage", kind: DodgeKind.Circle, radius: 1250, castGeo: CastGeo.Self }
]

interface Threat {
	readonly key: string
	readonly def: SpellDef
	readonly center: Vector3
	readonly forward?: Vector3
	readonly length: number
	readonly expireTime: number
}

export interface MoveDodgeSlot {
	readonly def: SpellDef
	enabled: boolean
}

export function CreateMoveDodgeSlots(): MoveDodgeSlot[] {
	return SPELLS.map(def => ({ def, enabled: true }))
}

export function GetSlotTexture(slot: MoveDodgeSlot): string {
	return ImageData.GetSpellTexture(slot.def.name)
}

export class MoveDodge {
	public moveDodgeEnabled = true
	public blockControl = false
	private readonly sleeper = new Sleeper()
	private readonly nameMap: Map<string, MoveDodgeSlot>
	private readonly holding = new Map<string, number>()
	private blockingUntil = 0
	private lastDodgeName = ""

	constructor(slots: MoveDodgeSlot[]) {
		this.nameMap = new Map(slots.map(s => [s.def.name, s]))
		EventsSDK.on("PrepareUnitOrders", order => this.OnPrepareOrder(order))
	}

	public get Status(): string {
		if (!this.moveDodgeEnabled) {
			return "move:off"
		}
		const blocked = this.blockingUntil > GameState.RawGameTime ? "|lock" : ""
		if (this.sleeper.Sleeping("move")) {
			return `move:dodge(${this.lastDodgeName})${blocked}`
		}
		return `move:watch${blocked}`
	}

	public Tick(hero: Hero): void {
		if (!this.moveDodgeEnabled || !hero.IsAlive) {
			this.holding.clear()
			return
		}
		const threats = this.CollectThreats(hero)
		this.UpdateHold(threats)
		if (hero.IsStunned || hero.IsHexed || hero.IsRooted) {
			return
		}
		if (threats.length === 0 || this.sleeper.Sleeping("move")) {
			return
		}

		const heroPos = hero.Position
		const hull = hero.HullRadius
		const active = threats.filter(x => this.InDanger(x, heroPos, hull))
		if (active.length === 0) {
			return
		}

		const target = this.FindSafeSpot(threats, heroPos, hull)
		if (target === undefined) {
			return
		}

		hero.MoveTo(target, false, false)
		this.sleeper.Sleep(MOVE_SLEEP_MS, "move")
		this.lastDodgeName = active[0].def.name
		for (const threat of active) {
			this.holding.set(threat.key, threat.expireTime)
		}
	}

	public Reset(): void {
		this.sleeper.FullReset()
		this.holding.clear()
		this.blockingUntil = 0
		this.lastDodgeName = ""
	}

	private UpdateHold(threats: Threat[]): void {
		const now = GameState.RawGameTime
		const alive = new Set(threats.map(x => x.key))
		for (const [key, expire] of this.holding) {
			const stillLive = alive.has(key)
			if (stillLive) {
				const threat = threats.find(x => x.key === key)
				if (threat !== undefined) {
					this.holding.set(key, threat.expireTime)
				}
				continue
			}
			if (now > expire) {
				this.holding.delete(key)
			}
		}
		if (this.holding.size !== 0) {
			this.blockingUntil = now + BLOCK_TAIL
		}
	}

	private CollectThreats(hero: Hero): Threat[] {
		const threats: Threat[] = []
		const now = GameState.RawGameTime
		this.CollectProjectiles(hero, threats, now)
		this.CollectThinkers(hero, threats, now)
		this.CollectCasts(hero, threats, now)
		return threats
	}

	private CollectProjectiles(hero: Hero, threats: Threat[], now: number): void {
		for (const proj of ProjectileManager.AllLinearProjectiles) {
			if (!proj.IsValid) {
				continue
			}
			const source = proj.Source
			if (!(source instanceof Unit) || !source.IsEnemy(hero)) {
				continue
			}
			const def = this.ResolveProjectileDef(proj.Ability?.Name, proj.ParticlePathNoEcon)
			if (def === undefined) {
				continue
			}
			const remaining = Math.max(proj.GetRemainingTime(), 0)
			threats.push({
				key: `p${proj.ID}`,
				def,
				center: proj.Position,
				forward: proj.Forward,
				length: Math.max(proj.Distance, 1),
				expireTime: now + remaining
			})
		}
	}

	private ResolveProjectileDef(abilName: Nullable<string>, path: string): Nullable<SpellDef> {
		if (abilName !== undefined) {
			const slot = this.nameMap.get(abilName)
			if (slot !== undefined) {
				return slot.enabled ? slot.def : undefined
			}
		}
		if (path.length === 0) {
			return undefined
		}
		for (const slot of this.nameMap.values()) {
			const particle = slot.def.particle
			if (particle !== undefined && path.includes(particle)) {
				return slot.enabled ? slot.def : undefined
			}
		}
		return undefined
	}

	private CollectThinkers(hero: Hero, threats: Threat[], now: number): void {
		for (const thinker of EntityManager.GetEntitiesByClass(Thinker)) {
			if (!thinker.IsValid || !thinker.IsAlive) {
				continue
			}
			for (const buff of thinker.Buffs) {
				const caster = buff.Caster
				if (!(caster instanceof Unit) || !caster.IsEnemy(hero)) {
					continue
				}
				const abilName = buff.Ability?.Name
				if (abilName === undefined) {
					continue
				}
				const slot = this.nameMap.get(abilName)
				if (slot === undefined || !slot.enabled) {
					continue
				}
				const dieTime = buff.DieTime
				const expire = dieTime > now ? dieTime : now + BLOCK_TAIL
				threats.push({
					key: `t${thinker.Index}${abilName}`,
					def: slot.def,
					center: thinker.Position,
					length: 0,
					expireTime: expire
				})
			}
		}
	}

	private CollectCasts(hero: Hero, threats: Threat[], now: number): void {
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!enemy.IsValid || !enemy.IsAlive || !enemy.IsVisible || enemy.IsIllusion || !enemy.IsEnemy(hero)) {
				continue
			}
			for (const spell of enemy.Spells) {
				if (spell === undefined || !spell.IsValid || !spell.IsInAbilityPhase) {
					continue
				}
				const slot = this.nameMap.get(spell.Name)
				if (slot === undefined || !slot.enabled || slot.def.castGeo === CastGeo.None) {
					continue
				}
				const elapsed = now - spell.IsInAbilityPhaseChangeTime
				const expire = now + Math.max(spell.CastPoint - elapsed, 0) + CAST_LINE_TAIL
				const key = `c${enemy.Index}${spell.Name}`
				const angle = enemy.RotationRad
				if (slot.def.castGeo === CastGeo.Self) {
					threats.push({
						key,
						def: slot.def,
						center: enemy.Position,
						length: 0,
						expireTime: expire
					})
					continue
				}
				if (slot.def.castGeo === CastGeo.Raze) {
					const dist = slot.def.razeDist ?? 0
					threats.push({
						key,
						def: slot.def,
						center: new Vector3(
							enemy.Position.x + Math.cos(angle) * dist,
							enemy.Position.y + Math.sin(angle) * dist,
							enemy.Position.z
						),
						length: 0,
						expireTime: expire
					})
					continue
				}
				if (enemy.FindRotationAngle(hero) > CAST_FACING_ANGLE) {
					continue
				}
				const length = slot.def.lineLength ?? Math.max(spell.CastRange, 600)
				threats.push({
					key,
					def: slot.def,
					center: enemy.Position,
					forward: Vector3.FromAngle(angle),
					length,
					expireTime: expire
				})
			}
		}
	}

	private InDanger(threat: Threat, pos: Vector3, hull: number): boolean {
		return this.Penetration(threat, pos, hull, DODGE_MARGIN) > 0
	}

	private Penetration(threat: Threat, pos: Vector3, hull: number, margin: number): number {
		const danger = threat.def.radius + hull + margin
		const fwd = threat.forward
		if (fwd === undefined) {
			return danger - threat.center.Distance2D(pos)
		}
		const dx = pos.x - threat.center.x
		const dy = pos.y - threat.center.y
		const along = dx * fwd.x + dy * fwd.y
		if (along < -hull || along > threat.length) {
			return -1
		}
		return danger - Math.abs(dx * fwd.y - dy * fwd.x)
	}

	private FindSafeSpot(threats: Threat[], heroPos: Vector3, hull: number): Nullable<Vector3> {
		let best: Nullable<Vector3>
		let bestDist = Number.MAX_VALUE
		for (let i = 0; i < SEARCH_ANGLES; i++) {
			const angle = (i / SEARCH_ANGLES) * Math.PI * 2
			const cos = Math.cos(angle)
			const sin = Math.sin(angle)
			for (let dist = SEARCH_STEP; dist <= SEARCH_MAX; dist += SEARCH_STEP) {
				if (dist >= bestDist) {
					break
				}
				const point = new Vector3(heroPos.x + cos * dist, heroPos.y + sin * dist, heroPos.z)
				if (GridNav !== undefined && !GridNav.IsTraversable(point)) {
					continue
				}
				if (threats.some(x => this.Penetration(x, point, hull, DODGE_MARGIN) > 0)) {
					continue
				}
				best = point
				bestDist = dist
				break
			}
		}
		return best
	}

	private OnPrepareOrder(order: ExecuteOrder): false | undefined {
		if (!this.blockControl || !this.moveDodgeEnabled) {
			return undefined
		}
		if (GameState.RawGameTime > this.blockingUntil) {
			return undefined
		}
		if (!order.IsPlayerInput) {
			return undefined
		}
		switch (order.OrderType) {
			case dotaunitorder_t.DOTA_UNIT_ORDER_MOVE_TO_POSITION:
			case dotaunitorder_t.DOTA_UNIT_ORDER_MOVE_TO_DIRECTION:
			case dotaunitorder_t.DOTA_UNIT_ORDER_MOVE_TO_TARGET:
			case dotaunitorder_t.DOTA_UNIT_ORDER_ATTACK_MOVE:
			case dotaunitorder_t.DOTA_UNIT_ORDER_ATTACK_TARGET:
			case dotaunitorder_t.DOTA_UNIT_ORDER_HOLD_POSITION:
			case dotaunitorder_t.DOTA_UNIT_ORDER_STOP:
				return false
		}
		return undefined
	}
}
