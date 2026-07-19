import {
	dotaunitorder_t,
	EntityManager,
	EventsSDK,
	ExecuteOrder,
	GameState,
	GridNav,
	Hero,
	ImageData,
	NetworkedParticle,
	ProjectileManager,
	Sleeper,
	Thinker,
	Unit,
	Vector3
} from "github.com/octarine-public/wrapper/index"

const DODGE_MARGIN = 60
const EXIT_MARGIN = 140
const BLOCK_TAIL = 0.15
const MOVE_SLEEP_MS = 120
const SEARCH_ANGLES = 24
const SEARCH_STEP = 40
const SEARCH_MAX = 1800
const SIDE_WEIGHT = 350
const HOPELESS_FACTOR = 1.6
const HOPELESS_SLACK = 0.25
const PARTICLE_TTL = 3
const PARTICLE_CAP = 64

const enum Shape {
	Line,
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
	readonly shape: Shape
	readonly radius: number
	readonly endRadius?: number
	readonly range?: number
	readonly speed?: number
	readonly delay?: number
	readonly growSpeed?: number
	readonly razeDist?: number
	readonly returns?: boolean
	readonly castGeo: CastGeo
	readonly particles?: string[]
}

const SPELLS: SpellDef[] = [
	{
		name: "pudge_meat_hook",
		shape: Shape.Line,
		radius: 100,
		range: 1300,
		speed: 1600,
		returns: true,
		castGeo: CastGeo.Line,
		particles: ["pudge_meathook"]
	},
	{
		name: "clinkz_burning_barrage",
		shape: Shape.Line,
		radius: 125,
		range: 1400,
		speed: 1800,
		castGeo: CastGeo.Line,
		particles: ["clinkz_searing_arrow_linear_proj"]
	},
	{
		name: "dragon_knight_breathe_fire",
		shape: Shape.Line,
		radius: 200,
		endRadius: 400,
		range: 900,
		speed: 1000,
		castGeo: CastGeo.Line,
		particles: ["dragon_knight_breathe_fire"]
	},
	{
		name: "drow_ranger_wave_of_silence",
		shape: Shape.Line,
		radius: 175,
		range: 1100,
		speed: 2000,
		castGeo: CastGeo.Line,
		particles: ["drow_silence_wave"]
	},
	{
		name: "earth_spirit_rolling_boulder",
		shape: Shape.Line,
		radius: 110,
		range: 1500,
		speed: 1200,
		castGeo: CastGeo.Line,
		particles: ["espirit_rollingboulder"]
	},
	{
		name: "grimstroke_stroke_of_fate",
		shape: Shape.Line,
		radius: 150,
		range: 1300,
		speed: 1800,
		castGeo: CastGeo.Line,
		particles: ["grimstroke_stroke_of_fate", "grimstroke_ink_wave"]
	},
	{
		name: "invoker_deafening_blast",
		shape: Shape.Line,
		radius: 225,
		range: 1000,
		speed: 1100,
		castGeo: CastGeo.Line,
		particles: ["invoker_deafening_blast"]
	},
	{
		name: "invoker_tornado",
		shape: Shape.Line,
		radius: 200,
		range: 3400,
		speed: 1200,
		castGeo: CastGeo.Line,
		particles: ["invoker_tornado"]
	},
	{
		name: "kunkka_ghostship",
		shape: Shape.Line,
		radius: 425,
		range: 2000,
		speed: 650,
		castGeo: CastGeo.Line,
		particles: ["kunkka_ghost_ship"]
	},
	{
		name: "lina_dragon_slave",
		shape: Shape.Line,
		radius: 200,
		endRadius: 275,
		range: 1075,
		speed: 1200,
		castGeo: CastGeo.Line,
		particles: ["lina_spell_dragon_slave"]
	},
	{
		name: "lion_impale",
		shape: Shape.Line,
		radius: 125,
		range: 900,
		speed: 1600,
		castGeo: CastGeo.Line,
		particles: ["lion_spell_impale"]
	},
	{
		name: "nyx_assassin_impale",
		shape: Shape.Line,
		radius: 125,
		range: 900,
		speed: 1600,
		castGeo: CastGeo.Line,
		particles: ["nyx_assassin_impale"]
	},
	{
		name: "mars_spear",
		shape: Shape.Line,
		radius: 130,
		range: 1100,
		speed: 1700,
		castGeo: CastGeo.Line,
		particles: ["mars_spear"]
	},
	{
		name: "mirana_arrow",
		shape: Shape.Line,
		radius: 115,
		range: 3000,
		speed: 857,
		castGeo: CastGeo.Line,
		particles: ["mirana_spell_arrow"]
	},
	{
		name: "morphling_waveform",
		shape: Shape.Line,
		radius: 150,
		range: 1200,
		speed: 1400,
		castGeo: CastGeo.Line,
		particles: ["morphling_waveform"]
	},
	{
		name: "pangolier_swashbuckle",
		shape: Shape.Line,
		radius: 175,
		range: 1100,
		speed: 1200,
		castGeo: CastGeo.Line,
		particles: ["pangolier_swashbuckler"]
	},
	{
		name: "sandking_burrowstrike",
		shape: Shape.Line,
		radius: 150,
		range: 900,
		speed: 1600,
		castGeo: CastGeo.Line,
		particles: ["sandking_burrowstrike"]
	},
	{
		name: "shadow_demon_shadow_poison",
		shape: Shape.Line,
		radius: 200,
		range: 1500,
		speed: 1000,
		castGeo: CastGeo.Line,
		particles: ["shadow_demon_shadow_poison_release"]
	},
	{
		name: "shredder_chakram",
		shape: Shape.Line,
		radius: 200,
		range: 1600,
		speed: 900,
		returns: true,
		castGeo: CastGeo.Line,
		particles: ["shredder_chakram"]
	},
	{
		name: "venomancer_venomous_gale",
		shape: Shape.Line,
		radius: 200,
		range: 1500,
		speed: 1200,
		castGeo: CastGeo.Line,
		particles: ["venomancer_venomous_gale"]
	},
	{
		name: "windrunner_powershot",
		shape: Shape.Line,
		radius: 125,
		range: 2600,
		speed: 3000,
		castGeo: CastGeo.Line,
		particles: ["windrunner_spell_powershot"]
	},
	{
		name: "hoodwink_sharpshooter",
		shape: Shape.Line,
		radius: 125,
		range: 3000,
		speed: 2500,
		castGeo: CastGeo.Line,
		particles: ["hoodwink_sharpshooter"]
	},
	{
		name: "magnataur_shockwave",
		shape: Shape.Line,
		radius: 175,
		range: 1150,
		speed: 1150,
		castGeo: CastGeo.Line,
		particles: ["magnataur_shockwave"]
	},
	{
		name: "monkey_king_boundless_strike",
		shape: Shape.Line,
		radius: 175,
		range: 1500,
		speed: 0,
		castGeo: CastGeo.Line,
		particles: ["monkey_king_strike"]
	},
	{
		name: "snapfire_scatterblast",
		shape: Shape.Line,
		radius: 150,
		endRadius: 400,
		range: 800,
		speed: 1000,
		castGeo: CastGeo.Line,
		particles: ["snapfire_shotgun"]
	},
	{
		name: "muerta_dead_shot",
		shape: Shape.Line,
		radius: 125,
		range: 1200,
		speed: 1200,
		castGeo: CastGeo.Line,
		particles: ["muerta_dead_shot"]
	},
	{
		name: "ancient_apparition_ice_blast",
		shape: Shape.Line,
		radius: 300,
		range: 2500,
		speed: 1200,
		castGeo: CastGeo.None,
		particles: ["ancient_apparition_ice_blast"]
	},
	{
		name: "jakiro_ice_path",
		shape: Shape.Line,
		radius: 150,
		range: 1100,
		speed: 0,
		delay: 0.5,
		castGeo: CastGeo.Line,
		particles: ["jakiro_ice_path"]
	},
	{
		name: "snapfire_firesnap_cookie",
		shape: Shape.Circle,
		radius: 250,
		delay: 1.2,
		castGeo: CastGeo.None,
		particles: ["snapfire_cookie_landing"]
	},
	{
		name: "bloodseeker_blood_rite",
		shape: Shape.Circle,
		radius: 600,
		delay: 2.6,
		castGeo: CastGeo.None,
		particles: ["bloodseeker_bloodritual", "blood_rite"]
	},
	{
		name: "death_prophet_silence",
		shape: Shape.Circle,
		radius: 425,
		delay: 0.4,
		castGeo: CastGeo.None,
		particles: ["death_prophet_silence"]
	},
	{
		name: "invoker_sun_strike",
		shape: Shape.Circle,
		radius: 175,
		delay: 1.7,
		castGeo: CastGeo.None,
		particles: ["invoker_sun_strike"]
	},
	{
		name: "kunkka_torrent",
		shape: Shape.Circle,
		radius: 225,
		delay: 1.6,
		castGeo: CastGeo.None,
		particles: ["kunkka_spell_torrent"]
	},
	{
		name: "leshrac_split_earth",
		shape: Shape.Circle,
		radius: 225,
		delay: 0.5,
		castGeo: CastGeo.None,
		particles: ["leshrac_split_earth"]
	},
	{
		name: "lina_light_strike_array",
		shape: Shape.Circle,
		radius: 225,
		delay: 0.5,
		castGeo: CastGeo.None,
		particles: ["lina_spell_light_strike_array"]
	},
	{
		name: "tiny_avalanche",
		shape: Shape.Circle,
		radius: 275,
		delay: 0.6,
		castGeo: CastGeo.None,
		particles: ["tiny_avalanche"]
	},
	{
		name: "faceless_void_chronosphere",
		shape: Shape.Circle,
		radius: 450,
		delay: 0,
		castGeo: CastGeo.None,
		particles: ["faceless_void_chronosphere"]
	},
	{
		name: "dawnbreaker_solar_guardian",
		shape: Shape.Circle,
		radius: 400,
		delay: 2.5,
		castGeo: CastGeo.None,
		particles: ["dawnbreaker_solar_guardian_landing"]
	},
	{
		name: "nevermore_shadowraze1",
		shape: Shape.Circle,
		radius: 250,
		razeDist: 200,
		castGeo: CastGeo.Raze
	},
	{
		name: "nevermore_shadowraze2",
		shape: Shape.Circle,
		radius: 250,
		razeDist: 450,
		castGeo: CastGeo.Raze
	},
	{
		name: "nevermore_shadowraze3",
		shape: Shape.Circle,
		radius: 250,
		razeDist: 700,
		castGeo: CastGeo.Raze
	},
	{
		name: "puck_illusory_orb",
		shape: Shape.Line,
		radius: 150,
		range: 1950,
		speed: 750,
		castGeo: CastGeo.Line,
		particles: ["puck_illusory_orb"]
	},
	{
		name: "queenofpain_sonic_wave",
		shape: Shape.Line,
		radius: 250,
		endRadius: 500,
		range: 1100,
		speed: 1300,
		castGeo: CastGeo.Line,
		particles: ["queen_sonic_wave"]
	},
	{
		name: "rattletrap_hookshot",
		shape: Shape.Line,
		radius: 125,
		range: 3000,
		speed: 2400,
		castGeo: CastGeo.Line,
		particles: ["rattletrap_hookshot"]
	},
	{
		name: "tidehunter_ravage",
		shape: Shape.Circle,
		radius: 1250,
		growSpeed: 675,
		castGeo: CastGeo.Self,
		particles: ["tidehunter_spell_ravage"]
	}
]

