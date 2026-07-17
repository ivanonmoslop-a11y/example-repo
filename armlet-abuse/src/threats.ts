import {
	EventsSDK,
	GameState,
	LocalPlayer,
	ProjectileManager,
	TrackingProjectile,
	Unit
} from "github.com/octarine-public/wrapper/index"

interface MeleeSwing {
	attacker: Unit
	impactTime: number
	damage: number
}

export class ThreatTracker {
	private readonly meleeSwings: MeleeSwing[] = []

	constructor() {
		EventsSDK.on("AttackStarted", this.OnAttackStarted.bind(this))
		EventsSDK.on("AttackEnded", this.OnAttackEnded.bind(this))
	}

	public Reset(): void {
		this.meleeSwings.length = 0
	}

	public EarliestThreatTime(hero: Unit): number {
		let earliest = Number.POSITIVE_INFINITY
		earliest = Math.min(earliest, this.EarliestProjectile(hero))
		earliest = Math.min(earliest, this.EarliestMelee())
		return earliest
	}

	public TotalIncomingDamage(hero: Unit, withinSeconds: number): number {
		const now = GameState.RawGameTime
		const deadline = now + withinSeconds
		let total = 0
		total += this.ProjectileDamage(hero, deadline)
		total += this.MeleeDamage(deadline)
		return total
	}

	private EarliestProjectile(hero: Unit): number {
		const now = GameState.RawGameTime
		let earliest = Number.POSITIVE_INFINITY
		for (const proj of ProjectileManager.AllTrackingProjectiles) {
			if (!proj.IsValid || proj.IsDodged) {
				continue
			}
			if (proj.Target !== hero) {
				continue
			}
			if (proj.Source instanceof Unit && proj.Source.Team === hero.Team) {
				continue
			}
			const dist = proj.Position.Distance(hero.Position)
			const eta = now + dist / proj.Speed
			earliest = Math.min(earliest, eta)
		}
		return earliest
	}

	private ProjectileDamage(hero: Unit, deadline: number): number {
		const now = GameState.RawGameTime
		let total = 0
		for (const proj of ProjectileManager.AllTrackingProjectiles) {
			if (!proj.IsValid || proj.IsDodged) {
				continue
			}
			if (proj.Target !== hero) {
				continue
			}
			const source = proj.Source
			if (!(source instanceof Unit) || source.Team === hero.Team) {
				continue
			}
			const dist = proj.Position.Distance(hero.Position)
			const eta = now + dist / proj.Speed
			if (eta > deadline) {
				continue
			}
			total += this.EstimateProjectileDamage(proj, source, hero)
		}
		return total
	}

	private EstimateProjectileDamage(proj: TrackingProjectile, source: Unit, hero: Unit): number {
		if (proj.IsAttack) {
			return source.GetAttackDamage(hero)
		}
		if (proj.Ability !== undefined && proj.Ability !== null) {
			return proj.Ability.GetDamage(hero)
		}
		return source.GetAttackDamage(hero)
	}

	private EarliestMelee(): number {
		this.PruneMelee()
		let earliest = Number.POSITIVE_INFINITY
		for (const swing of this.meleeSwings) {
			earliest = Math.min(earliest, swing.impactTime)
		}
		return earliest
	}

	private MeleeDamage(deadline: number): number {
		this.PruneMelee()
		let total = 0
		for (const swing of this.meleeSwings) {
			if (swing.impactTime <= deadline) {
				total += swing.damage
			}
		}
		return total
	}

	private PruneMelee(): void {
		const now = GameState.RawGameTime
		for (let i = this.meleeSwings.length - 1; i >= 0; i--) {
			const s = this.meleeSwings[i]
			if (s.impactTime < now || !s.attacker.IsValid || !s.attacker.IsAlive) {
				this.meleeSwings.splice(i, 1)
			}
		}
	}

	private OnAttackStarted(unit: Unit, castPoint: number): void {
		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsValid || !hero.IsAlive) {
			return
		}
		if (unit.Team === hero.Team) {
			return
		}
		if (unit.IsRanged) {
			return
		}
		const target = unit.Target
		if (target !== hero) {
			return
		}
		for (const s of this.meleeSwings) {
			if (s.attacker === unit) {
				s.impactTime = GameState.RawGameTime + castPoint
				s.damage = unit.GetAttackDamage(hero)
				return
			}
		}
		this.meleeSwings.push({
			attacker: unit,
			impactTime: GameState.RawGameTime + castPoint,
			damage: unit.GetAttackDamage(hero)
		})
	}

	private OnAttackEnded(unit: Unit, isCancelled: boolean): void {
		if (!isCancelled) {
			return
		}
		for (let i = this.meleeSwings.length - 1; i >= 0; i--) {
			if (this.meleeSwings[i].attacker === unit) {
				this.meleeSwings.splice(i, 1)
				break
			}
		}
	}
}
