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
	LocalPlayer,
	npc_dota_hero_earth_spirit,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { EarthSpiritMenu } from "./menu"

const ENEMY_SEARCH_RADIUS = 900
const ALLY_SEARCH_RADIUS = 1200
const KICK_RADIUS = 180
const KICK_OFFSET = 140
const ANGLE_TOLERANCE = 0.3
const BLINK_MIN_DISTANCE = 350
const ORDER_COOLDOWN = 0.1

export class KickToAlly {
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
		if (!this.menu.State.value || !this.menu.KickToAlly.isPressed || !this.InGame) {
			return
		}
		const hero = this.Hero
		if (hero === undefined || hero.IsStunned) {
			return
		}
		this.Execute(hero)
	}

	private Execute(hero: npc_dota_hero_earth_spirit): void {
		const smash = hero.GetAbilityByClass(earth_spirit_boulder_smash)
		if (smash === undefined || smash.Level === 0) {
			return
		}
		const enemy = this.FindEnemy(hero)
		if (enemy === undefined) {
			return
		}
		const ally = this.FindAlly(hero, enemy)
		if (ally === undefined) {
			return
		}
		if (this.InPosition(hero, enemy, ally)) {
			if (smash.CanBeCasted()) {
				hero.CastTarget(smash, enemy)
			}
			return
		}
		const now = GameState.RawGameTime
		if (now - this.lastOrderTime < ORDER_COOLDOWN) {
			return
		}
		this.lastOrderTime = now
		const kickPosition = enemy.Position.Extend(ally.Position, -KICK_OFFSET)
		const blink = this.GetBlink(hero)
		if (blink !== undefined && hero.Distance2D(kickPosition) > BLINK_MIN_DISTANCE) {
			hero.CastPosition(blink, this.ClampToRange(hero, kickPosition, blink.CastRange))
			return
		}
		hero.MoveTo(kickPosition)
	}

	private FindEnemy(hero: npc_dota_hero_earth_spirit): Nullable<Hero> {
		const cursor = InputManager.CursorOnWorld
		let target: Nullable<Hero>
		let closest = Number.MAX_VALUE
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!enemy.IsValid || !enemy.IsAlive || !enemy.IsVisible || !enemy.IsEnemy()) {
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
			if (ally === hero || !ally.IsValid || !ally.IsAlive || ally.IsEnemy()) {
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

	private InPosition(hero: npc_dota_hero_earth_spirit, enemy: Hero, ally: Hero): boolean {
		if (hero.Distance2D(enemy) > KICK_RADIUS) {
			return false
		}
		const heroPosition = hero.Position
		const enemyPosition = enemy.Position
		const allyPosition = ally.Position
		const kickAngle = Math.atan2(enemyPosition.y - heroPosition.y, enemyPosition.x - heroPosition.x)
		const allyAngle = Math.atan2(allyPosition.y - enemyPosition.y, allyPosition.x - enemyPosition.x)
		let difference = Math.abs(kickAngle - allyAngle)
		if (difference > Math.PI) {
			difference = 2 * Math.PI - difference
		}
		return difference <= ANGLE_TOLERANCE
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
		this.lastOrderTime = 0
	}
}
