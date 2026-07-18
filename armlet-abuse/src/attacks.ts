import { GameState, ProjectileManager, TrackingProjectile, Unit } from "github.com/octarine-public/wrapper/index"

/**
 * Watches attack projectiles already flying at the hero — creeps, summons, neutrals,
 * Roshan and heroes alike. No swing or cast prediction (that blocked the abuse in
 * fights): only projectiles the server has actually launched, so at worst the burst
 * is delayed by one projectile flight. Melee hits have no projectile and stay uncovered.
 */
export class AttackTracker {
	/** Absolute RawGameTime of the soonest incoming impact; Infinity when nothing flies. */
	public NextImpactTime(hero: Unit): number {
		let next = Number.POSITIVE_INFINITY
		const now = GameState.RawGameTime
		for (const proj of ProjectileManager.AllTrackingProjectiles) {
			if (this.Threatens(proj, hero)) {
				next = Math.min(next, now + this.TimeToImpact(proj))
			}
		}
		return next
	}

	private Threatens(proj: TrackingProjectile, hero: Unit): boolean {
		if (!proj.IsValid || proj.IsDodged || proj.Target !== hero) {
			return false
		}
		// Attacks from anyone (enemy or an ally denying us); spell projectiles only
		// from enemies — allied ones aimed at us (e.g. Death Pulse) are heals.
		if (proj.IsAttack) {
			return true
		}
		const source = proj.Source
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
