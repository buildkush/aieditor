export interface ActiveDraggedAsset {
  assetId: string
  type: string
  duration: number
  name: string
}

let currentDraggedAsset: ActiveDraggedAsset | null = null

export function setActiveDraggedAsset(asset: ActiveDraggedAsset | null) {
  currentDraggedAsset = asset
}

export function getActiveDraggedAsset(): ActiveDraggedAsset | null {
  return currentDraggedAsset
}
