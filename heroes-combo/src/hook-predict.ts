import {
	EntityManager,
	GameState,
	Hero,
	pudge_meat_hook,
	QAngle,
	Unit,
	Vector2,
	Vector3
} from "github.com/octarine-public/wrapper/index"

const HISTORY_WINDOW = 5
const VELOCITY_WINDOW = 0.14
const TURN_WINDOW = 0.22
const MAX_SAMPLES = 256
const STALE_POSITION = 0.2

const HOOK_SPEED_FALLBACK = 1600
const HOOK_WIDTH_FALLBACK = 100
const HOOK_RANGE_FALLBACK = 1000
const MIN_SPEED = 20
const FORCED_SPEED_FACTOR = 1.25
const MAX_SPEED_FACTOR = 1.65
const TURNING_RATE = 0.45
const ERRATIC_TURN_RATE = 1.8
const INTERCEPT_PASSES = 10

const BANNED_MODIFIERS = [
	"modifier_puck_phase_shift",
	"modifier_obsidian_destroyer_astral_imprisonment_prison",
	"modifier_shadow_demon_disruption",
	"modifier_eul_cyclone",
	"modifier_cyclone",
	"modifier_invoker_tornado"
]

const TRACKED_HIDDEN_MODIFIERS = ["modifier_slark_shadow_dance", "modifier_slark_depth_shroud"]

const FORCED_MOVEMENT_MODIFIERS = [
	"modifier_tiny_toss",
	"modifier_magnataur_skewer_movement",
	"modifier_slark_pounce",
	"modifier_earth_spirit_rolling_boulder_caster",
	"modifier_phoenix_icarus_dive",
	"modifier_mirana_leap",
	"modifier_marci_lunge_arc",
	"modifier_marci_lunge_tracking_motion",
	"modifier_wind_waker",
	"modifier_disruptor_glimpse",
	"modifier_huskar_life_break_charge",
	"modifier_snapfire_firesnap_cookie_short_hop",
	"modifier_spirit_breaker_charge_of_darkness",
	"modifier_techies_suicide_leap",
	"modifier_monkey_king_bounce_leap",
	"modifier_tusk_walrus_kick_air_time",
	"modifier_knockback",
	"modifier_item_forcestaff_active",
	"modifier_item_hurricane_pike_active",
	"modifier_pangolier_swashbuckle",
	"modifier_pangolier_shield_crash_jump",
	"modifier_tusk_snowball_movement",
	"modifier_tusk_snowball_movement_friendly",
	"modifier_primal_beast_onslaught_movement_adjustable",
	"modifier_void_spirit_astral_step_caster",
	"modifier_tusk_drinking_buddies_pull"
]

export const enum HookMotion {
	Static,
	Forced,
	Straight,
	Turning,
	Erratic
}

export interface IHookPredictOptions {
	allowForced: boolean
	allowMoving: boolean
	predictBlockers: boolean
	castDelay?: number
}

export interface IHookSolution {
	point: Vector3
	flightTime: number
	totalTime: number
	chance: number
	blocked: boolean
	blocker?: Unit
	outOfRange: boolean
	motion: HookMotion
	reason: string
}

interface ISample {
	position: Vector3
	time: number
	heading: number
}

interface ITrack {
	samples: ISample[]
}

interface IMovementModel {
	motion: HookMotion
	velocity: Vector3
	turnRate: number
	speedChange: number
}

