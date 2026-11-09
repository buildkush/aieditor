import React from 'react'
import { MenuBar, type MenuBarProps } from './MenuBar'

export interface ToolbarProps extends MenuBarProps {
  // Optional backwards compatibility properties
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
  onAddText?: () => void
  onAddCaption?: () => void
  onAddSolid?: () => void
  onAddAdjustmentLayer?: () => void
  onOpenEffectsBrowser?: () => void
  onOpenTransitionBrowser?: () => void
}

/**
 * Toolbar component (now standard Application MenuBar).
 * Retained for backwards compatibility across imports and tests.
 */
export const Toolbar: React.FC<ToolbarProps> = (props) => {
  return <MenuBar {...props} />
}