interface Threat {
	readonly key: string
	readonly def: SpellDef
	readonly start: Vector3
	readonly forward?: Vector3
	readonly length: number
	readonly radius: number
	readonly endRadius: number
	readonly speed: number
	readonly fixedDelay: number
	readonly bothWays: boolean
	readonly expire: number
}

interface ParticleThreat {
	readonly def: SpellDef
	readonly start: Vector3
	readonly forward?: Vector3
	readonly bornAt: number
	readonly expire: number
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
	private readonly particleMap = new Map<string, SpellDef>()
	private readonly particles = new Map<number, ParticleThreat>()
	private readonly holding = new Map<string, number>()
	private blockingUntil = 0
	private lastDodge = "none"

	constructor(slots: MoveDodgeSlot[]) {
		this.nameMap = new Map(slots.map(s => [s.def.name, s]))
		for (const slot of slots) {
			for (const path of slot.def.particles ?? []) {
				this.particleMap.set(path, slot.def)
			}
		}
		EventsSDK.on("PrepareUnitOrders", order => this.OnPrepareOrder(order))
		EventsSDK.on("ParticleCreated", particle => this.OnParticle(particle))
		EventsSDK.on("ParticleUpdated", particle => this.OnParticle(particle))
	}

	public get Status(): string {
		if (!this.moveDodgeEnabled) {
			return "move:off"
		}
		const lock = this.blockingUntil > GameState.RawGameTime ? "|lock" : ""
		if (this.sleeper.Sleeping("move")) {
			return `move:dodge(${this.lastDodge})${lock}`
		}
		return `move:watch${lock}`
	}

