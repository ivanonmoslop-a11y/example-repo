import {
	EventsSDK,
	GameState,
	LocalPlayer,
	ProjectileManager,
	TrackingProjectile,
	Unit
} from "github.com/octarine-public/wrapper/index"

/** An entry outliving its impact this long is stale (missed AttackEnded), drop it. */
const SWING_GRACE = 0.5

/**
 * Reach buffer (Moones' attackRange+100 rule) for melee swings whose target the SDK
 * could not resolve — while the hero moves, the angle-based resolution often fails.
 */
const MELEE_RANGE_BUFFER = 100

/**
 * Tracks both ways an attack can land on the hero: attack/spell projectiles already
 * flying at them (ranged creeps, summons, towers, heroes) via ProjectileManager, and
 * melee swings aimed at them via the SDK attack monitor (AttackStarted resolves the
 * attacker's target, castPoint is time-to-impact; AttackEnded clears it).
 * Ranged swings are ignored on purpose: no damage can land during the windup, and the
 * launched projectile is picked up above — counting both would double the blocked time.
 * Roshan is exempt from all of it (user demand): the abuse must fire right after his
 * hit, exactly as it did before this tracker existed.
 */
export class AttackTracker {
	private readonly swings = new Map<Unit, number>()

	constructor() {
		EventsSDK.on("AttackStarted", this.AttackStarted.bind(this))
		EventsSDK.on("AttackEnded", unit => this.swings.delete(unit))
	}

	public Reset(): void {
		this.swings.clear()
	}

	/** Absolute RawGameTime of the soonest incoming impact; Infinity when nothing threatens. */
	public NextImpactTime(hero: Unit): number {
		return Math.min(this.NextProjectileImpact(hero), this.NextSwingImpact())
	}

	private NextProjectileImpact(hero: Unit): number {
		let next = Number.POSITIVE_INFINITY
		const now = GameState.RawGameTime
		for (const proj of ProjectileManager.AllTrackingProjectiles) {
			if (this.Threatens(proj, hero)) {
				next = Math.min(next, now + this.TimeToImpact(proj, hero))
			}
		}
		return next
	}

	private NextSwingImpact(): number {
		let next = Number.POSITIVE_INFINITY
		const now = GameState.RawGameTime
		for (const [unit, impact] of this.swings) {
			if (!unit.IsValid || !unit.IsAttacking || now > impact + SWING_GRACE) {
				this.swings.delete(unit)
				continue
			}
			// A passed impact means the hit has already landed — right after it is
			// exactly when the burst should fire, so it must never keep blocking.
			if (impact >= now) {
				next = Math.min(next, impact)
			}
		}
		return next
	}

	private AttackStarted(unit: Unit, castPoint: number): void {
		const hero = LocalPlayer?.Hero
		if (hero === undefined || unit.IsRoshan || !unit.IsMelee) {
			return
		}
		const target = unit.Target
		// Resolved target is authoritative. Unresolved + able to reach us counts too:
		// bursting into a swing the SDK merely failed to attribute is still death.
		const threatens =
			target !== undefined
				? target === hero
				: unit.IsEnemy(hero) && hero.Distance2D(unit) <= unit.GetAttackRange(hero) + MELEE_RANGE_BUFFER
		if (threatens) {
			this.swings.set(unit, GameState.RawGameTime + castPoint)
		}
	}

	private Threatens(proj: TrackingProjectile, hero: Unit): boolean {
		if (!proj.IsValid || proj.IsDodged || proj.Target !== hero) {
			return false
		}
		const source = proj.Source
		if (source instanceof Unit && source.IsRoshan) {
			return false
		}
		// Attacks from anyone (enemy or an ally denying us); spell projectiles only
		// from enemies — allied ones aimed at us (e.g. Death Pulse) are heals.
		if (proj.IsAttack) {
			return true
		}
		return source instanceof Unit && source.IsEnemy(hero)
	}

	private TimeToImpact(proj: TrackingProjectile, hero: Unit): number {
		// Position not resolved yet — treat as imminent until the manager fills it in.
		if (!proj.Position.IsValid || !proj.TargetLoc.IsValid) {
			return 0
		}
		// Running toward the shooter closes the gap faster than the projectile flies —
		// assume the worst case so the estimate never lands later than the real hit.
		let closing = Math.max(proj.Speed, 1)
		if (hero.IsMoving) {
			closing += hero.MoveSpeed
		}
		return proj.Position.Distance(proj.TargetLoc) / closing
	}
}
