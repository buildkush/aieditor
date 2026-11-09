import type { EffectDefinition } from './effectDefinitions'
import type { TextToolPreset } from './toolPresets'

export interface LayerToolDragData {
  dragType: 'layer'
  type?: 'layer'
  toolId: string
  name: string
  itemKind: 'text' | 'caption' | 'solid' | 'adjustment'
  duration: number
  preset?: TextToolPreset
  solidColor?: string
}

export interface EffectToolDragData {
  dragType: 'effect'
  type?: 'effect'
  effect: EffectDefinition
}

export interface TransitionToolDragData {
  dragType: 'transition'
  type?: 'transition'
  transitionId: string
  name: string
  category: string
  duration?: number
}

export type ActiveToolDrag =
  | LayerToolDragData
  | EffectToolDragData
  | TransitionToolDragData

let currentActiveDraggedTool: ActiveToolDrag | null = null

export function setActiveDraggedTool(tool: ActiveToolDrag | null): void {
  currentActiveDraggedTool = tool
  if (typeof window !== 'undefined') {
    ;(window as any).__AIDITOR_ACTIVE_DRAG_TOOL__ = tool
  }
}

export function getActiveDraggedTool(): ActiveToolDrag | null {
  if (currentActiveDraggedTool) return currentActiveDraggedTool
  if (typeof window !== 'undefined') {
    return (window as any).__AIDITOR_ACTIVE_DRAG_TOOL__ ?? null
  }
  return null
}
