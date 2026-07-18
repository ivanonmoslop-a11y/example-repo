import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"

export class MenuManager {
	private readonly base = Menu.AddEntry("Utility")
	private readonly icon = ImageData.GetItemTexture("item_cyclone")
	private readonly tree = this.base.AddNode("Auto Dodge", this.icon)

	public readonly State: Menu.Toggle
	public readonly PanelKey: Menu.KeyBind
	public readonly ShowDebug: Menu.Toggle

	constructor() {
		this.State = this.tree.AddToggle("State", true)
		this.PanelKey = this.tree.AddKeybind(
			"Panel Key",
			"None",
			"Press to show or hide the dodge panel.\nClick icons on the panel to allow/forbid a counter,\nthe bottom button toggles animation cancel"
		)
		this.ShowDebug = this.tree.AddToggle("Show Debug", false)
	}
}
