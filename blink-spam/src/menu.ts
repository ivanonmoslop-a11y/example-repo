import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"

export class MenuManager {
	private readonly base = Menu.AddEntry("Utility")
	private readonly icon = ImageData.GetItemTexture("item_blink")
	private readonly tree = this.base.AddNode("Blink Spam", this.icon)

	public readonly State: Menu.Toggle
	public readonly SpamKey: Menu.KeyBind
	public readonly ShowDebug: Menu.Toggle

	constructor() {
		this.State = this.tree.AddToggle("State", true)
		this.SpamKey = this.tree.AddKeybind(
			"Spam Key",
			"None",
			"Hold to spam Blink Dagger casts at the cursor.\nThe blink fires on the first server tick it becomes castable"
		)
		this.ShowDebug = this.tree.AddToggle("Show Debug", false)
	}
}
