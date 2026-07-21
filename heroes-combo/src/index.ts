import { EarthSpiritCombo } from "./earth-spirit"
import { KickCombo } from "./kick"
import { MenuManager } from "./menu"

new (class HeroesCombo {
	private readonly menu = new MenuManager()
	private readonly earthSpirit = new EarthSpiritCombo(this.menu.EarthSpirit)
	private readonly kick = new KickCombo(this.menu.EarthSpirit)

	public get EarthSpirit(): EarthSpiritCombo {
		return this.earthSpirit
	}

	public get Kick(): KickCombo {
		return this.kick
	}
})()
