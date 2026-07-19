import {
	AbilityData,
	DOTAGameState,
	DOTAGameUIState,
	DOTA_SHOP_TYPE,
	EntityManager,
	EventsSDK,
	GameRules,
	GameState,
	Hero,
	item_dust,
	LocalPlayer,
	MinimapSDK,
	PingType,
	Unit,
	Vector2
} from "github.com/octarine-public/wrapper/index"

import { MenuManager } from "./menu"

new (class BadGay {
	private readonly menu = new MenuManager()
	private dustItemID: number = 0
	private pingIndex: number = 0

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

		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsAlive) return

		if (this.menu.DustAbuse.value) {
			if (this.isNearShop(hero)) {
				this.doDustAbuse(hero)
			}
		}

		if (this.menu.PingSpam.value) {
			this.doPingSpam(hero)
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
		if (this.dustItemID === 0) return
		hero.PurchaseItem(this.dustItemID)
	}

	private doPingSpam(hero: Unit): void {
		const allies = EntityManager.GetEntitiesByClass(Hero).filter(
			h => !h.IsEnemy(hero) && h !== hero && h.IsAlive && h.IsValid
		)
		if (allies.length === 0) return

		this.pingIndex = this.pingIndex % allies.length
		const target = allies[this.pingIndex]
		const pos = Vector2.FromVector3(target.Position)
		MinimapSDK.SendPing(pos, PingType.NORMAL, true, target)
		this.pingIndex++
	}
})()
