import { AbilityData, ImageData, Menu } from "github.com/octarine-public/wrapper/index"

import { SquareIcons } from "./icons"
import { PudgeMenu } from "./pudge-menu"
import { SlarkMenu } from "./slark-menu"

AbilityData.ShouldBeDrawable.add("earth_spirit_stone_caller")

const COMBO_ABILITIES = [
	"earth_spirit_stone_caller",
	"earth_spirit_geomagnetic_grip",
	"earth_spirit_rolling_boulder",
	"earth_spirit_boulder_smash",
	"earth_spirit_magnetize",
	"earth_spirit_petrify"
]

export const COMBO_ITEMS = [
	"item_soul_ring",
	"item_armlet",
	"item_ancient_janggo",
	"item_boots_of_bearing",
	"item_blink",
	"item_harpoon",
	"item_veil_of_discord",
	"item_shivas_guard",
	"item_ethereal_blade",
	"item_dagon_5",
	"item_sheepstick",
	"item_orchid",
	"item_bloodthorn",
	"item_nullifier",
	"item_rod_of_atos",
	"item_gungir",
	"item_abyssal_blade",
	"item_diffusal_blade",
	"item_disperser",
	"item_urn_of_shadows",
	"item_spirit_vessel",
	"item_black_king_bar",
	"item_blade_mail",
	"item_pipe",
	"item_lotus_orb",
	"item_heavens_halberd",
	"item_mjollnir",
	"item_manta",
	"item_invis_sword",
	"item_silver_edge",
	"item_blood_grenade",
	"item_satanic",
	"item_mask_of_madness",
	"item_refresher"
]

export class EarthSpiritMenu {
	public readonly State: Menu.Toggle
	public readonly ComboKey: Menu.KeyBind
	public readonly ComboAbilities: Menu.ImageSelector
	public readonly ComboItems: Menu.ImageSelector
	public readonly ShowDebug: Menu.Toggle
	public readonly AutoRemnant: Menu.Toggle
	public readonly BoulderSmash: Menu.Toggle
	public readonly GeomagneticGrip: Menu.Toggle
	public readonly RollingBoulder: Menu.Toggle
	public readonly ExtendMagnetize: Menu.Toggle
	public readonly KickToAlly: Menu.KeyBind
	public readonly KickToTower: Menu.KeyBind
	public readonly KickToFountain: Menu.KeyBind
	public readonly FountainBlink: Menu.Toggle

	constructor(parent: Menu.Node) {
		const tree = parent.AddNode("Earth Spirit", ImageData.GetHeroTexture("npc_dota_hero_earth_spirit", true))
		this.State = tree.AddToggle("State", true, "Включить комбо Earth Spirit")

		const combo = tree.AddNode("Combo", ImageData.GetSpellTexture("earth_spirit_magnetize"))
		this.ComboKey = combo.AddKeybind(
			"Combo Key",
			"None",
			"Пока зажата: спамит скиллы по ближайшему\nк курсору врагу по мере отката —\nStone → Grip → Rolling → Smash → Magnetize"
		)
		this.ComboAbilities = SquareIcons(
			combo.AddImageSelector(
				"Способности",
				COMBO_ABILITIES,
				new Map(COMBO_ABILITIES.map(name => [name, true])),
				"Клик по иконке — вкл/выкл скилл в комбо",
				true
			)
		)
		this.ComboItems = SquareIcons(
			combo.AddImageSelector(
				"Предметы",
				COMBO_ITEMS,
				new Map(COMBO_ITEMS.map(name => [name, true])),
				"Клик по иконке — вкл/выкл предмет в комбо.\nПорядок применения — как в списке",
				true
			)
		)
		this.ShowDebug = combo.AddToggle(
			"Show Debug",
			false,
			"Показывает дистанцию до цели и дальность\nкаждого скилла, пока зажато комбо"
		)

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

		this.KickToAlly = tree.AddKeybind(
			"Пнуть к союзнику",
			"None",
			"Пока зажата: пинает ближайшего врага\nв сторону союзника рядом с ним.\nЕсли есть блинк — прыгает на позицию\nза врагом, иначе подходит пешком"
		)
		this.KickToTower = tree.AddKeybind(
			"Пнуть к вышке",
			"None",
			"Пока зажата: пинает ближайшего врага\nпод свою ближайшую вышку.\nЕсли есть блинк — прыгает на позицию\nза врагом, иначе подходит пешком"
		)

		const fountain = tree.AddNode("Пнуть на фонтан", ImageData.GetSpellTexture("earth_spirit_petrify"))
		this.KickToFountain = fountain.AddKeybind(
			"Fountain Kick",
			"None",
			"Пока зажата: петрифай на врага и пинок\nв сторону своего фонтана.\nЦель берётся только та, что долетит"
		)
		this.FountainBlink = fountain.AddToggle(
			"Использовать блинк",
			true,
			"Прыгать блинком к цели, если до неё\nне хватает дальности пинка"
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
	public readonly Pudge = new PudgeMenu(this.Strength)
	public readonly Slark = new SlarkMenu(this.Agility)
}
