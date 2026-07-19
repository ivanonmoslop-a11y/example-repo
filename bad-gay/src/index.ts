import {
	AbilityData,
	DOTA_SHOP_TYPE,
	DOTAGameState,
	DOTAGameUIState,
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

	// Pre-game counts: the fountain shop is already open before the horn, so the
	// dust abuse has to work there too — not only once the clock starts.
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
	}

	private PostDataUpdate(): void {
		if (!this.menu.State.value || !this.InGame) {
			return
		}

		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsValid) {
			return
		}

		// Death does not close the shop — a corpse at the fountain can still buy and
		// sell, so the abuse keeps running through the respawn timer.
		if (this.menu.DustAbuse.value && (!hero.IsAlive || this.isNearShop(hero))) {
			this.doDustAbuse(hero)
		}

		if (this.menu.PingSpam.value && hero.IsAlive) {
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
		const itemID = this.DustItemID
		if (itemID === 0) {
			return
		}
		hero.PurchaseItem(itemID)
	}

	// Resolved on demand rather than on GameStarted: in pre-game that event has not
	// fired yet, and an ID of 0 would silently skip every purchase.
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

		this.pingIndex = this.pingIndex % allies.length
		const target = allies[this.pingIndex]
		const pos = Vector2.FromVector3(target.Position)
		MinimapSDK.SendPing(pos, PingType.NORMAL, true, target)
		this.pingIndex++
	}
})()
