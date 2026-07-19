import {
	Ability,
	EntityManager,
	EventsSDK,
	FakeUnit,
	Fountain,
	GameState,
	Hero,
	item_blink,
	LocalPlayer,
	NetworkedParticle,
	Sleeper,
	Unit,
	Vector3
} from "github.com/octarine-public/wrapper/index"

const TRIGGER_RADIUS = 1000
const AMBUSH_RADIUS = 800
const APPROACH_MIN = 200
const MAX_WALK_SPEED = 650
const WALK_MARGIN = 120
const CONTINUOUS_GAP = 0.35
const APPROACH_INFO_TTL = 3
const RECENT_CAST_SLACK = 2.5
const MIN_GAP_COOLDOWN = 5
const CAST_FRESH = 0.35
const ALLY_NEAR = 250
const PENDING_TIME = 0.5
const RETRIGGER_MS = 1000
const SELF_BLINK_TIME = 0.6
const SAFE_MIN_DIST = 600
const CANDIDATES = 16
const FOUNTAIN_BONUS = 150

const GAP_CLOSERS = new Set([
	"antimage_blink",
	"queenofpain_blink",
	"riki_blink_strike",
	"mirana_leap",
	"slark_pounce",
	"faceless_void_time_walk",
	"morphling_waveform",
	"earth_spirit_rolling_boulder",
	"phoenix_icarus_dive",
	"void_spirit_astral_step",
	"spectre_reality",
	"spectre_haunt",
	"magnataur_skewer",
	"tusk_snowball",
	"marci_rebound",
	"pangolier_swashbuckle",
	"puck_illusory_orb",
	"puck_ethereal_jaunt",
	"sandking_burrowstrike",
	"vengefulspirit_nether_swap",
	"primal_beast_onslaught",
	"dawnbreaker_converge",
	"io_relocate"
])

interface EnemyTrack {
	pos: Vector3
	time: number
	prevPos: Vector3
	prevTime: number
}

export class BlinkEscape {
	private enabled = true
	private seeded = false
	private pendingUntil = 0
	private selfBlinkUntil = 0
	private prevOwnCooldown = 0
	private reason = "none"
	private blink: Nullable<item_blink>
	private readonly sleeper = new Sleeper()
	private readonly tracks = new Map<number, EnemyTrack>()
	private readonly consumed = new Set<number>()

	constructor() {
		EventsSDK.on("ParticleCreated", particle => this.OnParticle(particle))
		EventsSDK.on("ParticleUpdated", particle => this.OnParticle(particle))
		EventsSDK.on("ParticleUnitPositionUpdated", (unit, particle) => this.OnUnitReveal(unit, particle))
	}

	public get Status(): string {
		if (!this.enabled) {
			return "esc:off"
		}
		if (this.blink === undefined || !this.blink.IsValid) {
			return "esc:no-blink"
		}
		if (this.pendingUntil > GameState.RawGameTime) {
			return `esc:cast(${this.reason})`
		}
		if (this.sleeper.Sleeping("escape")) {
			return `esc:cd(${this.reason})`
		}
		return "esc:watch"
	}

	public Tick(hero: Hero, enabled: boolean): void {
		this.enabled = enabled
		this.ResolveBlink(hero)
		this.TrackOwnBlink()
		this.WatchEnemies(hero)
		if (!this.enabled || !hero.IsAlive) {
			this.pendingUntil = 0
			return
		}
		if (this.pendingUntil <= GameState.RawGameTime) {
			return
		}
		const blink = this.blink
		if (blink === undefined || !blink.IsValid) {
			return
		}
		const dest = this.PickDestination(hero, blink.CastRange)
		hero.CastPosition(blink, dest, false, false)
	}

	public Reset(): void {
		this.seeded = false
		this.pendingUntil = 0
		this.selfBlinkUntil = 0
		this.prevOwnCooldown = 0
		this.reason = "none"
		this.blink = undefined
		this.sleeper.FullReset()
		this.tracks.clear()
		this.consumed.clear()
	}

