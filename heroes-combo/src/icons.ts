import { Menu } from "github.com/octarine-public/wrapper/index"

interface IImageSelectorLayout {
	imageSize: { x: number; y: number }
	Size: { x: number }
	nameSize: { x: number }
	textOffset: { x: number }
	values: string[]
}

interface IImageSelectorMetrics {
	imageBorderWidth: number
	imageGap: number
	baseImageHeight: number
	elementsPerRow: number
}

export function SquareIcons(selector: Menu.ImageSelector): Menu.ImageSelector {
	const update = selector.Update.bind(selector)
	const layout = selector as unknown as IImageSelectorLayout
	const metrics = Menu.ImageSelector as unknown as IImageSelectorMetrics
	selector.Update = () => {
		if (!update()) {
			return false
		}
		const columns = Math.min(layout.values.length, metrics.elementsPerRow)
		layout.imageSize.x = layout.imageSize.y = metrics.baseImageHeight
		layout.Size.x =
			Math.max(
				layout.nameSize.x,
				columns * (layout.imageSize.x + metrics.imageBorderWidth * 2 + metrics.imageGap)
			) +
			layout.textOffset.x * 2
		return true
	}
	return selector
}
