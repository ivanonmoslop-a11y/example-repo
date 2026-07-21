import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"

export class EarthSpiritMenu {
	public readonly State: Menu.Toggle
	public readonly AutoRemnant: Menu.Toggle
	public readonly BoulderSmash: Menu.Toggle
	public readonly GeomagneticGrip: Menu.Toggle
	public readonly RollingBoulder: Menu.Toggle
	public readonly ExtendMagnetize: Menu.Toggle

	constructor(parent: Menu.Node) {
		const tree = parent.AddNode("Earth Spirit", ImageData.GetHeroTexture("npc_dota_hero_earth_spirit", true))
		this.State = tree.AddToggle("State", true, "Включить комбо Earth Spirit")

		const remnant = tree.AddNode("Auto Remnant", ImageData.GetSpellTexture("earth_spirit_stone_caller"))
		this.AutoRemnant = remnant.AddToggle(
			"State",
			true,
			"Ставит ремнант под мануальные касты:\nесли для заклинания нет камня —\nсначала ставится камень, потом каст"
		)
		this.BoulderSmash = remnant.AddToggle(
			"Boulder Smash",
			true,
			"Ставит камень под собой, если рядом\nнет камня для пинка",
			0,
			ImageData.GetSpellTexture("earth_spirit_boulder_smash")
		)
		this.GeomagneticGrip = remnant.AddToggle(
			"Geomagnetic Grip",
			true,
			"Ставит камень в точке каста,\nесли там нет камня для притяжения",
			0,
			ImageData.GetSpellTexture("earth_spirit_geomagnetic_grip")
		)
		this.RollingBoulder = remnant.AddToggle(
			"Rolling Boulder",
			true,
			"Ставит камень под собой, чтобы\nкат прошёл через него",
			0,
			ImageData.GetSpellTexture("earth_spirit_rolling_boulder")
		)
		this.ExtendMagnetize = remnant.AddToggle(
			"Extend Magnetize",
			true,
			"Продлевает ульту: ставит камень рядом\nс намагниченным врагом, когда дебафф\nвот-вот спадёт",
			0,
			ImageData.GetSpellTexture("earth_spirit_magnetize")
		)
	}
}

export class MenuManager {
	private readonly base = Menu.AddEntry("Heroes Combo")

	public readonly Strength = this.base.AddNode("Strength", ImageData.Icons.primary_attribute_strength)
	public readonly Agility = this.base.AddNode("Agility", ImageData.Icons.primary_attribute_agility)
	public readonly Intelligence = this.base.AddNode("Intelligence", ImageData.Icons.primary_attribute_intelligence)
	public readonly Universal = this.base.AddNode("Universal", ImageData.Icons.primary_attribute_all)

	public readonly EarthSpirit = new EarthSpiritMenu(this.Strength)
}