	private get Hero(): Nullable<Hero> {
		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsValid) {
			return undefined
		}
		return hero
	}

	private ResolveBlink(hero: Hero): void {
		if (this.blink !== undefined && this.blink.IsValid) {
			return
		}
		this.blink = hero.Items.find((x): x is item_blink => x instanceof item_blink)
	}

	private WatchEnemies(hero: Hero): void {
		const now = GameState.RawGameTime
		const heroPos = hero.Position
		const active = this.seeded && this.enabled && hero.IsAlive
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!enemy.IsValid || !enemy.IsEnemy(hero) || enemy.IsIllusion) {
				continue
			}
			if (!enemy.IsAlive) {
				this.tracks.delete(enemy.Index)
				continue
			}
			if (!enemy.IsVisible) {
				continue
			}
			const cur = enemy.Position.Clone()
			const track = this.tracks.get(enemy.Index)
			const inRange = active && cur.Distance2D(heroPos) <= TRIGGER_RADIUS
			const reason = inRange ? this.ThreatReason(enemy, track, cur, heroPos, now) : undefined
			this.Track(enemy.Index, track, cur, now)
			if (reason !== undefined) {
				this.Trigger(reason)
			}
		}
		this.seeded = true
	}

	private Track(index: number, track: Nullable<EnemyTrack>, cur: Vector3, now: number): void {
		if (track === undefined) {
			this.tracks.set(index, { pos: cur, prevPos: cur, prevTime: now, time: now })
			return
		}
		track.prevPos = track.pos
		track.prevTime = track.time
		track.pos = cur
		track.time = now
	}

	private ThreatReason(
		enemy: Hero,
		track: Nullable<EnemyTrack>,
		cur: Vector3,
		heroPos: Vector3,
		now: number
	): Nullable<string> {
		if (track === undefined) {
			return "new"
		}
		const closed = track.pos.Distance2D(heroPos) - cur.Distance2D(heroPos)
		if (closed < APPROACH_MIN) {
			return undefined
		}
		const gap = now - track.time
		if (gap > CONTINUOUS_GAP) {
			if (cur.Distance2D(heroPos) <= AMBUSH_RADIUS) {
				return "fog"
			}
		} else if (closed > gap * MAX_WALK_SPEED + WALK_MARGIN) {
			return "jump"
		}
		return this.JustUsedGapCloser(enemy, now) ? "cd" : undefined
	}

	private JustUsedGapCloser(enemy: Hero, now: number): boolean {
		const blink = enemy.GetItemByClass(item_blink)
		if (blink !== undefined && this.JustCast(blink, now)) {
			return true
		}
		return enemy.Spells.some(x => x !== undefined && x.IsValid && GAP_CLOSERS.has(x.Name) && this.JustCast(x, now))
	}

	private JustCast(abil: Ability, now: number): boolean {
		if (abil.Cooldown <= 0 || abil.MaxCooldown < MIN_GAP_COOLDOWN) {
			return false
		}
		if (now - abil.CooldownChangeTime > CAST_FRESH) {
			return false
		}
		return abil.Cooldown >= abil.MaxCooldown - RECENT_CAST_SLACK
	}

	private OnUnitReveal(unit: FakeUnit | Unit, particle: Nullable<NetworkedParticle>): void {
		if (!this.enabled || particle === undefined || !this.IsBlinkArrival(particle)) {
			return
		}
		const hero = this.Hero
		if (hero === undefined || !hero.IsAlive) {
			return
		}
		if (unit instanceof Unit && (!unit.IsEnemy(hero) || unit.IsIllusion)) {
			return
		}
		const pos = unit.PredictedPosition
		if (!pos.IsValid || pos.Distance2D(hero.Position) > TRIGGER_RADIUS) {
			return
		}
		if (unit instanceof Unit && !this.IsApproachingPos(unit.Index, pos, hero.Position)) {
			return
		}
		this.Trigger("particle")
	}

	private OnParticle(particle: NetworkedParticle): void {
		if (!this.enabled || this.consumed.has(particle.Index) || !this.IsBlinkArrival(particle)) {
			return
		}
		const hero = this.Hero
		if (hero === undefined || !hero.IsAlive) {
			return
		}
		const attached = particle.AttachedTo ?? particle.ModifiersAttachedTo
		if (attached !== undefined) {
			this.HandleAttached(particle, attached, hero)
			return
		}
		const cp = this.ParticlePosition(particle)
		if (cp === undefined) {
			return
		}
		this.Consume(particle.Index)
		if (cp.Distance2D(hero.Position) > TRIGGER_RADIUS) {
			return
		}
		const source = particle.Source
		if (source !== undefined) {
			if (!source.IsEnemy(hero) || !this.IsApproachingPos(source.Index, cp, hero.Position)) {
				return
			}
			this.Trigger("particle")
			return
		}
		if (this.IsOwnBlink(cp, hero) || this.HasAllyNear(cp, hero)) {
			return
		}
		this.Trigger("particle")
	}

	private HandleAttached(particle: NetworkedParticle, attached: FakeUnit | Unit, hero: Hero): void {
		if (attached instanceof Unit && (!attached.IsEnemy(hero) || attached.IsIllusion)) {
			this.Consume(particle.Index)
			return
		}
		const pos = attached.PredictedPosition
		if (!pos.IsValid) {
			return
		}
		this.Consume(particle.Index)
		if (pos.Distance2D(hero.Position) > TRIGGER_RADIUS) {
			return
		}
		if (attached instanceof Unit && !this.IsApproachingPos(attached.Index, pos, hero.Position)) {
			return
		}
		this.Trigger("particle")
	}

	private IsBlinkArrival(particle: NetworkedParticle): boolean {
		const path = particle.PathNoEcon
		return path.includes("blink") && !path.includes("_start")
	}

	private ParticlePosition(particle: NetworkedParticle): Nullable<Vector3> {
		const cp = particle.ControlPoints.get(0)
		if (cp !== undefined && cp.IsValid) {
			return cp
		}
		const fallback = particle.ControlPointsFallback.get(0)
		if (fallback !== undefined && fallback.IsValid) {
			return fallback
		}
		return undefined
	}

	private Consume(index: number): void {
		this.consumed.add(index)
		if (this.consumed.size > 512) {
			this.consumed.clear()
			this.consumed.add(index)
		}
	}

	private IsApproachingPos(index: number, landing: Vector3, heroPos: Vector3): boolean {
		const track = this.tracks.get(index)
		if (track === undefined || GameState.RawGameTime - track.prevTime > APPROACH_INFO_TTL) {
			return true
		}
		return track.prevPos.Distance2D(heroPos) - landing.Distance2D(heroPos) >= APPROACH_MIN
	}

	private IsOwnBlink(pos: Vector3, hero: Hero): boolean {
		return this.selfBlinkUntil > GameState.RawGameTime && hero.Position.Distance2D(pos) <= ALLY_NEAR
	}

	private TrackOwnBlink(): void {
		const blink = this.blink
		if (blink === undefined || !blink.IsValid) {
			this.prevOwnCooldown = 0
			return
		}
		const cd = blink.Cooldown
		if (this.prevOwnCooldown <= 0 && cd > 4) {
			this.selfBlinkUntil = GameState.RawGameTime + SELF_BLINK_TIME
		}
		this.prevOwnCooldown = cd
	}

	private HasAllyNear(pos: Vector3, hero: Hero): boolean {
		return EntityManager.GetEntitiesByClass(Hero).some(
			x =>
				x.IsValid &&
				x !== hero &&
				!x.IsEnemy(hero) &&
				x.IsAlive &&
				!x.IsIllusion &&
				x.Position.Distance2D(pos) <= ALLY_NEAR
		)
	}

	private Trigger(reason: string): void {
		if (this.sleeper.Sleeping("escape")) {
			return
		}
		this.sleeper.Sleep(RETRIGGER_MS, "escape")
		this.reason = reason
		this.pendingUntil = GameState.RawGameTime + PENDING_TIME
	}

	private PickDestination(hero: Hero, range: number): Vector3 {
		const base = hero.Position
		const enemies = EntityManager.GetEntitiesByClass(Hero).filter(
			x => x.IsValid && x.IsEnemy(hero) && x.IsAlive && x.IsVisible && !x.IsIllusion
		)
		const fountainAngle = this.FountainAngle(hero, enemies)
		const primary = Vector3.FromAngle(fountainAngle).MultiplyScalar(range).AddForThis(base)
		if (enemies.length === 0 || this.MinEnemyDist(primary, enemies) >= SAFE_MIN_DIST) {
			return primary
		}
		let best = primary
		let bestScore = -Infinity
		for (let i = 0; i < CANDIDATES; i++) {
			const offset = (i * 2 * Math.PI) / CANDIDATES
			const dest = Vector3.FromAngle(fountainAngle + offset)
				.MultiplyScalar(range)
				.AddForThis(base)
			const score = this.MinEnemyDist(dest, enemies) + Math.cos(offset) * FOUNTAIN_BONUS
			if (score > bestScore) {
				bestScore = score
				best = dest
			}
		}
		return best
	}

	private FountainAngle(hero: Hero, enemies: Hero[]): number {
		const base = hero.Position
		const fountain = EntityManager.GetEntitiesByClass(Fountain).find(x => x.IsValid && !x.IsEnemy(hero))
		if (fountain !== undefined) {
			const pos = fountain.Position
			return Math.atan2(pos.y - base.y, pos.x - base.x)
		}
		let nearest: Nullable<Hero>
		let nearestDist = Infinity
		for (const enemy of enemies) {
			const dist = enemy.Position.DistanceSqr2D(base)
			if (dist < nearestDist) {
				nearestDist = dist
				nearest = enemy
			}
		}
		if (nearest !== undefined) {
			const pos = nearest.Position
			return Math.atan2(base.y - pos.y, base.x - pos.x)
		}
		return hero.RotationRad + Math.PI
	}

	private MinEnemyDist(dest: Vector3, enemies: Hero[]): number {
		let min = Infinity
		for (const enemy of enemies) {
			const dist = enemy.Position.Distance2D(dest)
			if (dist < min) {
				min = dist
			}
		}
		return min
	}
}
