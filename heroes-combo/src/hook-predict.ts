import {
	EntityManager,
	GameState,
	Hero,
	pudge_meat_hook,
	Unit,
	Vector2,
	Vector3
} from "github.com/octarine-public/wrapper/index"

const SAMPLE_WINDOW = 0.6
const MAX_SAMPLES = 24
const INSTANT_WINDOW = 0.12

const HOOK_SPEED_FALLBACK = 1600
const HOOK_WIDTH_FALLBACK = 100
const HOOK_RANGE_FALLBACK = 1000

const MIN_SPEED = 20
const MIN_TURN_RATE = 0.25
const FORCED_SPEED_FACTOR = 1.35
const ZIGZAG_ERRATIC = 3.5
const SOLVE_PASSES = 4

const CHANCE_STATIC = 1
const CHANCE_FORCED = 0.95
const CHANCE_MOVING = 0.95
const CHANCE_ERRATIC = 0.5
const TURN_UNCERTAINTY = 180
const ACCEL_UNCERTAINTY = 0.35
const REACTION_UNCERTAINTY = 0.12

export const enum HookMotion {
	Static,
	Forced,
	Straight,
	Erratic
}

export interface IHookSolution {
	point: Vector3
	flightTime: number
	chance: number
	blocked: boolean
	outOfRange: boolean
	motion: HookMotion
}

interface ISample {
	pos: Vector3
	time: number
	angle: number
}

interface ITrack {
	samples: ISample[]
}

export class HookPredictor {
	private readonly tracks = new Map<number, ITrack>()

