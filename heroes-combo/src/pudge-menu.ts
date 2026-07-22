import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"

import { SquareIcons } from "./icons"

export const PUDGE_ABILITIES = ["pudge_meat_hook", "pudge_rot", "pudge_flesh_heap", "pudge_dismember"]

export class PudgeMenu {
	public readonly State: Menu.Toggle
	public readonly ComboKey: Menu.KeyBind
	public readonly AutoHookKey: Menu.KeyBind
	public readonly Abilities: Menu.ImageSelector
	public readonly AutoRot: Menu.Toggle
	public readonly ComboAfterHook: Menu.Toggle

	constructor(parent: Menu.Node) {
		const tree = parent.AddNode("Pudge", ImageData.GetHeroTexture("npc_dota_hero_pudge", true))
		this.State = tree.AddToggle("Pudge", true, "Включить скрипт на Pudge")
		this.ComboKey = tree.AddKeybind(
			"Клавиша комбо",
			"None",
			"Пока зажата — комбо по врагу у курсора.\nЕсли цель летит в хуке — мгновенное\nРасчленение на подлёте"
		)
		this.AutoHookKey = tree.AddKeybind(
			"Авто-Хук",
			"None",
			"Пока зажата — хук кидается сам в тот же тик,\nкогда расчёт перехвата даёт высокий шанс:\nцель стоит, оглушена, кастует, или её\nсносит рывком/отбрасыванием"
		)
		this.Abilities = SquareIcons(
			tree.AddImageSelector(
				"Способности",
				PUDGE_ABILITIES,
				new Map(PUDGE_ABILITIES.map(name => [name, true])),
				"Клик по иконке — вкл/выкл скилл в комбо",
				true
			)
		)
		this.AutoRot = tree.AddToggle(
			"Авто-Rot",
			true,
			"Включает Гниль после попадания хука\nи на время Расчленения, потом сама гасит.\nГниль, включённую руками, не трогает"
		)
		this.ComboAfterHook = tree.AddToggle(
			"Авто-комбо после хука",
			true,
			"Успешный хук сам запускает комбо.\nЛюбой свой приказ (движение, отмена\nРасчленения) обрывает его"
		)
	}
}
