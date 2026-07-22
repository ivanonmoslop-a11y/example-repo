import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"

import { SquareIcons } from "./icons"

export const PUDGE_ABILITIES = ["pudge_meat_hook", "pudge_rot", "pudge_flesh_heap", "pudge_dismember"]

export const PUDGE_ITEMS = [
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
	"item_bloodstone",
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
	"item_refresher",
	"item_vanguard"
]

export class PudgeMenu {
	public readonly State: Menu.Toggle
	public readonly ComboKey: Menu.KeyBind
	public readonly AutoHookKey: Menu.KeyBind
	public readonly FakeHookKey: Menu.KeyBind
	public readonly Abilities: Menu.ImageSelector
	public readonly Items: Menu.ImageSelector
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
		this.FakeHookKey = tree.AddKeybind("Fake Hook", "None", "Fake hook at the enemy nearest the cursor")
		this.Abilities = SquareIcons(
			tree.AddImageSelector(
				"Способности",
				PUDGE_ABILITIES,
				new Map(PUDGE_ABILITIES.map(name => [name, true])),
				"Клик по иконке — вкл/выкл скилл в комбо",
				true
			)
		)
		this.Items = SquareIcons(
			tree.AddImageSelector(
				"Items",
				PUDGE_ITEMS,
				new Map(PUDGE_ITEMS.map(name => [name, true])),
				"Click an icon to enable or disable the item in Pudge combo",
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
