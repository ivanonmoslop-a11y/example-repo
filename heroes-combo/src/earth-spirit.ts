import {
	Ability,
	DOTAGameState,
	DOTAGameUIState,
	dotaunitorder_t,
	earth_spirit_boulder_smash,
	earth_spirit_geomagnetic_grip,
	earth_spirit_rolling_boulder,
	earth_spirit_stone_caller,
	EarthSpiritStone,
	Entity,
	EntityManager,
	EventsSDK,
	ExecuteOrder,
	GameRules,
	GameState,
	Hero,
	LocalPlayer,
	npc_dota_hero_earth_spirit,
	Unit,
	Vector2,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { EarthSpiritMenu } from "./menu"

const MAGNETIZE_MODIFIER = "modifier_earth_spirit_magnetize"
const SMASH_RADIUS = 200
const GRIP_RADIUS = 300
const ALLY_GRIP_RADIUS = 150
const ROLL_RADIUS = 200
const ROLL_PLACE_DISTANCE = 250
const ROLL_HIT_RADIUS = 100
const MAGNETIZE_EXTEND_TIME = 1
const MAGNETIZE_RELOCK = 1
const PLACE_COOLDOWN = 0.25
const RESEND_DELAY = 0.3
const STONE_SPAWN_RADIUS = 150

interface IPendingOrder {
	orderType: dotaunitorder_t
	ability: Ability
	target: Nullable<Entity | number>
	position: Vector3
	stonePosition: Vector3
	time: number
}

export class EarthSpiritCombo {
	private pending: Nullable<IPendingOrder>
	private lastPlaceTime = 0
	private readonly magnetizeLocks = new Map<number, number>()

	constructor(private readonly menu: EarthSpiritMenu) {
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("PrepareUnitOrders", this.PrepareUnitOrders.bind(this))
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

	private get Enabled(): boolean {
		return this.menu.State.value && this.menu.AutoRemnant.value && !this.menu.ComboKey.isPressed && this.InGame
	}

	private PostDataUpdate(): void {
		const hero = this.Hero
		if (!this.Enabled || hero === undefined) {
			this.pending = undefined
			return
		}
		this.ResendPending(hero)
		this.ExtendMagnetize(hero)
	}

	private PrepareUnitOrders(order: ExecuteOrder): boolean {
		const hero = this.Hero
		if (!this.Enabled || hero === undefined || !order.IsPlayerInput) {
			return true
		}
		if (order.Issuers.length !== 0 && !order.Issuers.includes(hero)) {
			return true
		}
		if (
			order.OrderType !== dotaunitorder_t.DOTA_UNIT_ORDER_CAST_POSITION &&
			order.OrderType !== dotaunitorder_t.DOTA_UNIT_ORDER_CAST_TARGET
		) {
			return true
		}
		const ability = order.Ability_
		if (!(ability instanceof Ability) || ability.Owner !== hero) {
			return true
		}
		const stoneCaller = this.GetStoneCaller(hero)
		if (stoneCaller === undefined || !this.CanPlaceStone(stoneCaller)) {
			return true
		}
		if (ability instanceof earth_spirit_boulder_smash) {
			if (!this.menu.BoulderSmash.value) {
				return true
			}
			if (order.OrderType === dotaunitorder_t.DOTA_UNIT_ORDER_CAST_TARGET) {
				return true
			}
			if (this.HasStoneNear(hero.Position, SMASH_RADIUS)) {
				return true
			}
			return this.PlaceAndPend(hero, stoneCaller, hero.Position, order)
		}
		if (ability instanceof earth_spirit_rolling_boulder) {
			if (!this.menu.RollingBoulder.value) {
				return true
			}
			const direction = this.GetOrderPosition(order)
			if (direction === undefined || hero.Distance2D(direction) < 1) {
				return true
			}
			const rollPosition = hero.Position.Extend(direction, ROLL_PLACE_DISTANCE)
			if (this.HasStoneNear(rollPosition, ROLL_RADIUS)) {
				return true
			}
			if (this.HasEnemyBeforeStone(hero, rollPosition, ability)) {
				return true
			}
			return this.PlaceAndPend(hero, stoneCaller, rollPosition, order)
		}
		if (ability instanceof earth_spirit_geomagnetic_grip) {
			if (!this.menu.GeomagneticGrip.value) {
				return true
			}
			const target = this.GetOrderPosition(order)
			if (target === undefined) {
				return true
			}
			if (this.HasAllyNear(hero, target)) {
				return true
			}
			const gripRadius = Math.max(ability.GetBaseAOERadiusForLevel(ability.Level), GRIP_RADIUS)
			if (this.HasStoneNear(target, gripRadius)) {
				return true
			}
			return this.PlaceAndPend(hero, stoneCaller, target, order)
		}
		return true
	}

	private PlaceAndPend(
		hero: npc_dota_hero_earth_spirit,
		stoneCaller: earth_spirit_stone_caller,
		position: Vector3,
		order: ExecuteOrder
	): boolean {
		const stonePosition = this.ClampToRange(hero, stoneCaller, position)
		hero.CastPosition(stoneCaller, stonePosition)
		this.lastPlaceTime = GameState.RawGameTime
		this.pending = {
			orderType: order.OrderType,
			ability: order.Ability_ as Ability,
			target: order.Target,
			position: order.Position.Clone(),
			stonePosition,
			time: GameState.RawGameTime
		}
		return false
	}

	private ResendPending(hero: npc_dota_hero_earth_spirit): void {
		const pending = this.pending
		if (pending === undefined) {
			return
		}
		const elapsed = GameState.RawGameTime - pending.time
		const placed = this.HasStoneNear(pending.stonePosition, STONE_SPAWN_RADIUS)
		if (!placed && elapsed < RESEND_DELAY) {
			return
		}
		this.pending = undefined
		const ability = pending.ability
		if (!ability.IsValid || !ability.CanBeCasted()) {
			return
		}
		if (pending.orderType === dotaunitorder_t.DOTA_UNIT_ORDER_CAST_POSITION) {
			hero.CastPosition(ability, pending.position)
			return
		}
		if (pending.target !== undefined) {
			hero.CastTarget(ability, pending.target)
		}
	}

	private ExtendMagnetize(hero: npc_dota_hero_earth_spirit): void {
		if (!this.menu.ExtendMagnetize.value) {
			return
		}
		if (GameState.RawGameTime - this.lastPlaceTime < PLACE_COOLDOWN) {
			return
		}
		if (hero.IsStunned) {
			return
		}
		const stoneCaller = this.GetStoneCaller(hero)
		if (stoneCaller === undefined || !this.CanPlaceStone(stoneCaller)) {
			return
		}
		const now = GameState.RawGameTime
		let target: Nullable<Hero>
		let lowest = MAGNETIZE_EXTEND_TIME
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!enemy.IsValid || !enemy.IsAlive || !enemy.IsVisible || !enemy.IsEnemy()) {
				continue
			}
			const buff = enemy.GetBuffByName(MAGNETIZE_MODIFIER)
			if (buff === undefined || buff.RemainingTime > lowest) {
				continue
			}
			if (now - (this.magnetizeLocks.get(enemy.Index) ?? -MAGNETIZE_RELOCK) < MAGNETIZE_RELOCK) {
				continue
			}
			if (hero.Distance2D(enemy) > stoneCaller.CastRange) {
				continue
			}
			lowest = buff.RemainingTime
			target = enemy
		}
		if (target === undefined) {
			return
		}
		hero.CastPosition(stoneCaller, target.Position)
		this.magnetizeLocks.set(target.Index, now)
		this.lastPlaceTime = now
	}

	private GetStoneCaller(hero: npc_dota_hero_earth_spirit): Nullable<earth_spirit_stone_caller> {
		return hero.GetAbilityByClass(earth_spirit_stone_caller)
	}

	private CanPlaceStone(stoneCaller: earth_spirit_stone_caller): boolean {
		return stoneCaller.CanBeUsable && stoneCaller.CurrentCharges > 0
	}

	private HasEnemyBeforeStone(
		hero: npc_dota_hero_earth_spirit,
		stonePosition: Vector3,
		ability: earth_spirit_rolling_boulder
	): boolean {
		const start = new Vector2(hero.Position.x, hero.Position.y)
		const end = new Vector2(stonePosition.x, stonePosition.y)
		const length = start.Distance(end)
		const radius = ability.GetBaseAOERadiusForLevel(ability.Level) || ROLL_HIT_RADIUS
		return EntityManager.GetEntitiesByClass(Hero).some(enemy => {
			if (!enemy.IsValid || !enemy.IsAlive || !enemy.IsVisible || !enemy.IsEnemy()) {
				return false
			}
			const position = new Vector2(enemy.Position.x, enemy.Position.y)
			if (position.Distance(start) >= length) {
				return false
			}
			return position.DistanceSegment(start, end, true) <= radius + enemy.HullRadius
		})
	}

	private HasAllyNear(hero: npc_dota_hero_earth_spirit, position: Vector3): boolean {
		return EntityManager.GetEntitiesByClass(Unit).some(
			unit =>
				unit !== hero &&
				unit.IsValid &&
				unit.IsAlive &&
				!unit.IsBuilding &&
				!unit.IsEnemy() &&
				unit.Distance2D(position) <= ALLY_GRIP_RADIUS
		)
	}

	private HasStoneNear(position: Vector3, radius: number): boolean {
		return EntityManager.GetEntitiesByClass(EarthSpiritStone).some(
			stone => stone.IsValid && stone.IsAlive && !stone.IsEnemy() && stone.Distance2D(position) <= radius
		)
	}

	private ClampToRange(
		hero: npc_dota_hero_earth_spirit,
		stoneCaller: earth_spirit_stone_caller,
		position: Vector3
	): Vector3 {
		const range = stoneCaller.CastRange
		if (range <= 0 || hero.Distance2D(position) <= range) {
			return position.Clone()
		}
		return hero.Position.Extend(position, range)
	}

	private GetOrderPosition(order: ExecuteOrder): Nullable<Vector3> {
		if (order.OrderType === dotaunitorder_t.DOTA_UNIT_ORDER_CAST_POSITION) {
			return order.Position
		}
		const target = order.Target
		if (target instanceof Entity) {
			return target.Position
		}
		if (typeof target === "number") {
			return EntityManager.EntityByIndex(target)?.Position
		}
		return undefined
	}

	private GameEnded(): void {
		this.pending = undefined
		this.lastPlaceTime = 0
		this.magnetizeLocks.clear()
	}
}
