import { EarthSpiritCombo } from "./earth-spirit"
import { MenuManager } from "./menu"

new (class HeroesCombo {
	private readonly menu = new MenuManager()
	private readonly earthSpirit = new EarthSpiritCombo(this.menu.EarthSpirit)

	public get EarthSpirit(): EarthSpiritCombo {
		return this.earthSpirit
	}
})()
