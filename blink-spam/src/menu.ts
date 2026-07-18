import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"

export class MenuManager {
	private readonly base = Menu.AddEntry("Utility")
	private readonly icon = ImageData.GetItemTexture("item_blink")
	private readonly tree = this.base.AddNode("Blink Spam", this.icon)

	public readonly State: Menu.Toggle
	public readonly BlinkKey: Menu.KeyBind
	public readonly ShowSector: Menu.Toggle
	public readonly ShowDebug: Menu.Toggle

	constructor() {
		this.State = this.tree.AddToggle("State", true)
		this.BlinkKey = this.tree.AddKeybind(
			"Blink Key",
			"None",
			"Set to the SAME key as your blink item slot.\nWhile held, blink casts are spammed every tick —\neven while dead, so it fires instantly on revive"
		)
		this.ShowSector = this.tree.AddToggle(
			"Show Instant Sector",
			true,
			"Draw the cone where a blink needs no turn\nand fires instantly on the first tick"
		)
		this.ShowDebug = this.tree.AddToggle("Show Debug", false)
	}
}
