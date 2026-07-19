import {
	Color,
	DOTAGameState,
	DOTAGameUIState,
	EntityManager,
	EventsSDK,
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
	Unit,
	Vector2
} from "github.com/octarine-public/wrapper/index"

import { canDagonKill, canEbladeComboKill, getHeroPriority } from "./damage"
import { MenuManager } from "./menu"

interface KillTarget {
	unit: Hero
	needsEblade: boolean
}

const DAGON_CLASSES = [item_dagon, item_dagon_2, item_dagon_3, item_dagon_4, item_dagon_5] as const

new (class DagonKillStealer {
	private readonly menu = new MenuManager()
	private readonly particles = new ParticlesSDK()

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

		if (!this.menu.State.value || !this.InGame) return

		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsAlive) return

		const dagon = this.findDagon(hero)
		if (dagon === undefined) return

		const eblade = this.menu.UseEblade.value
			? hero.GetItemByClass(item_ethereal_blade)
			: undefined

		if (this.ebladeInFlight && GameState.RawGameTime >= this.ebladeArrivalTime) {
			this.ebladeInFlight = false
		}

		const enemies = this.getValidEnemies(hero, dagon.CastRange)
		if (enemies.length === 0) return

		const killable = this.findKillableTargets(hero, dagon, eblade, enemies)
		if (killable.length === 0) return

		const target = this.selectPriority(killable, hero)
		this.currentTarget = target.unit

		if (target.needsEblade && eblade !== undefined && eblade.CanBeCasted()) {
			if (!target.unit.IsEthereal && !this.ebladeInFlight) {
				if (!hero.IsInRange(target.unit, eblade.CastRange)) return
				hero.CastTarget(eblade, target.unit, false, true)
				const dist = hero.Distance2D(target.unit)
				const speed = eblade.GetBaseSpeedForLevel(eblade.Level)
				this.ebladeArrivalTime = GameState.RawGameTime + dist / speed + 0.05
				this.ebladeInFlight = true
				return
			}
		}

		if (!dagon.CanBeCasted()) return
		if (!hero.IsInRange(target.unit, dagon.CastRange)) return
		if (!canDagonKill(hero, dagon, target.unit)) return

		hero.CastTarget(dagon, target.unit, false, true)
		this.lastKillTime = GameState.RawGameTime
		this.lastKillName = target.unit.Name.replace("npc_dota_hero_", "").replace(/_/g, " ")
	}

	private Draw(): void {
		if (!this.menu.State.value || !this.InGame) return

		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsAlive) {
			this.particles.DestroyByKey("dagon_range")
			this.particles.DestroyByKey("dagon_target")
			return
		}

		const dagon = this.findDagon(hero)

		if (this.menu.DrawRange.value && dagon !== undefined) {
			const ready = dagon.CanBeCasted()
			this.particles.DrawCircle("dagon_range", hero, dagon.CastRange, {
				Color: ready ? Color.Green : Color.Red
			})
		} else {
			this.particles.DestroyByKey("dagon_range")
		}

		if (
			this.menu.DrawTarget.value &&
			this.currentTarget !== undefined &&
			this.currentTarget.IsAlive
		) {
			this.particles.DrawCircle("dagon_target", this.currentTarget, 55, {
				Color: new Color(255, 40, 40)
			})
		} else {
			this.particles.DestroyByKey("dagon_target")
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
			const pos = new Vector2(10, 200)
			const lines: string[] = []
			lines.push(`dagon: ${dagon !== undefined ? `lvl${dagon.Level} cd:${Math.round(dagon.Cooldown * 10) / 10}` : "none"}`)
			lines.push(`target: ${this.currentTarget?.Name.replace("npc_dota_hero_", "") ?? "none"}`)
			lines.push(`eblade flight: ${this.ebladeInFlight}`)
			RendererSDK.Text(lines.join("\n"), pos, Color.White)
		}
	}

	private GameEnded(): void {
		this.currentTarget = undefined
		this.ebladeInFlight = false
		this.lastKillTime = 0
		this.particles.DestroyAll()
	}

	private findDagon(hero: Unit): Item | undefined {
		for (const cls of DAGON_CLASSES) {
			const d = hero.GetItemByClass(cls)
			if (d !== undefined) return d
		}
		return undefined
	}

	private getValidEnemies(hero: Unit, range: number): Hero[] {
		const result: Hero[] = []
		const heroes = EntityManager.GetEntitiesByClass(Hero)
		for (const enemy of heroes) {
			if (!enemy.IsEnemy(hero)) continue
			if (!enemy.IsAlive || !enemy.IsVisible || enemy.IsIllusion) continue
			if (!hero.IsInRange(enemy, range)) continue
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
