import {
	EventsSDK,
	GameState,
	LocalPlayer,
	ProjectileManager,
	TrackingProjectile,
	Unit
} from "github.com/octarine-public/wrapper/index"

const SWING_GRACE = 0.5
const MELEE_RANGE_BUFFER = 100

export class AttackTracker {
	private readonly swings = new Map<Unit, number>()

	constructor() {
		EventsSDK.on("AttackStarted", this.AttackStarted.bind(this))
		EventsSDK.on("AttackEnded", unit => this.swings.delete(unit))
	}

	public Reset(): void {
		this.swings.clear()
	}

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
		if (proj.IsAttack) {
			return true
		}
		return source instanceof Unit && source.IsEnemy(hero)
	}

	private TimeToImpact(proj: TrackingProjectile, hero: Unit): number {
		if (!proj.Position.IsValid || !proj.TargetLoc.IsValid) {
			return 0
		}
		let closing = Math.max(proj.Speed, 1)
		if (hero.IsMoving) {
			closing += hero.MoveSpeed
		}
		return proj.Position.Distance(proj.TargetLoc) / closing
	}
}
