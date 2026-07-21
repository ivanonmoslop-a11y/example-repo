import { EarthSpiritCombo } from "./earth-spirit"
import { KickToAlly } from "./kick-to-ally"
import { MenuManager } from "./menu"

new (class HeroesCombo {
	private readonly menu = new MenuManager()
	private readonly earthSpirit = new EarthSpiritCombo(this.menu.EarthSpirit)
	private readonly kickToAlly = new KickToAlly(this.menu.EarthSpirit)

	public get EarthSpirit(): EarthSpiritCombo {
		return this.earthSpirit
	}

	public get KickToAlly(): KickToAlly {
		return this.kickToAlly
	}
})()
