import {
	Color,
	DOTAGameState,
	DOTAGameUIState,
	EntityManager,
	EventsSDK,
	ExecuteOrder,
	GameRules,
	GameState,
	Hero,
	Item,
	item_dagon,
	item_dagon_2,
	item_dagon_3,
	item_dagon_4,
	item_dagon_5,
	item_ethereal_blade,
	LocalPlayer,
	ParticlesSDK,
	RendererSDK,
	TickSleeper,
	Unit,
	Vector2
} from "github.com/octarine-public/wrapper/index"

import { canDagonKill, canEbladeComboKill, getHeroPriority, inCastRange } from "./damage"
import { MenuManager } from "./menu"

interface KillTarget {
	unit: Hero
	needsEblade: boolean
}

const DAGON_CLASSES = [item_dagon, item_dagon_2, item_dagon_3, item_dagon_4, item_dagon_5] as const

// Throttle between actions (ms). Casting every tick locks player movement —
// after each order we sleep so the player keeps full control of the hero.
const CAST_THROTTLE = 150

new (class DagonKillStealer {
	private readonly menu = new MenuManager()
	private readonly particles = new ParticlesSDK()
	private readonly sleeper = new TickSleeper()

	private currentTarget: Unit | undefined = undefined
	private lastKillTime = 0
	private lastKillName = ""
	private ebladeInFlight = false
	private ebladeArrivalTime = 0

	constructor() {
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("Draw", this.Draw.bind(this))
		EventsSDK.on("GameEnded", this.GameEnded.bind(this))
	}

	private get InGame(): boolean {
		if (GameState.UIState !== DOTAGameUIState.DOTA_GAME_UI_DOTA_INGAME) {
			return false
		}
		return GameRules?.GameState === DOTAGameState.DOTA_GAMERULES_STATE_GAME_IN_PROGRESS
	}

	private PostDataUpdate(): void {
		this.currentTarget = undefined

		// Respect humanizer — when disabled the script must not act.
		if (ExecuteOrder.DisableHumanizer) return
		if (!this.menu.State.value || !this.InGame) return

		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsAlive) return

		if (this.ebladeInFlight && GameState.RawGameTime >= this.ebladeArrivalTime) {
			this.ebladeInFlight = false
		}

		const dagon = this.findDagon(hero)
		if (dagon === undefined) return

		const eblade = this.menu.UseEblade.value
			? hero.GetItemByClass(item_ethereal_blade)
			: undefined

		// Only scan targets that are genuinely inside Dagon's cast range.
		// If nothing is in range the script does nothing — the hero is never
		// ordered to walk toward an out-of-range enemy.
		const enemies = this.getEnemiesInRange(hero, dagon.CastRange)
		this.updateIndicators(hero, dagon, enemies)

		if (enemies.length === 0) return

		// Throttle: after a cast we sleep so orders aren't re-issued every tick.
		if (this.sleeper.Sleeping) return

		const killable = this.findKillableTargets(hero, dagon, eblade, enemies)
		if (killable.length === 0) return

		const target = this.selectPriority(killable, hero)
		this.currentTarget = target.unit

		if (target.needsEblade && eblade !== undefined && eblade.CanBeCasted()) {
			if (!target.unit.IsEthereal && !this.ebladeInFlight) {
				// Hard range gate right before the order — never cast out of range.
				if (!inCastRange(hero, target.unit, eblade.CastRange)) return
				hero.CastTarget(eblade, target.unit, false, true)
				const dist = hero.Distance2D(target.unit)
				const speed = eblade.GetBaseSpeedForLevel(eblade.Level)
				this.ebladeArrivalTime = GameState.RawGameTime + dist / speed + 0.05
				this.ebladeInFlight = true
				this.sleeper.Sleep(CAST_THROTTLE)
				return
			}
		}

		if (!dagon.CanBeCasted()) return
		// Hard range gate right before the order — never cast out of range.
		if (!inCastRange(hero, target.unit, dagon.CastRange)) return

		hero.CastTarget(dagon, target.unit, false, true)
		this.sleeper.Sleep(CAST_THROTTLE)
		this.lastKillTime = GameState.RawGameTime
		this.lastKillName = target.unit.Name.replace("npc_dota_hero_", "").replace(/_/g, " ")
	}

	private Draw(): void {
		if (ExecuteOrder.DisableHumanizer || !this.menu.State.value || !this.InGame) {
			this.particles.DestroyByKey("dagon_range")
			this.particles.DestroyByKey("dagon_target")
			return
		}

		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsAlive) {
			this.particles.DestroyByKey("dagon_range")
			this.particles.DestroyByKey("dagon_target")
			return
		}

		if (this.menu.Notification.value && GameState.RawGameTime - this.lastKillTime < 3) {
			const pos = new Vector2(RendererSDK.WindowSize.x / 2, 100)
			RendererSDK.Text(
				`[KS] Dagon → ${this.lastKillName}`,
				pos,
				new Color(255, 220, 50),
				undefined,
				2
			)
		}

		if (this.menu.ShowDebug.value) {
			const dagon = this.findDagon(hero)
			const pos = new Vector2(10, 200)
			const lines: string[] = []
			lines.push(
				`dagon: ${dagon !== undefined ? `lvl${dagon.Level} range:${Math.round(dagon.CastRange)} cd:${Math.round(dagon.Cooldown * 10) / 10}` : "none"}`
			)
			lines.push(`target: ${this.currentTarget?.Name.replace("npc_dota_hero_", "") ?? "none"}`)
			lines.push(`sleeping: ${this.sleeper.Sleeping} | eblade flight: ${this.ebladeInFlight}`)
			RendererSDK.Text(lines.join("\n"), pos, Color.White)
		}
	}

	// Range circle + target highlight are driven from PostDataUpdate so the
	// particles reflect the exact in-range set used by the cast logic.
	private updateIndicators(hero: Unit, dagon: Item, enemies: Hero[]): void {
		if (this.menu.DrawRange.value) {
			const ready = dagon.CanBeCasted()
			this.particles.DrawCircle("dagon_range", hero, dagon.CastRange, {
				Color: ready ? Color.Green : Color.Red
			})
		} else {
			this.particles.DestroyByKey("dagon_range")
		}

		if (this.menu.DrawTarget.value) {
			const preview = enemies.find(
				e => dagon.CanBeCasted() && canDagonKill(hero, dagon, e)
			)
			if (preview !== undefined) {
				this.particles.DrawCircle("dagon_target", preview, 55, {
					Color: new Color(255, 40, 40)
				})
				return
			}
		}
		this.particles.DestroyByKey("dagon_target")
	}

	private GameEnded(): void {
		this.currentTarget = undefined
		this.ebladeInFlight = false
		this.lastKillTime = 0
		this.sleeper.ResetTimer()
		this.particles.DestroyAll()
	}

	private findDagon(hero: Unit): Item | undefined {
		for (const cls of DAGON_CLASSES) {
			const d = hero.GetItemByClass(cls)
			if (d !== undefined) return d
		}
		return undefined
	}

	private getEnemiesInRange(hero: Unit, range: number): Hero[] {
		const result: Hero[] = []
		const heroes = EntityManager.GetEntitiesByClass(Hero)
		for (const enemy of heroes) {
			if (!enemy.IsEnemy(hero)) continue
			if (!enemy.IsAlive || !enemy.IsVisible || enemy.IsIllusion) continue
			if (!inCastRange(hero, enemy, range)) continue
			result.push(enemy)
		}
		return result
	}

	private findKillableTargets(
		hero: Unit,
		dagon: Item,
		eblade: item_ethereal_blade | undefined,
		enemies: Hero[]
	): KillTarget[] {
		const result: KillTarget[] = []
		for (const enemy of enemies) {
			if (dagon.CanBeCasted() && canDagonKill(hero, dagon, enemy)) {
				result.push({ unit: enemy, needsEblade: false })
			} else if (
				eblade !== undefined &&
				eblade.CanBeCasted() &&
				dagon.CanBeCasted() &&
				inCastRange(hero, enemy, eblade.CastRange) &&
				canEbladeComboKill(hero, dagon, eblade, enemy)
			) {
				result.push({ unit: enemy, needsEblade: true })
			}
		}
		return result
	}

	private selectPriority(targets: KillTarget[], hero: Unit): KillTarget {
		if (targets.length === 1) return targets[0]

		switch (this.menu.Priority.SelectedID) {
			case 0:
				return targets.sort((a, b) => {
					const pa = getHeroPriority(a.unit)
					const pb = getHeroPriority(b.unit)
					if (pa !== pb) return pa - pb
					return a.unit.HP - b.unit.HP
				})[0]
			case 1:
				return targets.sort((a, b) => a.unit.HP - b.unit.HP)[0]
			case 2:
				return targets.sort(
					(a, b) => hero.Distance2D(a.unit) - hero.Distance2D(b.unit)
				)[0]
			default:
				return targets[0]
		}
	}
})()
