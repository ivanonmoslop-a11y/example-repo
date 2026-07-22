import {
	Ability,
	Color,
	DOTA_ABILITY_BEHAVIOR,
	DOTA_UNIT_TARGET_TEAM,
	DOTAGameState,
	DOTAGameUIState,
	earth_spirit_boulder_smash,
	EntityManager,
	EventsSDK,
	Fountain,
	GameRules,
	GameState,
	Hero,
	InputManager,
	LifeState,
	LocalPlayer,
	npc_dota_hero_earth_spirit,
	ParticlesSDK,
	RendererSDK,
	Unit,
	Vector2,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { EarthSpiritMenu } from "./menu"

const PETRIFY_ABILITY = "earth_spirit_petrify"
const PETRIFY_MODIFIER = "modifier_earth_spirit_petrify"
const LINKEN_MODIFIER = "modifier_item_sphere_target"
const BKB_MODIFIER = "modifier_black_king_bar_immune"
const LINKEN_BREAKERS = [
	"item_urn_of_shadows",
	"item_spirit_vessel",
	"item_rod_of_atos",
	"item_orchid",
	"item_bloodthorn",
	"item_diffusal_blade",
	"item_disperser",
	"item_harpoon",
	"item_ethereal_blade",
	"item_heavens_halberd",
	"item_nullifier",
	"item_sheepstick"
]

const KICK_FLIGHT = 2000
const FOUNTAIN_RADIUS = 300
const LOCK_RADIUS = 1500
const PICKUP_RADIUS = 150
const APPROACH_DISTANCE = 110
const BLINK_MIN_RANGE = 300
const BLINK_MAX_RANGE = 1300
const ORDER_GAP = 0.1
const CAGE_RADIUS = 95
const CAGE_HEIGHT = 170
const CARD_WIDTH = 210
const CARD_HEIGHT = 30
const ARROW_KEY = "heroes_combo_fountain_arrow"
const LOCK_KEY = "heroes_combo_fountain_lock"
const READY_COLOR = new Color(120, 255, 60)
const WAIT_COLOR = new Color(190, 60, 255)
const DENIED_COLOR = new Color(255, 60, 60)
const CARD_BACKGROUND = new Color(10, 10, 16, 220)

const enum KickState {
	Ready,
	Approach,
	NoMana,
	Denied
}

export class FountainKick {
	private readonly particles = new ParticlesSDK()
	private lastOrderTime = 0
	private wasPressed = false

	constructor(private readonly menu: EarthSpiritMenu) {
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("Draw", this.Draw.bind(this))
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
		const hero = this.Hero
		const pressed = this.menu.State.value && this.menu.KickToFountain.isPressed
		if (!pressed || !this.InGame || hero === undefined) {
			this.wasPressed = false
			this.particles.DestroyByKey(ARROW_KEY)
			this.particles.DestroyByKey(LOCK_KEY)
			return
		}
		if (!this.wasPressed) {
			this.wasPressed = true
			hero.OrderStop()
		}
		if (hero.IsStunned) {
			return
		}
		const fountain = this.FindFountain()
		const enemy = fountain === undefined ? undefined : this.FindTarget(hero, fountain)
		if (fountain === undefined || enemy === undefined) {
			this.particles.DestroyByKey(ARROW_KEY)
			return
		}
		this.DrawPath(hero, enemy, fountain)
		if (GameState.RawGameTime - this.lastOrderTime < ORDER_GAP) {
			return
		}
		this.Execute(hero, enemy, fountain)
	}

	private Execute(hero: npc_dota_hero_earth_spirit, enemy: Hero, fountain: Fountain): void {
		const smash = hero.GetAbilityByClass(earth_spirit_boulder_smash)
		if (smash === undefined || smash.Level === 0) {
			return
		}
		const distance = hero.Distance2D(enemy)

		if (this.BreakLinken(hero, enemy)) {
			return
		}

		const petrify = hero.GetAbilityByName(PETRIFY_ABILITY)
		if (
			petrify !== undefined &&
			petrify.CanBeCasted() &&
			!enemy.HasBuffByName(PETRIFY_MODIFIER) &&
			!enemy.HasBuffByName(BKB_MODIFIER)
		) {
			if (distance <= petrify.CastRange) {
				hero.CastTarget(petrify, enemy)
				this.lastOrderTime = GameState.RawGameTime
				return
			}
			if (this.Blink(hero, enemy, fountain, distance)) {
				return
			}
		}

		if (distance <= PICKUP_RADIUS && !this.HasCloserUnit(hero, enemy)) {
			if (smash.CanBeCasted()) {
				hero.CastPosition(smash, this.ClampToRange(hero, fountain.Position, smash.CastRange))
				this.lastOrderTime = GameState.RawGameTime
			}
			return
		}

		if (this.Blink(hero, enemy, fountain, distance)) {
			return
		}
		hero.MoveTo(this.KickSpot(enemy, fountain))
		this.lastOrderTime = GameState.RawGameTime
	}

	private KickSpot(enemy: Hero, fountain: Fountain): Vector3 {
		return enemy.Position.Extend(fountain.Position, -APPROACH_DISTANCE)
	}

	private Blink(hero: npc_dota_hero_earth_spirit, enemy: Hero, fountain: Fountain, distance: number): boolean {
		if (!this.menu.FountainBlink.value) {
			return false
		}
		if (distance < BLINK_MIN_RANGE || distance > BLINK_MAX_RANGE) {
			return false
		}
		const blink = hero.Items.find(item => item.Name.endsWith("blink") && item.CanBeCasted())
		if (blink === undefined) {
			return false
		}
		const landing = this.KickSpot(enemy, fountain)
		hero.CastPosition(blink, this.ClampToRange(hero, landing, blink.CastRange))
		this.lastOrderTime = GameState.RawGameTime
		return true
	}

	private BreakLinken(hero: npc_dota_hero_earth_spirit, enemy: Hero): boolean {
		if (!enemy.HasBuffByName(LINKEN_MODIFIER)) {
			return false
		}
		for (const name of LINKEN_BREAKERS) {
			const item = hero.Items.find(value => value.Name === name)
			if (item === undefined || !item.CanBeCasted()) {
				continue
			}
			if (hero.Distance2D(enemy) > item.CastRange) {
				continue
			}
			if (!this.TargetsEnemies(item)) {
				continue
			}
			hero.CastTarget(item, enemy)
			this.lastOrderTime = GameState.RawGameTime
			return true
		}
		return false
	}

	private TargetsEnemies(ability: Ability): boolean {
		return (
			ability.HasBehavior(DOTA_ABILITY_BEHAVIOR.DOTA_ABILITY_BEHAVIOR_UNIT_TARGET) &&
			ability.TargetTeamMask.hasMask(DOTA_UNIT_TARGET_TEAM.DOTA_UNIT_TARGET_TEAM_ENEMY)
		)
	}

	private FindFountain(): Nullable<Fountain> {
		return EntityManager.GetEntitiesByClass(Fountain).find(fountain => fountain.IsValid && !fountain.IsEnemy())
	}

	private FindTarget(hero: npc_dota_hero_earth_spirit, fountain: Fountain): Nullable<Hero> {
		const cursor = InputManager.CursorOnWorld
		let target: Nullable<Hero>
		let closest = Number.MAX_VALUE
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!this.IsValidTarget(enemy) || hero.Distance2D(enemy) > LOCK_RADIUS) {
				continue
			}
			if (!this.CanReachFountain(enemy, fountain)) {
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

	private CanReachFountain(enemy: Hero, fountain: Fountain): boolean {
		return enemy.Distance2D(fountain) <= KICK_FLIGHT + this.FountainReach(enemy, fountain)
	}

	private FountainReach(enemy: Hero, fountain: Fountain): number {
		return Math.max(fountain.GetAttackRange(enemy), FOUNTAIN_RADIUS)
	}

	private IsValidTarget(enemy: Hero): boolean {
		return (
			enemy.IsValid &&
			enemy.LifeState === LifeState.LIFE_ALIVE &&
			enemy.IsVisible &&
			enemy.IsEnemy() &&
			!enemy.IsIllusion
		)
	}

	private HasCloserUnit(hero: npc_dota_hero_earth_spirit, enemy: Hero): boolean {
		const distance = hero.Distance2D(enemy)
		return EntityManager.GetEntitiesByClass(Unit).some(
			unit =>
				unit !== hero &&
				unit !== enemy &&
				!unit.IsBuilding &&
				unit.IsValid &&
				unit.IsAlive &&
				hero.Distance2D(unit) < distance
		)
	}

	private ClampToRange(hero: npc_dota_hero_earth_spirit, position: Vector3, range: number): Vector3 {
		if (range <= 0 || hero.Distance2D(position) <= range) {
			return position.Clone()
		}
		return hero.Position.Extend(position, range)
	}

	private State(hero: npc_dota_hero_earth_spirit, enemy: Hero): KickState {
		const smash = hero.GetAbilityByClass(earth_spirit_boulder_smash)
		if (smash === undefined || smash.Level === 0) {
			return KickState.Denied
		}
		if (enemy.HasBuffByName(BKB_MODIFIER) || enemy.HasBuffByName(LINKEN_MODIFIER)) {
			return KickState.Denied
		}
		if (!smash.IsManaEnough()) {
			return KickState.NoMana
		}
		if (hero.Distance2D(enemy) > PICKUP_RADIUS) {
			return KickState.Approach
		}
		return KickState.Ready
	}

	private StateColor(state: KickState): Color {
		switch (state) {
			case KickState.Ready:
				return READY_COLOR
			case KickState.Denied:
				return DENIED_COLOR
			default:
				return WAIT_COLOR
		}
	}

	private StateText(hero: npc_dota_hero_earth_spirit, enemy: Hero, state: KickState): string {
		switch (state) {
			case KickState.Ready:
				return "KILL CONFIRMED"
			case KickState.NoMana: {
				const smash = hero.GetAbilityByClass(earth_spirit_boulder_smash)
				const missing = Math.ceil((smash?.ManaCost ?? 0) - hero.Mana)
				return `NEED MANA (-${Math.max(missing, 0)}MP)`
			}
			case KickState.Denied:
				return enemy.HasBuffByName(LINKEN_MODIFIER) ? "TARGET LINKEN" : "TARGET BKB / DENIED"
			default:
				return "GET CLOSER"
		}
	}

	private DrawPath(hero: npc_dota_hero_earth_spirit, enemy: Hero, fountain: Fountain): void {
		const state = this.State(hero, enemy)
		const color = this.StateColor(state)
		const landing = enemy.Position.Extend(fountain.Position, Math.min(KICK_FLIGHT, enemy.Distance2D(fountain)))
		this.particles.DrawArrow2D(ARROW_KEY, enemy, {
			Start: enemy.Position,
			End: landing,
			Width: 140,
			Color: color,
			Alpha: 255
		})
		this.particles.DrawCircle(LOCK_KEY, hero, LOCK_RADIUS, { Color: color })
	}

	private Draw(): void {
		if (!this.menu.State.value || !this.InGame) {
			return
		}
		const hero = this.Hero
		if (hero === undefined) {
			return
		}
		const fountain = this.FindFountain()
		if (fountain === undefined) {
			return
		}
		const held = this.menu.KickToFountain.isPressed
		for (const enemy of EntityManager.GetEntitiesByClass(Hero)) {
			if (!this.IsValidTarget(enemy) || !this.CanReachFountain(enemy, fountain)) {
				continue
			}
			if (!held && hero.Distance2D(enemy) > LOCK_RADIUS) {
				continue
			}
			const state = this.State(hero, enemy)
			const color = this.StateColor(state)
			if (held) {
				this.DrawCage(enemy, color)
			}
			this.DrawCard(hero, enemy, state, color)
		}
	}

	private DrawCage(enemy: Hero, color: Color): void {
		const pulse = 0.5 + 0.5 * Math.sin(GameState.RawGameTime * 6)
		const radius = CAGE_RADIUS * (0.9 + 0.2 * pulse)
		const center = enemy.Position
		const top = this.ToScreen(center.Add(new Vector3(0, 0, CAGE_HEIGHT)))
		const bottom = this.ToScreen(center)
		const ring = [
			this.ToScreen(center.Add(new Vector3(radius, 0, CAGE_HEIGHT / 2))),
			this.ToScreen(center.Add(new Vector3(0, radius, CAGE_HEIGHT / 2))),
			this.ToScreen(center.Add(new Vector3(-radius, 0, CAGE_HEIGHT / 2))),
			this.ToScreen(center.Add(new Vector3(0, -radius, CAGE_HEIGHT / 2)))
		]
		const width = 1 + 2 * pulse
		for (let index = 0; index < ring.length; index++) {
			const current = ring[index]
			const next = ring[(index + 1) % ring.length]
			if (current === undefined || next === undefined) {
				continue
			}
			RendererSDK.Line(current, next, color, width)
			if (top !== undefined) {
				RendererSDK.Line(current, top, color, width)
			}
			if (bottom !== undefined) {
				RendererSDK.Line(current, bottom, color, width)
			}
		}
	}

	private DrawCard(hero: npc_dota_hero_earth_spirit, enemy: Hero, state: KickState, color: Color): void {
		const anchor = this.ToScreen(enemy.Position.Add(new Vector3(0, 0, CAGE_HEIGHT + 60)))
		if (anchor === undefined) {
			return
		}
		const position = anchor.Subtract(new Vector2(CARD_WIDTH / 2, CARD_HEIGHT))
		const size = new Vector2(CARD_WIDTH, CARD_HEIGHT)
		RendererSDK.FilledRect(position, size, CARD_BACKGROUND)
		RendererSDK.OutlinedRect(position, size, 2, color)
		RendererSDK.Text(
			this.StateText(hero, enemy, state),
			position.Add(new Vector2(10, 6)),
			color,
			RendererSDK.DefaultFontName,
			18,
			700
		)
	}

	private ToScreen(position: Vector3): Nullable<Vector2> {
		return RendererSDK.WorldToScreen(position)
	}

	private GameEnded(): void {
		this.menu.KickToFountain.isPressed = false
		this.wasPressed = false
		this.lastOrderTime = 0
		this.particles.DestroyAll()
	}
}
