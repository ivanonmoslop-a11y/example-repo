import {
	AbilityData,
	DOTAGameState,
	DOTAGameUIState,
	DOTA_SHOP_TYPE,
	EventsSDK,
	GameRules,
	GameState,
	item_dust,
	LocalPlayer,
	Unit
} from "github.com/octarine-public/wrapper/index"

import { MenuManager } from "./menu"

new (class BadGay {
	private readonly menu = new MenuManager()
	private dustItemID: number = 0

	constructor() {
		EventsSDK.on("PostDataUpdate", this.PostDataUpdate.bind(this))
		EventsSDK.on("GameStarted", this.GameStarted.bind(this))
	}

	private get InGame(): boolean {
		if (GameState.UIState !== DOTAGameUIState.DOTA_GAME_UI_DOTA_INGAME) {
			return false
		}
		return GameRules?.GameState === DOTAGameState.DOTA_GAMERULES_STATE_GAME_IN_PROGRESS
	}

	private GameStarted(): void {
		const data = AbilityData.globalStorage.get("item_dust")
		this.dustItemID = data?.ID ?? 0
	}

	private PostDataUpdate(): void {
		if (!this.menu.State.value || !this.InGame) return
		if (!this.menu.DustAbuse.value && !this.menu.DustKey.isPressed) return

		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsAlive) return

		if (!this.isNearShop(hero)) return

		this.doDustAbuse(hero)
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
		if (this.dustItemID === 0) return
		hero.PurchaseItem(this.dustItemID)
	}
})()
