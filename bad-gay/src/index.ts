import {
	AbilityData,
	DOTA_SHOP_TYPE,
	DOTAGameState,
	DOTAGameUIState,
	dotaunitorder_t,
	EntityManager,
	EventsSDK,
	ExecuteOrder,
	GameRules,
	GameState,
	Hero,
	InputManager,
	item_dust,
	LocalPlayer,
	MinimapSDK,
	PingType,
	Sleeper,
	Unit,
	Vector2,
	Vector3,
	VMouseKeys
} from "github.com/octarine-public/wrapper/index"

import { MenuManager } from "./menu"

new (class BadGay {
	private readonly menu = new MenuManager()
	private readonly paintSleeper = new Sleeper()
	private dustItemID: number = 0
	private minimapActive = false
	private paintPoints: Vector2[] = []
	private paintIndex = 0
	private drawModeOn = false

	constructor() {
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("GameStarted", this.GameStarted.bind(this))
		EventsSDK.on("GameEnded", this.GameEnded.bind(this))
		this.menu.MinimapPaintKey.OnRelease(() => {
			this.minimapActive = !this.minimapActive
			if (!this.minimapActive) {
				this.stopDrawMode()
			}
		})
	}

	private get InGame(): boolean {
		if (GameState.UIState !== DOTAGameUIState.DOTA_GAME_UI_DOTA_INGAME) {
			return false
		}
		const state = GameRules?.GameState
		if (state === undefined) {
			return false
		}
		return (
			state >= DOTAGameState.DOTA_GAMERULES_STATE_PRE_GAME &&
			state <= DOTAGameState.DOTA_GAMERULES_STATE_GAME_IN_PROGRESS
		)
	}

	private GameStarted(): void {
		this.dustItemID = 0
		this.minimapActive = false
		this.paintPoints = []
		this.paintIndex = 0
		this.drawModeOn = false
		this.paintSleeper.FullReset()
	}

	private GameEnded(): void {
		this.stopDrawMode()
	}

	private PostDataUpdate(): void {
		if (!this.menu.State.value || !this.InGame) {
			this.stopDrawMode()
			return
		}

		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsValid) {
			return
		}

		if (this.menu.DustAbuse.value && (!hero.IsAlive || this.isNearShop(hero))) {
			this.doDustAbuse(hero)
		}

		if (this.menu.PingSpam.value && hero.IsAlive) {
			this.doPingSpam(hero)
		}

		if (this.menu.RightClickSpam.value && hero.IsAlive) {
			this.doRightClickSpam(hero)
		}

		if (this.menu.BodyBlock.value && hero.IsAlive) {
			this.doBodyBlock(hero)
		}

		const paintOn = this.menu.MinimapPaint.value || this.minimapActive
		if (paintOn) {
			this.doMinimapPaint()
		} else {
			this.stopDrawMode()
		}
	}

	private isNearShop(hero: Unit): boolean {
		return (
			hero.CurrentShop === DOTA_SHOP_TYPE.DOTA_SHOP_HOME ||
			hero.CurrentShop === DOTA_SHOP_TYPE.DOTA_SHOP_SIDE ||
			hero.CurrentShop === DOTA_SHOP_TYPE.DOTA_SHOP_SIDE2
		)
	}

	private doDustAbuse(hero: Unit): void {
		const dust = hero.GetItemByClass(item_dust)
		if (dust !== undefined) {
			hero.SellItem(dust)
			return
		}
		const itemID = this.DustItemID
		if (itemID === 0) {
			return
		}
		hero.PurchaseItem(itemID)
	}

	private get DustItemID(): number {
		if (this.dustItemID === 0) {
			this.dustItemID = AbilityData.globalStorage.get("item_dust")?.ID ?? 0
		}
		return this.dustItemID
	}

	private doPingSpam(hero: Unit): void {
		const allies = EntityManager.GetEntitiesByClass(Hero).filter(
			h => !h.IsEnemy(hero) && h !== hero && h.IsAlive && h.IsValid
		)
		if (allies.length === 0) {
			return
		}

		for (const ally of allies) {
			const pos = Vector2.FromVector3(ally.Position)
			MinimapSDK.SendPing(pos, PingType.NORMAL, true, ally)
		}
	}

	private buildPaintPath(): void {
		this.paintPoints = []
		const bounds = MinimapSDK.MinimapBounds
		const minX = bounds.IsZero() ? -8000 : bounds.Left
		const maxX = bounds.IsZero() ? 8000 : bounds.Right
		const minY = bounds.IsZero() ? -8000 : bounds.Top
		const maxY = bounds.IsZero() ? 8000 : bounds.Bottom
		const step = this.menu.MinimapPaintStep.value * 100
		const wobble = step * 0.4
		let leftToRight = true
		for (let y = minY; y <= maxY; y += step) {
			const wy = y + (Math.random() - 0.5) * wobble
			if (leftToRight) {
				for (let x = minX; x <= maxX; x += step) {
					this.paintPoints.push(
						new Vector2(
							x + (Math.random() - 0.5) * wobble,
							wy + (Math.random() - 0.5) * wobble * 0.3
						)
					)
				}
			} else {
				for (let x = maxX; x >= minX; x -= step) {
					this.paintPoints.push(
						new Vector2(
							x + (Math.random() - 0.5) * wobble,
							wy + (Math.random() - 0.5) * wobble * 0.3
						)
					)
				}
			}
			leftToRight = !leftToRight
		}
	}

	private startDrawMode(): void {
		if (!this.drawModeOn) {
			GameState.ExecuteCommand("+dota_communicator_draw")
			this.drawModeOn = true
		}
	}

	private stopDrawMode(): void {
		if (this.drawModeOn) {
			GameState.ExecuteCommand("-dota_communicator_draw")
			this.drawModeOn = false
		}
	}

	private doMinimapPaint(): void {
		const delay = this.menu.MinimapPaintSpeed.value
		if (delay > 0 && this.paintSleeper.Sleeping("paint")) {
			return
		}
		if (this.paintPoints.length === 0) {
			this.buildPaintPath()
			if (this.paintPoints.length === 0) {
				return
			}
		}
		if (this.paintIndex >= this.paintPoints.length) {
			this.paintIndex = 0
			this.buildPaintPath()
		}

		this.startDrawMode()

		const worldPos = this.paintPoints[this.paintIndex]
		const screenPos = MinimapSDK.WorldToMinimap(
			Vector3.FromVector2(worldPos)
		)
		CursorPosition[0] = Math.round(screenPos.x)
		CursorPosition[1] = Math.round(screenPos.y)
		InputManager.UpdateCursorOnScreen(
			CursorPosition[0],
			CursorPosition[1]
		)

		this.paintIndex++
		if (delay > 0) {
			this.paintSleeper.Sleep(delay, "paint")
		}
	}

	private doRightClickSpam(hero: Unit): void {
		if (!InputManager.IsMouseKeyDown(VMouseKeys.MK_RBUTTON)) {
			return
		}
		ExecuteOrder.PrepareOrder({
			orderType: dotaunitorder_t.DOTA_UNIT_ORDER_MOVE_TO_POSITION,
			issuers: [hero],
			position: InputManager.CursorOnWorld,
			isPlayerInput: false
		})
	}

	private doBodyBlock(hero: Unit): void {
		const allies = EntityManager.GetEntitiesByClass(Hero).filter(
			h => !h.IsEnemy(hero) && h !== hero && h.IsAlive && h.IsValid
		)
		if (allies.length === 0) {
			return
		}
		let closest: Hero | undefined
		let closestDist = Infinity
		for (const ally of allies) {
			const dist = hero.Position.Distance(ally.Position)
			if (dist < closestDist) {
				closestDist = dist
				closest = ally
			}
		}
		if (closest === undefined) {
			return
		}
		const allyPos = closest.Position
		const allyForward = closest.Forward.MultiplyScalar(
			closest.HullRadius + hero.HullRadius
		)
		const blockPos = allyPos.Add(allyForward)
		hero.MoveTo(blockPos)
	}
})()