	public Update(hero: Hero): void {
		const now = GameState.RawGameTime
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!enemy.IsValid || !enemy.IsAlive || enemy.IsIllusion || !enemy.IsEnemy(hero)) {
				this.tracks.delete(enemy.Index)
				continue
			}
			if (!enemy.IsVisible) {
				this.tracks.delete(enemy.Index)
				continue
			}
			let track = this.tracks.get(enemy.Index)
			if (track === undefined) {
				track = { samples: [] }
				this.tracks.set(enemy.Index, track)
			}
			track.samples.push({ angle: enemy.RotationRad, pos: enemy.Position.Clone(), time: now })
			while (track.samples.length > MAX_SAMPLES || now - track.samples[0].time > SAMPLE_WINDOW) {
				if (track.samples.length <= 2) {
					break
				}
				track.samples.shift()
			}
		}
	}

	public Reset(): void {
		this.tracks.clear()
	}

	public Solve(hero: Hero, hook: pudge_meat_hook, target: Hero): IHookSolution {
		const speed = hook.GetBaseSpeedForLevel(hook.Level) || HOOK_SPEED_FALLBACK
		const width = this.Width(hook)
		const range = hook.CastRange > 0 ? hook.CastRange : HOOK_RANGE_FALLBACK
		const lead = hook.CastDelay + GameState.TickInterval
		const motion = this.Motion(target)
		const velocity = this.Velocity(target, motion)
		const turnRate = motion === HookMotion.Straight ? this.TurnRate(target) : 0
		const point = this.Intercept(hero, target, velocity, turnRate, speed, lead)
		const flightTime = hero.Distance2D(point) / speed
		const total = lead + flightTime
		return {
			blocked: this.PathBlocked(hero, width, target, point),
			chance: this.Chance(target, motion, turnRate, total, width),
			flightTime,
			motion,
			outOfRange: hero.Distance2D(point) > range || hero.Distance2D(target) > range,
			point
		}
	}

	public Width(hook: pudge_meat_hook): number {
		return hook.GetBaseAOERadiusForLevel(hook.Level) || HOOK_WIDTH_FALLBACK
	}

	// Capsule sweep: anything whose hull touches the flight corridor before the target
	// eats the hook, ally creeps and summons included.
	public PathBlocked(hero: Hero, width: number, target: Unit, point: Vector3): boolean {
		const start = new Vector2(hero.Position.x, hero.Position.y)
		const end = new Vector2(point.x, point.y)
		const reach = hero.Distance2D(target)
		return EntityManager.GetEntitiesByClass(Unit).some(unit => {
			if (unit === hero || unit === target || !unit.IsValid || !unit.IsAlive) {
				return false
			}
			if (unit.IsBuilding || unit.IsInvulnerable || unit.IsUntargetable || !unit.IsVisible) {
				return false
			}
			if (unit.IsCourier || unit.IsFlyingVisually) {
				return false
			}
			if (hero.Distance2D(unit) >= reach) {
				return false
			}
			const position = new Vector2(unit.Position.x, unit.Position.y)
			return position.DistanceSegment(start, end, true) <= width + unit.HullRadius
		})
	}

	private Motion(target: Hero): HookMotion {
		if (
			target.IsStunned ||
			target.IsRooted ||
			target.IsHexed ||
			target.IsChanneling ||
			target.IsInAbilityPhase ||
			!target.IsMoving
		) {
			return HookMotion.Static
		}
		const measured = this.InstantVelocity(target).Length2D
		if (measured > Math.max(target.MoveSpeed, 1) * FORCED_SPEED_FACTOR) {
			return HookMotion.Forced
		}
		return this.ZigZag(target) >= ZIGZAG_ERRATIC ? HookMotion.Erratic : HookMotion.Straight
	}

	// Falls back to heading * MoveSpeed: a target seen for only a tick or two has no
	// usable sample delta yet, and returning a zero vector there would silently degrade
	// every solve into "hook where he stands".
	private Velocity(target: Hero, motion: HookMotion): Vector3 {
		if (motion === HookMotion.Static) {
			return new Vector3()
		}
		const measured = motion === HookMotion.Erratic ? this.AverageVelocity(target) : this.InstantVelocity(target)
		if (measured.Length2D >= MIN_SPEED) {
			return measured
		}
		return target.IsMoving ? target.Forward.MultiplyScalar(target.MoveSpeed) : new Vector3()
	}

	private InstantVelocity(target: Hero): Vector3 {
		const track = this.tracks.get(target.Index)
		if (track === undefined || track.samples.length < 2) {
			return new Vector3()
		}
		const samples = track.samples
		const last = samples[samples.length - 1]
		let first = samples[0]
		for (let i = samples.length - 2; i >= 0; i--) {
			first = samples[i]
			if (last.time - first.time >= INSTANT_WINDOW) {
				break
			}
		}
		const dt = last.time - first.time
		if (dt <= 0) {
			return new Vector3()
		}
		return last.pos.Subtract(first.pos).MultiplyScalar(1 / dt)
	}

	private AverageVelocity(target: Hero): Vector3 {
		const track = this.tracks.get(target.Index)
		if (track === undefined || track.samples.length < 2) {
			return new Vector3()
		}
		const samples = track.samples
		const first = samples[0]
		const last = samples[samples.length - 1]
		const dt = last.time - first.time
		if (dt <= 0) {
			return new Vector3()
		}
		return last.pos.Subtract(first.pos).MultiplyScalar(1 / dt)
	}

	private TurnRate(target: Hero): number {
		const track = this.tracks.get(target.Index)
		if (track === undefined || track.samples.length < 3) {
			return 0
		}
		const samples = track.samples
		const first = samples[0]
		const last = samples[samples.length - 1]
		const dt = last.time - first.time
		if (dt <= 0) {
			return 0
		}
		return this.NormalizeAngle(last.angle - first.angle) / dt
	}

	// Total heading travel per second. A hero holding a curve scores low, one flicking
	// left-right every few ticks scores high even though its net rotation is zero.
	private ZigZag(target: Hero): number {
		const track = this.tracks.get(target.Index)
		if (track === undefined || track.samples.length < 3) {
			return 0
		}
		const samples = track.samples
		let travel = 0
		for (let i = 1; i < samples.length; i++) {
			travel += Math.abs(this.NormalizeAngle(samples[i].angle - samples[i - 1].angle))
		}
		const dt = samples[samples.length - 1].time - samples[0].time
		return dt <= 0 ? 0 : travel / dt
	}

	private NormalizeAngle(angle: number): number {
		let value = angle
		while (value > Math.PI) {
			value -= Math.PI * 2
		}
		while (value < -Math.PI) {
			value += Math.PI * 2
		}
		return value
	}

	// Seed with the closed-form straight-line intercept, then refine against the curved
	// and wall-clamped path — the real equation has no closed form once the target turns.
	private Intercept(
		hero: Hero,
		target: Hero,
		velocity: Vector3,
		turnRate: number,
		speed: number,
		lead: number
	): Vector3 {
		if (velocity.Length2D < MIN_SPEED) {
			return target.Position
		}
		let flight = this.StraightFlightTime(hero, target, velocity, speed, lead)
		let point = target.Position
		for (let i = 0; i < SOLVE_PASSES; i++) {
			point = this.Extrapolate(target, velocity, turnRate, lead + flight)
			flight = hero.Distance2D(point) / speed
		}
		return point
	}

	private StraightFlightTime(hero: Hero, target: Hero, velocity: Vector3, speed: number, lead: number): number {
		const origin = target.Position.Add(velocity.MultiplyScalar(lead)).Subtract(hero.Position)
		const a = velocity.Dot(velocity) - speed * speed
		const b = 2 * origin.Dot(velocity)
		const c = origin.Dot(origin)
		if (Math.abs(a) < 1e-4) {
			return Math.abs(b) < 1e-4 ? 0 : Math.max(-c / b, 0)
		}
		const discriminant = b * b - 4 * a * c
		if (discriminant < 0) {
			return origin.Length2D / speed
		}
		const root = Math.sqrt(discriminant)
		const first = (-b - root) / (2 * a)
		const second = (-b + root) / (2 * a)
		const positives = [first, second].filter(value => value > 0)
		return positives.length === 0 ? origin.Length2D / speed : Math.min(...positives)
	}

	// Constant-turn-rate arc, then clamped against the nav grid so a target running into
	// a cliff or a tree line is not extrapolated through it.
	private Extrapolate(target: Hero, velocity: Vector3, turnRate: number, time: number): Vector3 {
		const speed = velocity.Length2D
		if (speed < MIN_SPEED || time <= 0) {
			return target.Position
		}
		const heading = velocity.Normalize()
		if (Math.abs(turnRate) < MIN_TURN_RATE) {
			return target.ExtendUntilWall(target.Position, heading, speed * time)
		}
		const theta = turnRate * time
		const radius = speed / turnRate
		const side = new Vector3(-heading.y, heading.x, 0)
		const local = heading
			.MultiplyScalar(Math.sin(theta) * radius)
			.Add(side.MultiplyScalar((1 - Math.cos(theta)) * radius))
		const distance = local.Length2D
		if (distance < 1) {
			return target.Position
		}
		return target.ExtendUntilWall(target.Position, local.Normalize(), distance)
	}

	// Lateral error the target can still introduce before the hook arrives, measured
	// against the corridor half-width: the wider the hook, the more slop it forgives.
	private Chance(target: Hero, motion: HookMotion, turnRate: number, total: number, width: number): number {
		if (motion === HookMotion.Static) {
			return CHANCE_STATIC
		}
		const base =
			motion === HookMotion.Forced
				? CHANCE_FORCED
				: motion === HookMotion.Erratic
				? CHANCE_ERRATIC
				: CHANCE_MOVING
		if (motion === HookMotion.Forced) {
			return base
		}
		const turnError = Math.abs(turnRate) * total * TURN_UNCERTAINTY
		const accelError = this.AccelerationError(target, total) * ACCEL_UNCERTAINTY
		// Only a target that has actually been changing direction is charged for the
		// direction change it might still make. A hero holding one course for the whole
		// sample window is as predictable as a standing one.
		const steadiness = Math.min(this.ZigZag(target) / ZIGZAG_ERRATIC, 1)
		const reactError = target.MoveSpeed * total * REACTION_UNCERTAINTY * steadiness
		const sigma = turnError + accelError + reactError
		return base * (width / (width + sigma))
	}

	private AccelerationError(target: Hero, total: number): number {
		const instant = this.InstantVelocity(target)
		const average = this.AverageVelocity(target)
		return instant.Subtract(average).Length2D * total
	}
}
