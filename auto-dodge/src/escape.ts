import {
	EntityManager,
	EventsSDK,
	Fountain,
	GameState,
	Hero,
	item_blink,
	LocalPlayer,
	NetworkedParticle,
	Sleeper,
	Vector3
} from "github.com/octarine-public/wrapper/index"

const TRIGGER_RADIUS = 800
const JUMP_DIST = 550
const ALLY_NEAR = 250
const ENEMY_NEAR = 300
const PENDING_TIME = 0.5
const RETRIGGER_MS = 1000
const SAFE_MIN_DIST = 600
const CANDIDATES = 16
const FOUNTAIN_BONUS = 150
const CLAIM_TIME = 0.35
const SELF_BLINK_TIME = 0.6

export class BlinkEscape {
	private enabled = true
	private pendingUntil = 0
	private selfBlinkUntil = 0
	private prevOwnCooldown = 0
	private blink: Nullable<item_blink>
	private readonly sleeper = new Sleeper()
	private readonly lastSeen = new Map<number, [Vector3, number]>()
	private readonly consumed = new Set<number>()
	private readonly candidates = new Map<number, [Vector3, number]>()

	constructor() {
		EventsSDK.on("ParticleCreated", particle => this.OnParticle(particle))
		EventsSDK.on("ParticleUpdated", particle => this.OnParticle(particle))
	}

	public get Status(): string {
		if (!this.enabled) {
			return "esc:off"
		}
		if (this.blink === undefined || !this.blink.IsValid) {
			return "esc:no-blink"
		}
		if (this.pendingUntil > GameState.RawGameTime) {
			return "esc:cast"
		}
		if (this.candidates.size > 0) {
			return "esc:eval"
		}
		if (this.sleeper.Sleeping("escape")) {
			return "esc:cd"
		}
		return "esc:watch"
	}

	public Tick(hero: Hero, enabled: boolean): void {
		this.enabled = enabled
		this.ResolveBlink(hero)
		this.TrackOwnBlink()
		this.WatchJumps(hero)
		if (!this.enabled || !hero.IsAlive) {
			this.pendingUntil = 0
			this.candidates.clear()
			return
		}
		this.EvaluateCandidates(hero)
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
		this.pendingUntil = 0
		this.selfBlinkUntil = 0
		this.prevOwnCooldown = 0
		this.blink = undefined
		this.sleeper.FullReset()
		this.lastSeen.clear()
		this.consumed.clear()
		this.candidates.clear()
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

	private OnParticle(particle: NetworkedParticle): void {
		if (!this.enabled || this.consumed.has(particle.Index)) {
			return
		}
		const path = particle.PathNoEcon
		if (!path.includes("blink") || path.includes("_start")) {
			return
		}
		const hero = this.Hero
		if (hero === undefined || !hero.IsAlive) {
			return
		}
		const cp = particle.ControlPoints.get(0)
		if (cp === undefined || !cp.IsValid) {
			return
		}
		this.consumed.add(particle.Index)
		if (this.consumed.size > 512) {
			this.consumed.clear()
			this.consumed.add(particle.Index)
		}
		if (cp.Distance2D(hero.Position) > TRIGGER_RADIUS) {
			return
		}
		const source = particle.Source
		if (source !== undefined) {
			if (source.IsEnemy(hero)) {
				this.Trigger()
			}
			return
		}
		this.candidates.set(particle.Index, [cp.Clone(), GameState.RawGameTime + CLAIM_TIME])
	}

	private EvaluateCandidates(hero: Hero): void {
		if (this.candidates.size === 0) {
			return
		}
		const now = GameState.RawGameTime
		const heroes = EntityManager.GetEntitiesByClass(Hero)
		for (const [index, [pos, until]] of this.candidates) {
			if (this.HasEnemyNear(heroes, pos, hero)) {
				this.candidates.delete(index)
				this.Trigger()
				continue
			}
			if (this.IsOwnBlink(pos, hero) || this.HasAllyNear(heroes, pos, hero)) {
				this.candidates.delete(index)
				continue
			}
			if (now > until) {
				this.candidates.delete(index)
				this.Trigger()
			}
		}
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

	private WatchJumps(hero: Hero): void {
		const now = GameState.RawGameTime
		const enemies = EntityManager.GetEntitiesByClass(Hero)
		for (const enemy of enemies) {
			if (!enemy.IsValid || !enemy.IsEnemy(hero) || enemy.IsIllusion) {
				continue
			}
			if (!enemy.IsVisible || !enemy.IsAlive) {
				this.lastSeen.delete(enemy.Index)
				continue
			}
			const cur = enemy.Position.Clone()
			const prev = this.lastSeen.get(enemy.Index)
			this.lastSeen.set(enemy.Index, [cur, now])
			if (prev === undefined) {
				continue
			}
			const [prevPos, prevTime] = prev
			if (now - prevTime > GameState.TickInterval * 2.5) {
				continue
			}
			if (prevPos.Distance2D(cur) < JUMP_DIST) {
				continue
			}
			if (cur.Distance2D(hero.Position) > TRIGGER_RADIUS) {
				continue
			}
			if (this.enabled && hero.IsAlive) {
				this.Trigger()
			}
		}
	}

	private HasAllyNear(heroes: Hero[], pos: Vector3, hero: Hero): boolean {
		return heroes.some(
			x =>
				x.IsValid &&
				x !== hero &&
				!x.IsEnemy(hero) &&
				x.IsAlive &&
				!x.IsIllusion &&
				x.Position.Distance2D(pos) <= ALLY_NEAR
		)
	}

	private HasEnemyNear(heroes: Hero[], pos: Vector3, hero: Hero): boolean {
		return heroes.some(
			x =>
				x.IsValid &&
				x.IsEnemy(hero) &&
				x.IsAlive &&
				x.IsVisible &&
				!x.IsIllusion &&
				x.Position.Distance2D(pos) <= ENEMY_NEAR
		)
	}

	private Trigger(): void {
		if (this.sleeper.Sleeping("escape")) {
			return
		}
		this.sleeper.Sleep(RETRIGGER_MS, "escape")
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
