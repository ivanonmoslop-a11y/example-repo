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
	GUIInfo,
	Hero,
	InputManager,
	item_dust,
	LocalPlayer,
	MinimapSDK,
	PingType,
	RendererSDK,
	Unit,
	Vector2
} from "github.com/octarine-public/wrapper/index"

import { MenuManager } from "./menu"

new (class BadGay {
	private readonly menu = new MenuManager()
	private dustItemID: number = 0
	private minimapActive = false

	constructor() {
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("Draw2D", this.Draw2D.bind(this))
		EventsSDK.on("GameStarted", this.GameStarted.bind(this))
		this.menu.MinimapPaintKey.OnRelease(() => {
			this.minimapActive = !this.minimapActive
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
	}

	private PostDataUpdate(): void {
		if (!this.menu.State.value || !this.InGame) {
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
	}

	private Draw2D(): void {
		if (!this.menu.State.value || !this.InGame) {
			return
		}
		const paintEnabled =
			this.menu.MinimapPaint.value || this.minimapActive
		if (!paintEnabled) {
			return
		}
		this.doMinimapPaint()
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

	private doMinimapPaint(): void {
		const mmRect = GUIInfo.Minimap.MinimapRenderBounds
		const color = this.menu.MinimapPaintColor.SelectedColor.Clone()
		const step = this.menu.MinimapPaintStep.value

		for (let y = 0; y < mmRect.Height; y += step) {
			const linePos = new Vector2(mmRect.x, mmRect.y + y)
			const lineSize = new Vector2(mmRect.Width, step)
			RendererSDK.FilledRect(linePos, lineSize, color)
		}
	}

	private doRightClickSpam(hero: Unit): void {
		const cursorWorld = InputManager.CursorOnWorld
		const allHeroes = EntityManager.GetEntitiesByClass(Hero).filter(
			h => h !== hero && h.IsAlive && h.IsValid
		)
		if (allHeroes.length === 0) {
			return
		}
		let closest: Hero | undefined
		let closestDist = Infinity
		for (const h of allHeroes) {
			const dist = h.Position.Distance(cursorWorld)
			if (dist < closestDist) {
				closestDist = dist
				closest = h
			}
		}
		if (closest === undefined || closestDist > 300) {
			return
		}
		ExecuteOrder.PrepareOrder({
			orderType: dotaunitorder_t.DOTA_UNIT_ORDER_ATTACK_TARGET,
			issuers: [hero],
			target: closest,
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
