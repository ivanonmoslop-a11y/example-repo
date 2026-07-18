import {
	Color,
	DOTAGameState,
	DOTAGameUIState,
	EventsSDK,
	GameRules,
	GameState,
	Hero,
	InputManager,
	item_blink,
	LocalPlayer,
	RendererSDK,
	Unit,
	Vector2,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { MenuManager } from "./menu"

const TURN_CONE = 0.5
const SECTOR_STEPS = 16
const SECTOR_WIDTH = 2
const SECTOR_COLOR = new Color(0, 255, 255)

new (class BlinkSpam {
	private readonly menu = new MenuManager()
	private blink: Nullable<item_blink>
	private debugText = ""

	constructor() {
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("UnitItemsChanged", this.UnitItemsChanged.bind(this))
		EventsSDK.on("Draw", this.Draw.bind(this))
		EventsSDK.on("GameEnded", this.GameEnded.bind(this))
	}

	private get Hero(): Nullable<Hero> {
		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsValid) {
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
		this.debugText = ""
		if (!this.menu.State.value || !this.InGame) {
			return
		}
		const hero = this.Hero
		if (hero === undefined) {
			return
		}
		const blink = this.GetBlink(hero)
		if (blink === undefined) {
			return
		}
		this.UpdateDebug(hero, blink)
		if (!this.menu.BlinkKey.isPressed) {
			return
		}
		hero.CastPosition(blink, InputManager.CursorOnWorld, false, false)
	}

	private GetBlink(hero: Hero): Nullable<item_blink> {
		if (this.blink !== undefined && this.blink.IsValid) {
			return this.blink
		}
		this.blink = hero.Items.find((item): item is item_blink => item instanceof item_blink)
		return this.blink
	}

	private UpdateDebug(hero: Hero, blink: item_blink): void {
		if (!this.menu.ShowDebug.value) {
			return
		}
		const cd = Math.round(blink.Cooldown * 1000)
		const state = this.menu.BlinkKey.isPressed ? (hero.IsAlive ? "spam" : "spam-dead") : "idle"
		this.debugText = `${state} | cd ${cd}ms`
	}

	private Draw(): void {
		if (!this.menu.State.value || !this.InGame) {
			return
		}
		const hero = this.Hero
		if (hero === undefined) {
			return
		}
		if (this.menu.ShowSector.value) {
			this.DrawSector(hero)
		}
		if (this.debugText.length === 0) {
			return
		}
		const pos = RendererSDK.WorldToScreen(hero.RealPosition)
		if (pos === undefined) {
			return
		}
		RendererSDK.Text(this.debugText, pos, Color.White)
	}

	private DrawSector(hero: Hero): void {
		const blink = this.blink
		if (blink === undefined || !blink.IsValid) {
			return
		}
		const origin = hero.RealPosition
		const start = RendererSDK.WorldToScreen(origin)
		if (start === undefined) {
			return
		}
		const facing = hero.RotationRad
		const range = blink.CastRange
		let prev: Nullable<Vector2>
		for (let i = 0; i <= SECTOR_STEPS; i++) {
			const angle = facing - TURN_CONE + (2 * TURN_CONE * i) / SECTOR_STEPS
			const world = Vector3.FromAngle(angle).MultiplyScalar(range).AddForThis(origin)
			const screen = RendererSDK.WorldToScreen(world)
			if (screen !== undefined) {
				if (prev !== undefined) {
					RendererSDK.Line(prev, screen, SECTOR_COLOR, SECTOR_WIDTH)
				}
				if (i === 0 || i === SECTOR_STEPS) {
					RendererSDK.Line(start, screen, SECTOR_COLOR, SECTOR_WIDTH)
				}
			}
			prev = screen
		}
	}

	private UnitItemsChanged(unit: Unit): void {
		if (unit === LocalPlayer?.Hero) {
			this.blink = undefined
		}
	}

	private GameEnded(): void {
		this.menu.BlinkKey.isPressed = false
		this.blink = undefined
		this.debugText = ""
	}
})()
