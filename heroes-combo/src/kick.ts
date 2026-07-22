import {
	DOTAGameState,
	DOTAGameUIState,
	earth_spirit_boulder_smash,
	EntityManager,
	EventsSDK,
	GameRules,
	GameState,
	Hero,
	InputManager,
	Item,
	LifeState,
	LocalPlayer,
	npc_dota_hero_earth_spirit,
	Tower,
	Unit,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { EarthSpiritMenu } from "./menu"

const ENEMY_SEARCH_RADIUS = 900
const ALLY_SEARCH_RADIUS = 1500
const TOWER_SEARCH_RADIUS = 1500
const KICK_RADIUS = 180
const APPROACH_DISTANCE = 120
const HUG_DISTANCE = 90
const CROWD_RADIUS = 250
const BLINK_MIN_DISTANCE = 350
const ORDER_COOLDOWN = 0.1

export class KickCombo {
	private lastOrderTime = 0

	constructor(private readonly menu: EarthSpiritMenu) {
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("GameEnded", this.GameEnded.bind(this))
	}

	private get Hero(): Nullable<npc_dota_hero_earth_spirit> {
		const hero = LocalPlayer?.Hero
		if (!(hero instanceof npc_dota_hero_earth_spirit)) {
			return undefined
		}
		if (!hero.IsValid || !hero.IsAlive) {
			return undefined
		}
		return hero
	}

	private get InGame(): boolean {
		if (GameState.UIState !== DOTAGameUIState.DOTA_GAME_UI_DOTA_INGAME) {
			return false
		}
		return GameRules?.GameState === DOTAGameState.DOTA_GAMERULES_STATE_GAME_IN_PROGRESS
	}

	private PostDataUpdate(): void {
		if (!this.menu.State.value || !this.InGame) {
			return
		}
		const toAlly = this.menu.KickToAlly.isPressed
		if (!toAlly && !this.menu.KickToTower.isPressed) {
			return
		}
		const hero = this.Hero
		if (hero === undefined || hero.IsStunned) {
			return
		}
		this.Execute(hero, toAlly)
	}

	private Execute(hero: npc_dota_hero_earth_spirit, toAlly: boolean): void {
		const smash = hero.GetAbilityByClass(earth_spirit_boulder_smash)
		if (smash === undefined || smash.Level === 0) {
			return
		}
		const enemy = this.FindEnemy(hero)
		if (enemy === undefined) {
			return
		}
		const destination = toAlly ? this.FindAlly(hero, enemy)?.Position : this.FindTower(enemy)?.Position
		if (destination === undefined) {
			return
		}
		if (hero.Distance2D(enemy) <= KICK_RADIUS && !this.HasCloserUnit(hero, enemy)) {
			if (smash.CanBeCasted()) {
				hero.CastPosition(smash, this.ClampToRange(hero, destination, smash.CastRange))
			}
			return
		}
		const now = GameState.RawGameTime
		if (now - this.lastOrderTime < ORDER_COOLDOWN) {
			return
		}
		this.lastOrderTime = now
		const crowder = this.FindCrowder(hero, enemy)
		const approach =
			crowder !== undefined
				? enemy.Position.Extend(crowder.Position, -HUG_DISTANCE)
				: enemy.Position.Extend(hero.Position, APPROACH_DISTANCE)
		const blink = this.GetBlink(hero)
		if (blink !== undefined && hero.Distance2D(approach) > BLINK_MIN_DISTANCE) {
			hero.CastPosition(blink, this.ClampToRange(hero, approach, blink.CastRange))
			return
		}
		hero.MoveTo(approach)
	}

	private FindEnemy(hero: npc_dota_hero_earth_spirit): Nullable<Hero> {
		const cursor = InputManager.CursorOnWorld
		let target: Nullable<Hero>
		let closest = Number.MAX_VALUE
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!this.IsSpawnedHero(enemy) || !enemy.IsVisible || !enemy.IsEnemy()) {
				continue
			}
			if (enemy.IsIllusion || hero.Distance2D(enemy) > ENEMY_SEARCH_RADIUS) {
				continue
			}
			const distance = enemy.Distance2D(cursor)
			if (distance >= closest) {
				continue
			}
			closest = distance
			target = enemy
		}
		return target
	}

	private FindAlly(hero: npc_dota_hero_earth_spirit, enemy: Hero): Nullable<Hero> {
		let target: Nullable<Hero>
		let closest = ALLY_SEARCH_RADIUS
		for (const ally of EntityManager.GetEntitiesByClass(Hero)) {
			if (ally === hero || !this.IsSpawnedHero(ally) || ally.IsEnemy()) {
				continue
			}
			if (ally.IsIllusion) {
				continue
			}
			const distance = ally.Distance2D(enemy)
			if (distance >= closest) {
				continue
			}
			closest = distance
			target = ally
		}
		return target
	}

	private FindTower(enemy: Hero): Nullable<Tower> {
		let target: Nullable<Tower>
		let closest = TOWER_SEARCH_RADIUS
		for (const tower of EntityManager.GetEntitiesByClass(Tower)) {
			if (!tower.IsValid || !tower.IsAlive || tower.IsEnemy()) {
				continue
			}
			const distance = tower.Distance2D(enemy)
			if (distance >= closest) {
				continue
			}
			closest = distance
			target = tower
		}
		return target
	}

	private HasCloserUnit(hero: npc_dota_hero_earth_spirit, enemy: Hero): boolean {
		const distance = hero.Distance2D(enemy)
		return EntityManager.GetEntitiesByClass(Unit).some(
			unit => this.IsKickable(unit, hero, enemy) && hero.Distance2D(unit) < distance
		)
	}

	private FindCrowder(hero: npc_dota_hero_earth_spirit, enemy: Hero): Nullable<Unit> {
		let target: Nullable<Unit>
		let closest = CROWD_RADIUS
		for (const unit of EntityManager.GetEntitiesByClass(Unit)) {
			if (!this.IsKickable(unit, hero, enemy)) {
				continue
			}
			const distance = unit.Distance2D(enemy)
			if (distance >= closest) {
				continue
			}
			closest = distance
			target = unit
		}
		return target
	}

	private IsKickable(unit: Unit, hero: npc_dota_hero_earth_spirit, enemy: Hero): boolean {
		if (unit === hero || unit === enemy || unit.IsBuilding) {
			return false
		}
		return unit.IsValid && unit.IsAlive
	}

	private IsSpawnedHero(hero: Hero): boolean {
		return hero.IsValid && hero.LifeState === LifeState.LIFE_ALIVE
	}

	private GetBlink(hero: npc_dota_hero_earth_spirit): Nullable<Item> {
		return hero.Items.find(item => item.Name.endsWith("blink") && item.CanBeCasted())
	}

	private ClampToRange(hero: npc_dota_hero_earth_spirit, position: Vector3, range: number): Vector3 {
		if (range <= 0 || hero.Distance2D(position) <= range) {
			return position.Clone()
		}
		return hero.Position.Extend(position, range)
	}

	private GameEnded(): void {
		this.menu.KickToAlly.isPressed = false
		this.menu.KickToTower.isPressed = false
		this.lastOrderTime = 0
	}
}