interface IIntercept {
	castDelay: number
	flightTime: number
	origin: Vector3
	point: Vector3
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
			if (!enemy.IsVisible && !TRACKED_HIDDEN_MODIFIERS.some(name => enemy.HasBuffByName(name))) {
				continue
			}
			let track = this.tracks.get(enemy.Index)
			if (track === undefined) {
				track = { samples: [] }
				this.tracks.set(enemy.Index, track)
			}
			const last = track.samples[track.samples.length - 1]
			if (last === undefined || last.time !== now) {
				track.samples.push({ heading: enemy.RotationRad, position: enemy.Position.Clone(), time: now })
			}
			while (track.samples.length > MAX_SAMPLES || now - track.samples[0].time > HISTORY_WINDOW) {
				track.samples.shift()
			}
		}
	}

	public Reset(): void {
		this.tracks.clear()
	}

	public HistoricalPosition(target: Hero, secondsAgo: number): Vector3 | undefined {
		const samples = this.tracks.get(target.Index)?.samples
		if (samples === undefined || samples.length === 0) {
			return undefined
		}
		const wantedTime = GameState.RawGameTime - Math.max(secondsAgo, 0)
		let closest = samples[0]
		let closestDelta = Math.abs(closest.time - wantedTime)
		for (let index = 1; index < samples.length; index++) {
			const sample = samples[index]
			const delta = Math.abs(sample.time - wantedTime)
			if (delta >= closestDelta) {
				continue
			}
			closest = sample
			closestDelta = delta
		}
		return closest.position.Clone()
	}

	public Solve(hero: Hero, hook: pudge_meat_hook, target: Hero, options: IHookPredictOptions): IHookSolution {
		const speed = hook.GetBaseSpeedForLevel(hook.Level) || HOOK_SPEED_FALLBACK
		const width = this.Width(hook)
		const range = hook.GetSpecialValue("hook_distance", hook.Level) || hook.CastRange || HOOK_RANGE_FALLBACK
		const model = this.Movement(target)
		const invalid = this.InvalidReason(target, model.motion, options)
		const intercept = this.Intercept(hero, hook, target, model, speed, options.castDelay)
		const totalTime = intercept.castDelay + intercept.flightTime
		const outOfRange = intercept.origin.Distance2D(intercept.point) > range + target.HullRadius
		const blocker =
			options.predictBlockers && !outOfRange
				? this.PathBlocker(hero, target, intercept.origin, intercept.point, width, speed, intercept.castDelay)
				: undefined
		return {
			blocked: blocker !== undefined,
			blocker,
			chance: invalid === undefined ? this.Chance(target, model, totalTime, width) : 0,
			flightTime: intercept.flightTime,
			motion: model.motion,
			outOfRange,
			point: intercept.point,
			reason: invalid ?? (outOfRange ? "out of range" : blocker === undefined ? "ok" : "confirmed blocker"),
			totalTime
		}
	}

	public SolvePoint(
		hero: Hero,
		hook: pudge_meat_hook,
		target: Nullable<Unit>,
		point: Vector3,
		options: IHookPredictOptions
	): IHookSolution {
		const speed = hook.GetBaseSpeedForLevel(hook.Level) || HOOK_SPEED_FALLBACK
		const width = this.Width(hook)
		const range = hook.GetSpecialValue("hook_distance", hook.Level) || hook.CastRange || HOOK_RANGE_FALLBACK
		const angle = new QAngle(0, hero.Position.GetAngleTo(point), 0)
		const origin = hook.GetProjectileStartingPosition(hero.Position, angle)
		const castDelay = options.castDelay ?? hook.GetCastDelay(point) + GameState.TickInterval
		const flightTime = origin.Distance2D(point) / speed
		const targetHullRadius = target?.HullRadius ?? 24
		const outOfRange = origin.Distance2D(point) > range + targetHullRadius
		const blocker =
			options.predictBlockers && !outOfRange
				? this.PathBlocker(hero, target, origin, point, width, speed, castDelay)
				: undefined
		return {
			blocked: blocker !== undefined,
			blocker,
			chance: 0.99,
			flightTime,
			motion: HookMotion.Static,
			outOfRange,
			point: point.Clone(),
			reason: outOfRange ? "out of range" : blocker === undefined ? "ok" : "confirmed blocker",
			totalTime: castDelay + flightTime
		}
	}

	public SolveExit(
		hero: Hero,
		hook: pudge_meat_hook,
		target: Hero,
		remaining: number,
		options: IHookPredictOptions
	): IHookSolution {
		const movement = this.Movement(target)
		const point = this.PredictPosition(target, movement.velocity, Math.max(remaining, 0))
		return this.SolvePoint(hero, hook, target, point, options)
	}

	public Width(hook: pudge_meat_hook): number {
		return hook.GetBaseAOERadiusForLevel(hook.Level) || HOOK_WIDTH_FALLBACK
	}

	private InvalidReason(target: Hero, motion: HookMotion, options: IHookPredictOptions): string | undefined {
		if (
			!target.IsValid ||
			!target.IsAlive ||
			target.IsIllusion ||
			(!target.IsVisible && !TRACKED_HIDDEN_MODIFIERS.some(name => target.HasBuffByName(name)))
		) {
			return "invalid target"
		}
		if (target.IsInvulnerable || target.IsUntargetable) {
			return "unhittable target"
		}
		if (BANNED_MODIFIERS.some(name => target.HasBuffByName(name))) {
			return "banished or phased target"
		}
		const samples = this.tracks.get(target.Index)?.samples
		const latest = samples?.[samples.length - 1]
		if (latest === undefined || GameState.RawGameTime - latest.time > STALE_POSITION) {
			return "stale position"
		}
		if (motion === HookMotion.Forced && !options.allowForced) {
			return "forced movement disabled"
		}
		if (motion !== HookMotion.Static && motion !== HookMotion.Forced && !options.allowMoving) {
			return "moving targets disabled"
		}
		return undefined
	}

	private Movement(target: Hero): IMovementModel {
		const measured = this.MeasuredVelocity(target, VELOCITY_WINDOW)
		const forced = FORCED_MOVEMENT_MODIFIERS.some(name => target.HasBuffByName(name))
		const forcedBySpeed = measured.Length2D > Math.max(target.MoveSpeed, 1) * FORCED_SPEED_FACTOR
		if (forced || forcedBySpeed) {
			return {
				motion: HookMotion.Forced,
				speedChange: this.SpeedChange(target),
				turnRate: 0,
				velocity: measured.Length2D >= MIN_SPEED ? measured : target.Forward.MultiplyScalar(target.MoveSpeed)
			}
		}
		if (
			target.IsStunned ||
			target.IsRooted ||
			target.IsHexed ||
			target.IsChanneling ||
			target.IsInAbilityPhase ||
			!target.IsMoving
		) {
			return { motion: HookMotion.Static, speedChange: 0, turnRate: 0, velocity: new Vector3() }
		}

		const turnRate = this.TurnRate(target)
		const zigZag = this.HeadingTravel(target)
		const motion =
			zigZag >= ERRATIC_TURN_RATE
				? HookMotion.Erratic
				: Math.abs(turnRate) >= TURNING_RATE
				? HookMotion.Turning
				: HookMotion.Straight
		return {
			motion,
			speedChange: this.SpeedChange(target),
			turnRate,
			velocity: this.IntendedVelocity(target, measured)
		}
	}

	// Position samples trail the networked facing angle during turns. Use them for
	// actual speed, but use the current facing for the future movement direction.
	private IntendedVelocity(target: Hero, measured: Vector3): Vector3 {
		let speed = target.MoveSpeed
		if (measured.Length2D >= MIN_SPEED) {
			speed = Math.min(Math.max(measured.Length2D, speed * 0.75), speed * 1.15)
		}
		return target.Forward.MultiplyScalar(speed)
	}

	private Intercept(
		hero: Hero,
		hook: pudge_meat_hook,
		target: Hero,
		model: IMovementModel,
		projectileSpeed: number,
		castDelayOverride?: number
	): IIntercept {
		let point = target.Position
		let origin = hero.Position
		let castDelay = hook.CastDelay + GameState.TickInterval
		let flightTime = hero.Distance2D(target) / projectileSpeed

		for (let pass = 0; pass < INTERCEPT_PASSES; pass++) {
			const angle = new QAngle(0, hero.Position.GetAngleTo(point), 0)
			origin = hook.GetProjectileStartingPosition(hero.Position, angle)
			castDelay = castDelayOverride ?? hook.GetCastDelay(point) + GameState.TickInterval
			flightTime = origin.Distance2D(point) / projectileSpeed
			point = this.PredictPosition(target, model.velocity, castDelay + flightTime)
		}

		flightTime = origin.Distance2D(point) / projectileSpeed
		return { castDelay, flightTime, origin, point }
	}

	private PredictPosition(target: Unit, velocity: Vector3, time: number): Vector3 {
		const speed = velocity.Length2D
		if (speed < MIN_SPEED || time <= 0) {
			return target.Position
		}
		return target.ExtendUntilWall(target.Position, velocity.Clone().Normalize(), speed * time)
	}

	private Chance(target: Hero, model: IMovementModel, totalTime: number, width: number): number {
		if (model.motion === HookMotion.Static) {
			return 0.99
		}
		if (model.motion === HookMotion.Forced) {
			return 0.94
		}
		const base = model.motion === HookMotion.Straight ? 0.97 : model.motion === HookMotion.Turning ? 0.78 : 0.58
		const turnError = Math.min(Math.abs(model.turnRate), Math.PI) * target.MoveSpeed * totalTime * 0.12
		const speedError = model.speedChange * Math.min(totalTime, 1) * 0.3
		const uncertainty = turnError + speedError
		return (base * (width + target.HullRadius)) / (width + target.HullRadius + uncertainty)
	}

	private PathBlocker(
		hero: Hero,
		target: Nullable<Unit>,
		origin: Vector3,
		point: Vector3,
		width: number,
		projectileSpeed: number,
		castDelay: number
	): Unit | undefined {
		const direction = origin.GetDirection2DTo(point)
		const targetDistance = origin.Distance2D(point)
		const start = new Vector2(origin.x, origin.y)
		const end = new Vector2(point.x, point.y)
		let first: Unit | undefined
		let firstDistance = Number.MAX_VALUE

		for (const unit of EntityManager.GetEntitiesByClass(Unit)) {
			if (!this.CanBlock(hero, target, unit)) {
				continue
			}
			const initialAlong = unit.Position.Subtract(origin).Dot(direction)
			if (initialAlong <= 0 || initialAlong >= targetDistance || initialAlong >= firstDistance) {
				continue
			}
			const hitTime = castDelay + initialAlong / projectileSpeed
			const projected = this.ProjectBlocker(unit, hitTime)
			const along = projected.Subtract(origin).Dot(direction)
			if (along <= 0 || along >= targetDistance - (target?.HullRadius ?? 24) || along >= firstDistance) {
				continue
			}
			const projected2D = new Vector2(projected.x, projected.y)
			if (projected2D.DistanceSegment(start, end, true) > width + unit.HullRadius) {
				continue
			}
			first = unit
			firstDistance = along
		}
		return first
	}

	private CanBlock(hero: Hero, target: Nullable<Unit>, unit: Unit): boolean {
		return (
			unit !== hero &&
			unit !== target &&
			unit.IsValid &&
			unit.IsAlive &&
			unit.IsVisible &&
			!unit.IsBuilding &&
			!unit.IsCourier &&
			!unit.IsInvulnerable &&
			!unit.IsUntargetable &&
			!unit.IsFlyingVisually
		)
	}

	private ProjectBlocker(unit: Unit, time: number): Vector3 {
		if (!unit.IsMoving || unit.MoveSpeed < MIN_SPEED) {
			return unit.Position
		}
		return unit.ExtendUntilWall(unit.Position, unit.Forward, unit.MoveSpeed * Math.max(time, 0))
	}

	private MeasuredVelocity(target: Hero, window: number): Vector3 {
		const samples = this.tracks.get(target.Index)?.samples
		if (samples === undefined || samples.length < 2) {
			return new Vector3()
		}
		const last = samples[samples.length - 1]
		let first = samples[0]
		for (let index = samples.length - 2; index >= 0; index--) {
			first = samples[index]
			if (last.time - first.time >= window) {
				break
			}
		}
		const elapsed = last.time - first.time
		return elapsed <= 0 ? new Vector3() : last.position.Subtract(first.position).MultiplyScalar(1 / elapsed)
	}

	private SpeedChange(target: Hero): number {
		const short = this.MeasuredVelocity(target, VELOCITY_WINDOW).Length2D
		const long = this.MeasuredVelocity(target, HISTORY_WINDOW * 0.8).Length2D
		return Math.min(Math.abs(short - long), target.MoveSpeed * MAX_SPEED_FACTOR)
	}

	private TurnRate(target: Hero): number {
		const samples = this.tracks.get(target.Index)?.samples
		if (samples === undefined || samples.length < 2) {
			return 0
		}
		const last = samples[samples.length - 1]
		let first = samples[0]
		for (let index = samples.length - 2; index >= 0; index--) {
			first = samples[index]
			if (last.time - first.time >= TURN_WINDOW) {
				break
			}
		}
		const elapsed = last.time - first.time
		return elapsed <= 0 ? 0 : this.NormalizeAngle(last.heading - first.heading) / elapsed
	}

	private HeadingTravel(target: Hero): number {
		const samples = this.tracks.get(target.Index)?.samples
		if (samples === undefined || samples.length < 3) {
			return 0
		}
		const lastTime = samples[samples.length - 1].time
		let travel = 0
		let elapsed = 0
		for (let index = samples.length - 1; index > 0; index--) {
			const current = samples[index]
			const previous = samples[index - 1]
			if (lastTime - previous.time > TURN_WINDOW) {
				break
			}
			travel += Math.abs(this.NormalizeAngle(current.heading - previous.heading))
			elapsed = lastTime - previous.time
		}
		return elapsed <= 0 ? 0 : travel / elapsed
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
}
