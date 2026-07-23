import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"

import { SquareIcons } from "./icons"
import { PUDGE_ITEMS } from "./pudge-menu"

export const SLARK_ABILITIES = ["slark_dark_pact", "slark_pounce", "slark_saltwater_shiv", "slark_shadow_dance"]
export const SLARK_ITEMS = [...PUDGE_ITEMS]

export class SlarkMenu {
	public readonly State: Menu.Toggle
	public readonly ComboKey: Menu.KeyBind
	public readonly PounceToCursor: Menu.Toggle
	public readonly Abilities: Menu.ImageSelector
	public readonly Items: Menu.ImageSelector
	public readonly ShadowDanceHP: Menu.Slider

	constructor(parent: Menu.Node) {
		const tree = parent.AddNode("Slark", ImageData.GetHeroTexture("npc_dota_hero_slark", true))
		this.State = tree.AddToggle("State", true)
		this.ComboKey = tree.AddKeybind("Combo Key", "None")
		this.PounceToCursor = tree.AddToggle("Pounce To Cursor", true)
		this.Abilities = SquareIcons(
			tree.AddImageSelector(
				"Abilities",
				SLARK_ABILITIES,
				new Map(SLARK_ABILITIES.map(name => [name, true])),
				"",
				true
			)
		)
		this.Items = SquareIcons(
			tree.AddImageSelector("Items", SLARK_ITEMS, new Map(SLARK_ITEMS.map(name => [name, true])), "", true)
		)
		this.ShadowDanceHP = tree.AddSlider("Shadow Dance HP", 35, 1, 100)
	}
}
