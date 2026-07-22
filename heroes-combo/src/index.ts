import { ComboManager } from "./combo"
import { EarthSpiritCombo } from "./earth-spirit"
import { FountainKick } from "./fountain"
import { KickCombo } from "./kick"
import { MenuManager } from "./menu"
import { PudgeCombo } from "./pudge"

new (class HeroesCombo {
	private readonly menu = new MenuManager()
	private readonly earthSpirit = new EarthSpiritCombo(this.menu.EarthSpirit)
	private readonly kick = new KickCombo(this.menu.EarthSpirit)
	private readonly combo = new ComboManager(this.menu.EarthSpirit)
	private readonly fountain = new FountainKick(this.menu.EarthSpirit)
	private readonly pudge = new PudgeCombo(this.menu.Pudge)

	public get EarthSpirit(): EarthSpiritCombo {
		return this.earthSpirit
	}

	public get Kick(): KickCombo {
		return this.kick
	}

	public get Combo(): ComboManager {
		return this.combo
	}

	public get Fountain(): FountainKick {
		return this.fountain
	}

	public get Pudge(): PudgeCombo {
		return this.pudge
	}
})()
