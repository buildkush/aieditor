import type { EditorCommand } from './editorCommand'
import type { ProjectState } from '../project/projectState'
import type { CaptionProperties } from '../timeline/types'
import { captionPropertiesForPreset, withCaptionFocus } from '../captions/captionStyles'

export type CaptionStylePatch = Partial<Pick<CaptionProperties, 'preset' | 'style' | 'presentation' | 'activeWordColor'>>

/** Style-only batch edit: one undo step, each caption retains its text and times. */
export class ApplyCaptionStyleCommand implements EditorCommand<'APPLY_CAPTION_STYLE', { itemIds: string[]; style: CaptionStylePatch }> {
  readonly type = 'APPLY_CAPTION_STYLE' as const
  readonly payload: { itemIds: string[]; style: CaptionStylePatch }

  constructor(itemIds: string[], style: CaptionStylePatch) {
    this.payload = structuredClone({ itemIds: [...new Set(itemIds)], style })
  }

  execute(state: ProjectState): ProjectState {
    const items = { ...state.items }, patch = this.payload.style
    let changed = false
    for (const id of this.payload.itemIds) {
      const item = state.items[id]
      if (!item?.caption || state.tracks.some(track => track.id === item.trackId && track.locked)) continue
      const base = patch.preset ? captionPropertiesForPreset(item.caption, patch.preset) : item.caption
      items[id] = { ...item, caption: { ...base,
        ...('presentation' in patch ? { presentation: structuredClone(patch.presentation) } : {}),
        ...(patch.activeWordColor !== undefined ? { activeWordColor: patch.activeWordColor } : {}),
        ...(patch.style ? { style: { ...base.style, ...patch.style } } : {}),
      } }
      if ('presentation' in patch) items[id] = { ...items[id], caption: { ...items[id].caption!, words: withCaptionFocus(items[id].caption!.words??[],patch.presentation) } }
      changed = true
    }
    return changed ? { ...state, items } : state
  }
}

/** Resolve explicit selection only; linked media never become style targets. */
export function selectedCaptionIds(state: ProjectState): string[] {
  const ids = new Set([...(state.selectedItemIds ?? []), ...(state.selectedItemId ? [state.selectedItemId] : [])])
  return [...ids].filter(id => !!state.items[id]?.caption)
}

export function allCaptionIds(state: ProjectState): string[] {
  return Object.keys(state.items).filter(id => !!state.items[id].caption)
}