	public Tick(hero: Hero): void {
		this.PruneParticles()
		if (!this.moveDodgeEnabled || !hero.IsAlive) {
			this.holding.clear()
			return
		}
		const threats = this.CollectThreats(hero)
		this.UpdateHold(threats)
		if (hero.IsStunned || hero.IsHexed || hero.IsRooted || this.sleeper.Sleeping("move")) {
			return
		}

		const heroPos = hero.Position
		const hull = hero.HullRadius
		const hit = threats.filter(x => this.Penetration(x, heroPos, hull, DODGE_MARGIN) > 0)
		if (hit.length === 0) {
			return
		}

		const target = this.FindSafeSpot(hero, threats, hit, heroPos, hull)
		if (target === undefined) {
			return
		}

		hero.MoveTo(target, false, false)
		this.sleeper.Sleep(MOVE_SLEEP_MS, "move")
		this.lastDodge = `${hit[0].def.name}/${hit[0].key.charAt(0)}`
		for (const threat of hit) {
			this.holding.set(threat.key, threat.expire)
		}
	}

	public Reset(): void {
		this.sleeper.FullReset()
		this.holding.clear()
		this.particles.clear()
		this.blockingUntil = 0
		this.lastDodge = "none"
	}

	private UpdateHold(threats: Threat[]): void {
		const now = GameState.RawGameTime
		for (const [key, expire] of this.holding) {
			const threat = threats.find(x => x.key === key)
			if (threat !== undefined) {
				this.holding.set(key, threat.expire)
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
		this.CollectParticles(threats, now)
		return threats
	}

	private LineThreat(
		key: string,
		def: SpellDef,
		start: Vector3,
		forward: Vector3,
		length: number,
		fixedDelay: number,
		expire: number
	): Threat {
		return {
			key,
			def,
			start,
			forward,
			length: length + def.radius / 2 + EXIT_MARGIN,
			radius: def.radius,
			endRadius: def.endRadius ?? def.radius,
			speed: def.speed ?? 0,
			fixedDelay,
			bothWays: def.returns === true,
			expire
		}
	}

	private CircleThreat(
		key: string,
		def: SpellDef,
		center: Vector3,
		radius: number,
		hitDelay: number,
		expire: number
	): Threat {
		return {
			key,
			def,
			start: center,
			length: 0,
			radius,
			endRadius: radius,
			speed: 0,
			fixedDelay: Math.max(hitDelay, 0),
			bothWays: false,
			expire
		}
	}

	private CollectProjectiles(hero: Hero, threats: Threat[], now: number): void {
		for (const proj of ProjectileManager.AllLinearProjectiles) {
			if (!proj.IsValid) {
				continue
			}
			const source = proj.Source
			if (source instanceof Unit && !source.IsEnemy(hero)) {
				continue
			}
			const def = this.ResolveDef(proj.Ability?.Name, proj.ParticlePathNoEcon)
			if (def === undefined || def.shape !== Shape.Line) {
				continue
			}
			const speed = proj.Speed > 0 ? proj.Speed : def.speed ?? 1000
			const remaining = Math.max(proj.Distance - proj.Position.Distance2D(proj.Origin), 0)
			threats.push({
				key: `p${proj.ID}`,
				def,
				start: proj.Position,
				forward: proj.Forward,
				length: remaining + def.radius / 2 + EXIT_MARGIN,
				radius: def.radius,
				endRadius: def.endRadius ?? def.radius,
				speed,
				fixedDelay: 0,
				bothWays: def.returns === true,
				expire: now + remaining / Math.max(speed, 1)
			})
		}
	}

	private CollectThinkers(hero: Hero, threats: Threat[], now: number): void {
		for (const thinker of EntityManager.GetEntitiesByClass(Thinker)) {
			if (!thinker.IsValid || !thinker.IsAlive) {
				continue
			}
			for (const buff of thinker.Buffs) {
				const caster = buff.Caster
				if (caster instanceof Unit && !caster.IsEnemy(hero)) {
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
				const radius = Math.max(slot.def.radius, buff.Ability?.AOERadius ?? 0)
				const dieTime = buff.DieTime
				const expire = dieTime > now ? dieTime : now + (slot.def.delay ?? BLOCK_TAIL)
				const hitDelay = Math.min(expire - now, slot.def.delay ?? 0)
				threats.push(
					this.CircleThreat(
						`t${thinker.Index}${abilName}`,
						slot.def,
						thinker.Position,
						radius,
						hitDelay,
						expire
					)
				)
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
				const def = slot.def
				const elapsed = now - spell.IsInAbilityPhaseChangeTime
				const castLeft = Math.max(spell.CastPoint - elapsed, 0)
				const key = `c${enemy.Index}${spell.Name}`
				const angle = enemy.RotationRad

				if (def.castGeo === CastGeo.Self) {
					const grown =
						def.growSpeed !== undefined
							? Math.min(def.radius, elapsed * def.growSpeed + def.growSpeed / 2)
							: def.radius
					threats.push(
						this.CircleThreat(
							key,
							def,
							enemy.Position,
							Math.max(grown, 300),
							castLeft,
							now + castLeft + 0.4
						)
					)
					continue
				}
				if (def.castGeo === CastGeo.Raze) {
					const dist = def.razeDist ?? 0
					const center = new Vector3(
						enemy.Position.x + Math.cos(angle) * dist,
						enemy.Position.y + Math.sin(angle) * dist,
						enemy.Position.z
					)
					threats.push(this.CircleThreat(key, def, center, def.radius, castLeft, now + castLeft))
					continue
				}
				if (enemy.IsRotating) {
					continue
				}
				const forward = Vector3.FromAngle(angle)
				const range = Math.max(spell.CastRange, def.range ?? 0)
				const start = new Vector3(
					enemy.Position.x - forward.x * def.radius * 0.9,
					enemy.Position.y - forward.y * def.radius * 0.9,
					enemy.Position.z
				)
				const travel = def.speed !== undefined && def.speed > 0 ? range / def.speed : 0
				threats.push(
					this.LineThreat(
						key,
						def,
						start,
						forward,
						range + def.radius * 0.9,
						castLeft + (def.delay ?? 0),
						now + castLeft + (def.delay ?? 0) + travel
					)
				)
			}
		}
	}

	private CollectParticles(threats: Threat[], now: number): void {
		for (const [index, stored] of this.particles) {
			const def = stored.def
			const slot = this.nameMap.get(def.name)
			if (slot === undefined || !slot.enabled) {
				continue
			}
			if (stored.forward !== undefined && def.shape === Shape.Line) {
				const travelled = def.speed !== undefined && def.speed > 0 ? (now - stored.bornAt) * def.speed : 0
				const range = def.range ?? 1200
				const remaining = Math.max(range - travelled, 0)
				const head =
					travelled > 0
						? new Vector3(
								stored.start.x + stored.forward.x * travelled,
								stored.start.y + stored.forward.y * travelled,
								stored.start.z
						  )
						: stored.start
				const from = def.returns === true ? stored.start : head
				const length = def.returns === true ? range : remaining
				threats.push(
					this.LineThreat(`f${index}`, def, from, stored.forward, length, def.delay ?? 0, stored.expire)
				)
				continue
			}
			const hitDelay = Math.max(stored.bornAt + (def.delay ?? 0) - now, 0)
			const radius =
				def.growSpeed !== undefined
					? Math.min(def.radius, Math.max((now - stored.bornAt) * def.growSpeed, 300))
					: def.radius
			threats.push(this.CircleThreat(`f${index}`, def, stored.start, radius, hitDelay, stored.expire))
		}
	}

	private OnParticle(particle: NetworkedParticle): void {
		const def = this.ResolveDef(particle.Ability?.Name, particle.PathNoEcon)
		if (def === undefined) {
			return
		}
		const source = particle.Source ?? particle.AttachedTo
		if (source instanceof Unit && !source.IsEnemy()) {
			return
		}
		const start = this.ControlPoint(particle, 0)
		if (start === undefined) {
			return
		}
		if (source === undefined && this.HasAllyNear(start)) {
			return
		}
		const now = GameState.RawGameTime
		let forward: Nullable<Vector3>
		if (def.shape === Shape.Line) {
			const second = this.ControlPoint(particle, 1)
			if (second === undefined || second.Distance2D(start) < 1) {
				return
			}
			forward = second.Subtract(start).Normalize()
		}
		const travel = def.speed !== undefined && def.speed > 0 ? (def.range ?? 1200) / def.speed : 0
		const known = this.particles.get(particle.Index)
		this.particles.set(particle.Index, {
			def,
			start: known?.start ?? start.Clone(),
			forward,
			bornAt: known?.bornAt ?? now,
			expire: now + (def.delay ?? 0) + travel + 0.2
		})
		if (this.particles.size > PARTICLE_CAP) {
			const oldest = this.particles.keys().next().value
			if (oldest !== undefined) {
				this.particles.delete(oldest)
			}
		}
	}

	private HasAllyNear(pos: Vector3): boolean {
		return EntityManager.GetEntitiesByClass(Hero).some(
			x => x.IsValid && x.IsAlive && !x.IsEnemy() && !x.IsIllusion && x.Position.Distance2D(pos) < 250
		)
	}

	private ControlPoint(particle: NetworkedParticle, index: number): Nullable<Vector3> {
		const cp = particle.ControlPoints.get(index)
		if (cp !== undefined && cp.IsValid) {
			return cp
		}
		const fallback = particle.ControlPointsFallback.get(index)
		return fallback !== undefined && fallback.IsValid ? fallback : undefined
	}

	private PruneParticles(): void {
		const now = GameState.RawGameTime
		for (const [index, stored] of this.particles) {
			if (now > stored.expire || now - stored.bornAt > PARTICLE_TTL) {
				this.particles.delete(index)
			}
		}
	}

	private ResolveDef(abilName: Nullable<string>, path: string): Nullable<SpellDef> {
		if (abilName !== undefined) {
			const slot = this.nameMap.get(abilName)
			if (slot !== undefined) {
				return slot.enabled ? slot.def : undefined
			}
		}
		if (path.length === 0) {
			return undefined
		}
		for (const [needle, def] of this.particleMap) {
			if (path.includes(needle)) {
				return this.nameMap.get(def.name)?.enabled === true ? def : undefined
			}
		}
		return undefined
	}

	private Penetration(threat: Threat, pos: Vector3, hull: number, margin: number): number {
		const fwd = threat.forward
		if (fwd === undefined) {
			return threat.radius + hull + margin - threat.start.Distance2D(pos)
		}
		const dx = pos.x - threat.start.x
		const dy = pos.y - threat.start.y
		const along = dx * fwd.x + dy * fwd.y
		const back = threat.bothWays ? -threat.radius : -hull
		if (along < back || along > threat.length) {
			return -1
		}
		const ratio = threat.length > 0 ? Math.min(Math.max(along / threat.length, 0), 1) : 0
		const radius = threat.radius + (threat.endRadius - threat.radius) * ratio
		return radius + hull + margin - Math.abs(dx * fwd.y - dy * fwd.x)
	}

	private TimeToHit(threat: Threat, pos: Vector3): number {
		const fwd = threat.forward
		if (fwd === undefined || threat.speed <= 0) {
			return threat.fixedDelay
		}
		const dx = pos.x - threat.start.x
		const dy = pos.y - threat.start.y
		const along = dx * fwd.x + dy * fwd.y
		return threat.fixedDelay + Math.max(along - threat.radius, 0) / threat.speed
	}

	private FindSafeSpot(
		hero: Hero,
		threats: Threat[],
		hit: Threat[],
		heroPos: Vector3,
		hull: number
	): Nullable<Vector3> {
		const speed = Math.max(hero.IsMoving ? hero.MoveSpeed : hero.MoveSpeed * 0.9, 100)
		const budget = Math.min(...hit.map(x => this.TimeToHit(x, heroPos))) - GameState.InputLag
		const axes = hit.map(x => x.forward).filter((x): x is Vector3 => x !== undefined)
		let best: Nullable<Vector3>
		let bestCost = Number.MAX_VALUE
		let fallback: Nullable<Vector3>
		let fallbackCost = Number.MAX_VALUE

		for (let i = 0; i < SEARCH_ANGLES; i++) {
			const angle = (i / SEARCH_ANGLES) * Math.PI * 2
			const cos = Math.cos(angle)
			const sin = Math.sin(angle)
			const align = axes.reduce((acc, fwd) => Math.max(acc, Math.abs(cos * fwd.x + sin * fwd.y)), 0)
			const penalty = align * SIDE_WEIGHT
			for (let dist = SEARCH_STEP; dist <= SEARCH_MAX; dist += SEARCH_STEP) {
				const cost = dist + penalty
				if (cost >= fallbackCost) {
					break
				}
				const point = new Vector3(heroPos.x + cos * dist, heroPos.y + sin * dist, heroPos.z)
				if (GridNav !== undefined && !GridNav.IsTraversable(point)) {
					continue
				}
				if (threats.some(x => this.Penetration(x, point, hull, DODGE_MARGIN) > 0)) {
					continue
				}
				const need = dist / speed + hero.GetTurnTime(point)
				if (cost < fallbackCost && need <= budget * HOPELESS_FACTOR + HOPELESS_SLACK) {
					fallback = point
					fallbackCost = cost
				}
				if (need <= budget && cost < bestCost) {
					best = point
					bestCost = cost
				}
				break
			}
		}
		return best ?? fallback
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
