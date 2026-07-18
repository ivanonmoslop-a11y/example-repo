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
		return Math.min(this.NextProjectileImpact(hero), this.NextSwingImpact(hero))
	}

	private NextProjectileImpact(hero: Unit): number {
		let next = Number.POSITIVE_INFINITY
		const now = GameState.RawGameTime
		for (const proj of ProjectileManager.AllTrackingProjectiles) {
			if (this.Threatens(proj, hero)) {
				next = Math.min(next, now + this.TimeToImpact(proj))
			}
		}
		return next
	}

	private NextSwingImpact(hero: Unit): number {
		let next = Number.POSITIVE_INFINITY
		const now = GameState.RawGameTime
		for (const [unit, impact] of this.swings) {
			if (!unit.IsValid || !unit.IsAttacking || unit.Target !== hero || now > impact + SWING_GRACE) {
				this.swings.delete(unit)
				continue
			}
			next = Math.min(next, impact)
		}
		return next
	}

	private AttackStarted(unit: Unit, castPoint: number): void {
		const hero = LocalPlayer?.Hero
		if (hero === undefined || unit.Target !== hero) {
			return
		}
		if (unit.IsRoshan || !unit.IsMelee) {
			return
		}
		this.swings.set(unit, GameState.RawGameTime + castPoint)
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

	private TimeToImpact(proj: TrackingProjectile): number {
		// Position not resolved yet — treat as imminent until the manager fills it in.
		if (!proj.Position.IsValid || !proj.TargetLoc.IsValid) {
			return 0
		}
		return proj.Position.Distance(proj.TargetLoc) / Math.max(proj.Speed, 1)
	}
}
