import type { TimelineItem } from '../../core/timeline/types'
import type { MediaAsset } from '../../core/media/types'
import { evaluateItemProperty } from '../../core/timeline/keyframeEvaluation'
import { measureTextDimensions } from '../../core/timeline/textMeasurement'
import { getMediaFittedDimensions } from '../../core/utils'

/** One set of dimensions for both the rendered layer and its editing controls. */
export function getPreviewLayerDimensions(
  item: TimelineItem,
  asset: MediaAsset | undefined,
  projectWidth: number,
  projectHeight: number,
  time: number,
) {
  if (item.itemType === 'text' || item.text) {
    const text = item.text
    return measureTextDimensions({
      ...text,
      text: text?.text || 'Text Layer',
      fontSize: evaluateItemProperty(item, 'fontSize', time),
      padding: evaluateItemProperty(item, 'padding', time),
      strokeWidth: evaluateItemProperty(item, 'strokeWidth', time),
      maxWidth: projectWidth * 0.9,
    })
  }
  if (item.itemType === 'caption' || item.caption) {
    const style = item.caption?.style
    return measureTextDimensions({
      ...style,
      text: item.caption?.text || 'Subtitle Caption',
      fontSize: style?.fontSize || 48,
      fontWeight: style?.fontWeight || '600',
      padding: style?.padding ?? 12,
      maxWidth: projectWidth * 0.85,
    })
  }
  if (item.itemType === 'solid' || item.solid || item.itemType === 'adjustment') {
    return { width: projectWidth, height: projectHeight }
  }
  return getMediaFittedDimensions(
    asset?.metadata?.width || projectWidth,
    asset?.metadata?.height || projectHeight,
    projectWidth,
    projectHeight,
  )
}
