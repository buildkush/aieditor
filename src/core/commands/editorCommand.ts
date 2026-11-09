import type { ProjectState } from '../project/projectState'
import type { MediaAsset } from '../media/types'
import type {
  TimelineItem,
  Track,
  Transform,
  Crop,
  AudioProperties,
  SpeedProperties,
  BlendMode,
  SolidProperties,
  TextProperties,
  CaptionProperties,
  ItemEffect,
  TimelineTransition,
} from '../timeline/types'
import {
  addMediaAsset,
  removeMediaAsset,
  addTrack,
  removeTrack,
  addTimelineItem,
  removeTimelineItem,
  updateTimelineItem,
  moveTimelineItem,
  trimTimelineItem,
  splitTimelineItem,
  setPlayheadTime,
  selectItem,
  selectItems,
  linkTimelineItems,
  unlinkTimelineItems,
  moveTimelineItems,
  trimTimelineItems,
  removeTimelineItems,
  splitTimelineItems,
  validateTimelineItem,
  cleanupEmptyTracks,
  normalizeTrackNames,
  updateItemTransform,
  updateItemTransformAtPlayhead,
  resetItemTransform,
  fitItemToCanvas,
  fillItemCanvas,
  updateItemCrop,
  resetItemCrop,
  updateItemAudio,
  resetItemAudio,
  updateItemSpeed,
  resetItemSpeed,
  toggleItemKeyframe,
  toggleAllItemKeyframes,
  addKeyframe,
  removeKeyframe,
  updateKeyframe,
  setKeyframeValue,
  toggleKeyframeAtPlayhead,
  moveKeyframe,
  setKeyframeInterpolation,
  addSolidLayer,
  updateSolidLayer,
  addAdjustmentLayer,
  type AddAdjustmentLayerOptions,
  addTextLayer,
  updateTextLayer,
  addCaption,
  updateCaption,
  splitCaption,
  mergeCaptions,
  applyCaptionPreset,
  importSubtitles,
  setBlendMode,
  updateProjectSettings,
  applyItemEffect,
  removeItemEffect,
  toggleItemEffect,
  updateItemEffectParam,
  reorderItemEffects,
  updateItemEffectTiming,
  resetItemEffectParams,
  addTimelineTransition,
  removeTimelineTransition,
  updateTimelineTransition,
  selectTimelineTransition,
  type UpdateProjectSettingsOptions,
  type TrimOptions,
  type AddSolidLayerOptions,
  type AddTextLayerOptions,
  type AddCaptionOptions,
} from './projectCommands'
import type { Keyframe, KeyframeInterpolation } from '../timeline/keyframeTypes'
import type { SubtitleCue } from '../subtitles/subtitleParser'
import type { ImportAutoCaptionsCommand } from './importAutoCaptionsCommand'
import type { ApplyCaptionStyleCommand } from './captionStyleCommands'
export { ApplyCaptionStyleCommand } from './captionStyleCommands'

export { validateTimelineItem, cleanupEmptyTracks, normalizeTrackNames }

/**
 * Core command abstraction.
 * All state modifications in aiditor must go through an EditorCommand.
 * Commands receive the current ProjectState and produce the next ProjectState deterministically.
 */
export interface EditorCommand<TType extends string = string, TPayload = unknown> {
  readonly type: TType
  readonly payload: TPayload
  readonly isUndoable?: boolean
  readonly changesPlayhead?: boolean
  readonly mergeKey?: string
  execute(state: ProjectState): ProjectState
}

export class AddMediaAssetCommand implements EditorCommand<'ADD_MEDIA_ASSET', { asset: MediaAsset }> {
  readonly type = 'ADD_MEDIA_ASSET' as const
  readonly payload: { asset: MediaAsset }

  constructor(asset: MediaAsset) {
    this.payload = { asset }
  }

  get asset(): MediaAsset {
    return this.payload.asset
  }

  execute(state: ProjectState): ProjectState {
    return addMediaAsset(state, this.payload.asset)
  }
}

export class RemoveMediaAssetCommand implements EditorCommand<'REMOVE_MEDIA_ASSET', { assetId: string }> {
  readonly type = 'REMOVE_MEDIA_ASSET' as const
  readonly payload: { assetId: string }

  constructor(assetId: string) {
    this.payload = { assetId }
  }

  get assetId(): string {
    return this.payload.assetId
  }

  execute(state: ProjectState): ProjectState {
    return removeMediaAsset(state, this.payload.assetId)
  }
}

export class AddTrackCommand implements EditorCommand<'ADD_TRACK', { track: Track }> {
  readonly type = 'ADD_TRACK' as const
  readonly payload: { track: Track }

  constructor(track: Track) {
    this.payload = { track }
  }

  get track(): Track {
    return this.payload.track
  }

  execute(state: ProjectState): ProjectState {
    return addTrack(state, this.payload.track)
  }
}

export class RemoveTrackCommand implements EditorCommand<'REMOVE_TRACK', { trackId: string }> {
  readonly type = 'REMOVE_TRACK' as const
  readonly payload: { trackId: string }

  constructor(trackId: string) {
    this.payload = { trackId }
  }

  get trackId(): string {
    return this.payload.trackId
  }

  execute(state: ProjectState): ProjectState {
    return removeTrack(state, this.payload.trackId)
  }
}

export class CleanupEmptyTracksCommand implements EditorCommand<'CLEANUP_EMPTY_TRACKS', Record<string, never>> {
  readonly type = 'CLEANUP_EMPTY_TRACKS' as const
  readonly payload = {}

  execute(state: ProjectState): ProjectState {
    return cleanupEmptyTracks(state)
  }
}

export class AddTimelineItemCommand implements EditorCommand<'ADD_TIMELINE_ITEM', { item: TimelineItem }> {
  readonly type = 'ADD_TIMELINE_ITEM' as const
  readonly payload: { item: TimelineItem }

  constructor(item: TimelineItem) {
    this.payload = { item }
  }

  get item(): TimelineItem {
    return this.payload.item
  }

  execute(state: ProjectState): ProjectState {
    return addTimelineItem(state, this.payload.item)
  }
}

export class AddTimelineItemPairCommand
  implements
    EditorCommand<
      'ADD_TIMELINE_ITEM_PAIR',
      { primaryItem: TimelineItem; secondaryItem: TimelineItem }
    > {
  readonly type = 'ADD_TIMELINE_ITEM_PAIR' as const
  readonly payload: { primaryItem: TimelineItem; secondaryItem: TimelineItem }

  constructor(primaryItem: TimelineItem, secondaryItem: TimelineItem) {
    this.payload = { primaryItem, secondaryItem }
  }

  get primaryItem(): TimelineItem {
    return this.payload.primaryItem
  }

  get secondaryItem(): TimelineItem {
    return this.payload.secondaryItem
  }

  execute(state: ProjectState): ProjectState {
    // Atomically adds both items (e.g. video + linked audio) in a single undoable step
    const stateWithFirst = addTimelineItem(state, this.payload.primaryItem)
    return addTimelineItem(stateWithFirst, this.payload.secondaryItem)
  }
}

export class RemoveTimelineItemCommand implements EditorCommand<'REMOVE_TIMELINE_ITEM', { itemId: string }> {
  readonly type = 'REMOVE_TIMELINE_ITEM' as const
  readonly payload: { itemId: string }

  constructor(itemId: string) {
    this.payload = { itemId }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return removeTimelineItem(state, this.payload.itemId)
  }
}

export class UpdateTimelineItemCommand
  implements
    EditorCommand<
      'UPDATE_TIMELINE_ITEM',
      { itemId: string; updates: Partial<Omit<TimelineItem, 'id'>> }
    > {
  readonly type = 'UPDATE_TIMELINE_ITEM' as const
  readonly payload: { itemId: string; updates: Partial<Omit<TimelineItem, 'id'>> }
  readonly mergeKey?: string

  constructor(itemId: string, updates: Partial<Omit<TimelineItem, 'id'>>, mergeKey?: string) {
    this.payload = { itemId, updates }
    this.mergeKey = mergeKey
  }

  get itemId(): string {
    return this.payload.itemId
  }

  get updates(): Partial<Omit<TimelineItem, 'id'>> {
    return this.payload.updates
  }

  execute(state: ProjectState): ProjectState {
    return updateTimelineItem(state, this.payload.itemId, this.payload.updates)
  }
}

export class MoveTimelineItemCommand
  implements
    EditorCommand<
      'MOVE_TIMELINE_ITEM',
      { itemId: string; startTime: number; trackId?: string }
    > {
  readonly type = 'MOVE_TIMELINE_ITEM' as const
  readonly payload: { itemId: string; startTime: number; trackId?: string }

  constructor(itemId: string, startTime: number, trackId?: string) {
    this.payload = { itemId, startTime, trackId }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  get startTime(): number {
    return this.payload.startTime
  }

  get trackId(): string {
    return this.payload.trackId ?? ''
  }

  execute(state: ProjectState): ProjectState {
    return moveTimelineItem(state, this.payload.itemId, this.payload.startTime, this.payload.trackId)
  }
}

export class TrimTimelineItemCommand
  implements
    EditorCommand<
      'TRIM_TIMELINE_ITEM',
      { itemId: string; trim: TrimOptions }
    > {
  readonly type = 'TRIM_TIMELINE_ITEM' as const
  readonly payload: { itemId: string; trim: TrimOptions }

  constructor(itemId: string, trim: TrimOptions) {
    this.payload = { itemId, trim }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  get trim(): TrimOptions {
    return this.payload.trim
  }

  execute(state: ProjectState): ProjectState {
    return trimTimelineItem(state, this.payload.itemId, this.payload.trim)
  }
}

export class SplitTimelineItemCommand
  implements
    EditorCommand<
      'SPLIT_TIMELINE_ITEM',
      { itemId: string; splitTime: number; leftItemId: string; rightItemId: string }
    > {
  readonly type = 'SPLIT_TIMELINE_ITEM' as const
  readonly payload: { itemId: string; splitTime: number; leftItemId: string; rightItemId: string }

  constructor(itemId: string, splitTime: number, leftItemId: string, rightItemId: string) {
    this.payload = { itemId, splitTime, leftItemId, rightItemId }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  get splitTime(): number {
    return this.payload.splitTime
  }

  get leftItemId(): string {
    return this.payload.leftItemId
  }

  get rightItemId(): string {
    return this.payload.rightItemId
  }

  execute(state: ProjectState): ProjectState {
    return splitTimelineItem(
      state,
      this.payload.itemId,
      this.payload.splitTime,
      this.payload.leftItemId,
      this.payload.rightItemId
    )
  }
}

export class SetPlayheadCommand implements EditorCommand<'SET_PLAYHEAD', { time: number }> {
  readonly type = 'SET_PLAYHEAD' as const
  readonly payload: { time: number }
  readonly isUndoable = false
  readonly changesPlayhead = true

  constructor(time: number) {
    this.payload = { time }
  }

  get time(): number {
    return this.payload.time
  }

  execute(state: ProjectState): ProjectState {
    return setPlayheadTime(state, this.payload.time)
  }
}

export class SelectItemCommand implements EditorCommand<'SELECT_ITEM', { itemId: string | null }> {
  readonly type = 'SELECT_ITEM' as const
  readonly payload: { itemId: string | null }

  constructor(itemId: string | null) {
    this.payload = { itemId }
  }

  get itemId(): string | null {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return selectItem(state, this.payload.itemId)
  }
}

export class SelectItemsCommand implements EditorCommand<'SELECT_ITEMS', { itemIds: string[] }> {
  readonly type = 'SELECT_ITEMS' as const
  readonly payload: { itemIds: string[] }

  constructor(itemIds: string[]) {
    this.payload = { itemIds }
  }

  get itemIds(): string[] {
    return this.payload.itemIds
  }

  execute(state: ProjectState): ProjectState {
    return selectItems(state, this.payload.itemIds)
  }
}

export class LinkTimelineItemsCommand implements EditorCommand<'LINK_TIMELINE_ITEMS', { itemIds: string[] }> {
  readonly type = 'LINK_TIMELINE_ITEMS' as const
  readonly payload: { itemIds: string[] }

  constructor(itemIds: string[]) {
    this.payload = { itemIds }
  }

  get itemIds(): string[] {
    return this.payload.itemIds
  }

  execute(state: ProjectState): ProjectState {
    return linkTimelineItems(state, this.payload.itemIds)
  }
}

export class UnlinkTimelineItemsCommand implements EditorCommand<'UNLINK_TIMELINE_ITEMS', { itemIds: string[] }> {
  readonly type = 'UNLINK_TIMELINE_ITEMS' as const
  readonly payload: { itemIds: string[] }

  constructor(itemIds: string[]) {
    this.payload = { itemIds }
  }

  get itemIds(): string[] {
    return this.payload.itemIds
  }

  execute(state: ProjectState): ProjectState {
    return unlinkTimelineItems(state, this.payload.itemIds)
  }
}

export class MoveTimelineItemsCommand implements EditorCommand<'MOVE_TIMELINE_ITEMS', { moves: { itemId: string; newStartTime: number; newTrackId?: string }[] }> {
  readonly type = 'MOVE_TIMELINE_ITEMS' as const
  readonly payload: { moves: { itemId: string; newStartTime: number; newTrackId?: string }[] }

  constructor(moves: { itemId: string; newStartTime: number; newTrackId?: string }[]) {
    this.payload = { moves }
  }

  get moves() {
    return this.payload.moves
  }

  execute(state: ProjectState): ProjectState {
    return moveTimelineItems(state, this.payload.moves)
  }
}

export class TrimTimelineItemsCommand implements EditorCommand<'TRIM_TIMELINE_ITEMS', { trims: { itemId: string; trim: TrimOptions }[] }> {
  readonly type = 'TRIM_TIMELINE_ITEMS' as const
  readonly payload: { trims: { itemId: string; trim: TrimOptions }[] }

  constructor(trims: { itemId: string; trim: TrimOptions }[]) {
    this.payload = { trims }
  }

  get trims() {
    return this.payload.trims
  }

  execute(state: ProjectState): ProjectState {
    return trimTimelineItems(state, this.payload.trims)
  }
}

export class RemoveTimelineItemsCommand implements EditorCommand<'REMOVE_TIMELINE_ITEMS', { itemIds: string[] }> {
  readonly type = 'REMOVE_TIMELINE_ITEMS' as const
  readonly payload: { itemIds: string[] }

  constructor(itemIds: string[]) {
    this.payload = { itemIds }
  }

  get itemIds(): string[] {
    return this.payload.itemIds
  }

  execute(state: ProjectState): ProjectState {
    return removeTimelineItems(state, this.payload.itemIds)
  }
}

export class SplitTimelineItemsCommand implements EditorCommand<'SPLIT_TIMELINE_ITEMS', { splits: { itemId: string; splitTime: number; leftItemId: string; rightItemId: string }[] }> {
  readonly type = 'SPLIT_TIMELINE_ITEMS' as const
  readonly payload: { splits: { itemId: string; splitTime: number; leftItemId: string; rightItemId: string }[] }

  constructor(splits: { itemId: string; splitTime: number; leftItemId: string; rightItemId: string }[]) {
    this.payload = { splits }
  }

  get splits() {
    return this.payload.splits
  }

  execute(state: ProjectState): ProjectState {
    return splitTimelineItems(state, this.payload.splits)
  }
}

export class UpdateTransformCommand
  implements
    EditorCommand<
      'UPDATE_TRANSFORM',
      { itemId: string; transform: Partial<Transform> }
    > {
  readonly type = 'UPDATE_TRANSFORM' as const
  readonly payload: { itemId: string; transform: Partial<Transform> }
  readonly mergeKey?: string

  constructor(itemId: string, transform: Partial<Transform>, mergeKey?: string) {
    this.payload = { itemId, transform }
    this.mergeKey = mergeKey
  }

  get itemId(): string {
    return this.payload.itemId
  }

  get transform(): Partial<Transform> {
    return this.payload.transform
  }

  execute(state: ProjectState): ProjectState {
    return updateItemTransform(state, this.payload.itemId, this.payload.transform)
  }
}

export class UpdateTransformAtPlayheadCommand implements EditorCommand<
  'UPDATE_TRANSFORM_AT_PLAYHEAD',
  { itemId: string; time: number; transform: Partial<Transform> }
> {
  readonly type = 'UPDATE_TRANSFORM_AT_PLAYHEAD' as const
  readonly payload: { itemId: string; time: number; transform: Partial<Transform> }
  readonly mergeKey?: string

  constructor(itemId: string, time: number, transform: Partial<Transform>, mergeKey?: string) {
    this.payload = { itemId, time, transform }
    this.mergeKey = mergeKey
  }

  execute(state: ProjectState): ProjectState {
    return updateItemTransformAtPlayhead(state, this.payload.itemId, this.payload.time, this.payload.transform)
  }
}

export class ResetTransformCommand
  implements EditorCommand<'RESET_TRANSFORM', { itemId: string }> {
  readonly type = 'RESET_TRANSFORM' as const
  readonly payload: { itemId: string }

  constructor(itemId: string) {
    this.payload = { itemId }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return resetItemTransform(state, this.payload.itemId)
  }
}

export class FitToCanvasCommand
  implements EditorCommand<'FIT_TO_CANVAS', { itemId: string }> {
  readonly type = 'FIT_TO_CANVAS' as const
  readonly payload: { itemId: string }

  constructor(itemId: string) {
    this.payload = { itemId }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return fitItemToCanvas(state, this.payload.itemId)
  }
}

export class FillCanvasCommand
  implements EditorCommand<'FILL_CANVAS', { itemId: string }> {
  readonly type = 'FILL_CANVAS' as const
  readonly payload: { itemId: string }

  constructor(itemId: string) {
    this.payload = { itemId }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return fillItemCanvas(state, this.payload.itemId)
  }
}

export class UpdateCropCommand
  implements
    EditorCommand<'UPDATE_CROP', { itemId: string; crop: Partial<Crop> }> {
  readonly type = 'UPDATE_CROP' as const
  readonly payload: { itemId: string; crop: Partial<Crop> }
  readonly mergeKey?: string

  constructor(itemId: string, crop: Partial<Crop>, mergeKey?: string) {
    this.payload = { itemId, crop }
    this.mergeKey = mergeKey
  }

  get itemId(): string {
    return this.payload.itemId
  }

  get crop(): Partial<Crop> {
    return this.payload.crop
  }

  execute(state: ProjectState): ProjectState {
    return updateItemCrop(state, this.payload.itemId, this.payload.crop)
  }
}

export class ResetCropCommand
  implements EditorCommand<'RESET_CROP', { itemId: string }> {
  readonly type = 'RESET_CROP' as const
  readonly payload: { itemId: string }

  constructor(itemId: string) {
    this.payload = { itemId }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return resetItemCrop(state, this.payload.itemId)
  }
}

export class UpdateAudioPropertiesCommand
  implements
    EditorCommand<
      'UPDATE_AUDIO_PROPERTIES',
      { itemId: string; audio: Partial<AudioProperties> }
    > {
  readonly type = 'UPDATE_AUDIO_PROPERTIES' as const
  readonly payload: { itemId: string; audio: Partial<AudioProperties> }
  readonly mergeKey?: string

  constructor(itemId: string, audio: Partial<AudioProperties>, mergeKey?: string) {
    this.payload = { itemId, audio }
    this.mergeKey = mergeKey
  }

  get itemId(): string {
    return this.payload.itemId
  }

  get audio(): Partial<AudioProperties> {
    return this.payload.audio
  }

  execute(state: ProjectState): ProjectState {
    return updateItemAudio(state, this.payload.itemId, this.payload.audio)
  }
}

export class ResetAudioPropertiesCommand
  implements EditorCommand<'RESET_AUDIO_PROPERTIES', { itemId: string }> {
  readonly type = 'RESET_AUDIO_PROPERTIES' as const
  readonly payload: { itemId: string }

  constructor(itemId: string) {
    this.payload = { itemId }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return resetItemAudio(state, this.payload.itemId)
  }
}

export class UpdateSpeedCommand
  implements
    EditorCommand<'UPDATE_SPEED', { itemId: string; speed: Partial<SpeedProperties> }> {
  readonly type = 'UPDATE_SPEED' as const
  readonly payload: { itemId: string; speed: Partial<SpeedProperties> }
  readonly mergeKey?: string

  constructor(itemId: string, speed: Partial<SpeedProperties>, mergeKey?: string) {
    this.payload = { itemId, speed }
    this.mergeKey = mergeKey
  }

  get itemId(): string {
    return this.payload.itemId
  }

  get speed(): Partial<SpeedProperties> {
    return this.payload.speed
  }

  execute(state: ProjectState): ProjectState {
    return updateItemSpeed(state, this.payload.itemId, this.payload.speed)
  }
}

export class ResetSpeedCommand
  implements EditorCommand<'RESET_SPEED', { itemId: string }> {
  readonly type = 'RESET_SPEED' as const
  readonly payload: { itemId: string }

  constructor(itemId: string) {
    this.payload = { itemId }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return resetItemSpeed(state, this.payload.itemId)
  }
}

export class ToggleKeyframeCommand
  implements
    EditorCommand<
      'TOGGLE_KEYFRAME',
      { itemId: string; key: string; enabled?: boolean }
    > {
  readonly type = 'TOGGLE_KEYFRAME' as const
  readonly payload: { itemId: string; key: string; enabled?: boolean }

  constructor(itemId: string, key: string, enabled?: boolean) {
    this.payload = { itemId, key, enabled }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  get key(): string {
    return this.payload.key
  }

  execute(state: ProjectState): ProjectState {
    return toggleItemKeyframe(
      state,
      this.payload.itemId,
      this.payload.key,
      this.payload.enabled
    )
  }
}

export class ToggleAllKeyframesCommand
  implements
    EditorCommand<
      'TOGGLE_ALL_KEYFRAMES',
      { itemId: string; keys: string[]; enabled: boolean }
    > {
  readonly type = 'TOGGLE_ALL_KEYFRAMES' as const
  readonly payload: { itemId: string; keys: string[]; enabled: boolean }

  constructor(itemId: string, keys: string[], enabled: boolean) {
    this.payload = { itemId, keys, enabled }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  get keys(): string[] {
    return this.payload.keys
  }

  execute(state: ProjectState): ProjectState {
    return toggleAllItemKeyframes(
      state,
      this.payload.itemId,
      this.payload.keys,
      this.payload.enabled
    )
  }
}

export class AddKeyframeCommand
  implements
    EditorCommand<
      'ADD_KEYFRAME',
      {
        itemId: string
        property: string
        time: number
        value: number
        interpolation?: KeyframeInterpolation
      }
    > {
  readonly type = 'ADD_KEYFRAME' as const
  readonly payload: {
    itemId: string
    property: string
    time: number
    value: number
    interpolation?: KeyframeInterpolation
  }
  readonly mergeKey?: string

  constructor(
    itemId: string,
    property: string,
    time: number,
    value: number,
    interpolation?: KeyframeInterpolation,
    mergeKey?: string
  ) {
    this.payload = { itemId, property, time, value, interpolation }
    this.mergeKey = mergeKey
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return addKeyframe(
      state,
      this.payload.itemId,
      this.payload.property,
      this.payload.time,
      this.payload.value,
      this.payload.interpolation
    )
  }
}

export class RemoveKeyframeCommand
  implements
    EditorCommand<
      'REMOVE_KEYFRAME',
      { itemId: string; property: string; keyframeIdOrTime: string | number }
    > {
  readonly type = 'REMOVE_KEYFRAME' as const
  readonly payload: { itemId: string; property: string; keyframeIdOrTime: string | number }

  constructor(itemId: string, property: string, keyframeIdOrTime: string | number) {
    this.payload = { itemId, property, keyframeIdOrTime }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return removeKeyframe(
      state,
      this.payload.itemId,
      this.payload.property,
      this.payload.keyframeIdOrTime
    )
  }
}

export class UpdateKeyframeCommand
  implements
    EditorCommand<
      'UPDATE_KEYFRAME',
      {
        itemId: string
        property: string
        keyframeId: string
        updates: Partial<Keyframe<number>>
      }
    > {
  readonly type = 'UPDATE_KEYFRAME' as const
  readonly payload: {
    itemId: string
    property: string
    keyframeId: string
    updates: Partial<Keyframe<number>>
  }
  readonly mergeKey?: string

  constructor(
    itemId: string,
    property: string,
    keyframeId: string,
    updates: Partial<Keyframe<number>>,
    mergeKey?: string
  ) {
    this.payload = { itemId, property, keyframeId, updates }
    this.mergeKey = mergeKey
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return updateKeyframe(
      state,
      this.payload.itemId,
      this.payload.property,
      this.payload.keyframeId,
      this.payload.updates
    )
  }
}

export class SetKeyframeValueCommand
  implements
    EditorCommand<
      'SET_KEYFRAME_VALUE',
      {
        itemId: string
        property: string
        time: number
        value: number
      }
    > {
  readonly type = 'SET_KEYFRAME_VALUE' as const
  readonly payload: {
    itemId: string
    property: string
    time: number
    value: number
  }
  readonly mergeKey?: string

  constructor(
    itemId: string,
    property: string,
    time: number,
    value: number,
    mergeKey?: string
  ) {
    this.payload = { itemId, property, time, value }
    this.mergeKey = mergeKey
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return setKeyframeValue(
      state,
      this.payload.itemId,
      this.payload.property,
      this.payload.time,
      this.payload.value
    )
  }
}

export class ToggleKeyframeAtPlayheadCommand
  implements
    EditorCommand<
      'TOGGLE_KEYFRAME_AT_PLAYHEAD',
      { itemId: string; property: string; playheadTime: number }
    > {
  readonly type = 'TOGGLE_KEYFRAME_AT_PLAYHEAD' as const
  readonly payload: { itemId: string; property: string; playheadTime: number }

  constructor(itemId: string, property: string, playheadTime: number) {
    this.payload = { itemId, property, playheadTime }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return toggleKeyframeAtPlayhead(
      state,
      this.payload.itemId,
      this.payload.property,
      this.payload.playheadTime
    )
  }
}

export class MoveKeyframeCommand
  implements
    EditorCommand<
      'MOVE_KEYFRAME',
      { itemId: string; property: string; keyframeId: string; newTime: number }
    > {
  readonly type = 'MOVE_KEYFRAME' as const
  readonly payload: { itemId: string; property: string; keyframeId: string; newTime: number }
  readonly mergeKey?: string

  constructor(
    itemId: string,
    property: string,
    keyframeId: string,
    newTime: number,
    mergeKey?: string
  ) {
    this.payload = { itemId, property, keyframeId, newTime }
    this.mergeKey = mergeKey
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return moveKeyframe(
      state,
      this.payload.itemId,
      this.payload.property,
      this.payload.keyframeId,
      this.payload.newTime
    )
  }
}

export class SetKeyframeInterpolationCommand
  implements
    EditorCommand<
      'SET_KEYFRAME_INTERPOLATION',
      {
        itemId: string
        property: string
        keyframeId: string
        interpolation: KeyframeInterpolation
      }
    > {
  readonly type = 'SET_KEYFRAME_INTERPOLATION' as const
  readonly payload: {
    itemId: string
    property: string
    keyframeId: string
    interpolation: KeyframeInterpolation
  }

  constructor(
    itemId: string,
    property: string,
    keyframeId: string,
    interpolation: KeyframeInterpolation
  ) {
    this.payload = { itemId, property, keyframeId, interpolation }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return setKeyframeInterpolation(
      state,
      this.payload.itemId,
      this.payload.property,
      this.payload.keyframeId,
      this.payload.interpolation
    )
  }
}

export class AddSolidLayerCommand
  implements EditorCommand<'ADD_SOLID_LAYER', { options: AddSolidLayerOptions }> {
  readonly type = 'ADD_SOLID_LAYER' as const
  readonly payload: { options: AddSolidLayerOptions }

  constructor(options: AddSolidLayerOptions) {
    this.payload = { options }
  }

  get options(): AddSolidLayerOptions {
    return this.payload.options
  }

  execute(state: ProjectState): ProjectState {
    return addSolidLayer(state, this.payload.options)
  }
}

export class AddAdjustmentLayerCommand
  implements EditorCommand<'ADD_ADJUSTMENT_LAYER', { options: AddAdjustmentLayerOptions }> {
  readonly type = 'ADD_ADJUSTMENT_LAYER' as const
  readonly payload: { options: AddAdjustmentLayerOptions }

  constructor(options: AddAdjustmentLayerOptions) {
    this.payload = { options }
  }

  get options(): AddAdjustmentLayerOptions {
    return this.payload.options
  }

  execute(state: ProjectState): ProjectState {
    return addAdjustmentLayer(state, this.payload.options)
  }
}

export class UpdateSolidLayerCommand
  implements EditorCommand<'UPDATE_SOLID_LAYER', { itemId: string; solid: Partial<SolidProperties> }> {
  readonly type = 'UPDATE_SOLID_LAYER' as const
  readonly payload: { itemId: string; solid: Partial<SolidProperties> }
  readonly mergeKey?: string

  constructor(itemId: string, solid: Partial<SolidProperties>, mergeKey?: string) {
    this.payload = { itemId, solid }
    this.mergeKey = mergeKey
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return updateSolidLayer(state, this.payload.itemId, this.payload.solid)
  }
}

export class AddTextLayerCommand
  implements EditorCommand<'ADD_TEXT_LAYER', { options: AddTextLayerOptions }> {
  readonly type = 'ADD_TEXT_LAYER' as const
  readonly payload: { options: AddTextLayerOptions }

  constructor(options: AddTextLayerOptions) {
    this.payload = { options }
  }

  get options(): AddTextLayerOptions {
    return this.payload.options
  }

  execute(state: ProjectState): ProjectState {
    return addTextLayer(state, this.payload.options)
  }
}

export class UpdateTextCommand
  implements EditorCommand<'UPDATE_TEXT', { itemId: string; properties: Partial<TextProperties> }> {
  readonly type = 'UPDATE_TEXT' as const
  readonly payload: { itemId: string; properties: Partial<TextProperties> }
  readonly mergeKey?: string

  constructor(itemId: string, properties: Partial<TextProperties>, mergeKey?: string) {
    this.payload = { itemId, properties }
    this.mergeKey = mergeKey
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return updateTextLayer(state, this.payload.itemId, this.payload.properties)
  }
}

export class AddCaptionCommand
  implements EditorCommand<'ADD_CAPTION', { options: AddCaptionOptions }> {
  readonly type = 'ADD_CAPTION' as const
  readonly payload: { options: AddCaptionOptions }

  constructor(options: AddCaptionOptions) {
    this.payload = { options }
  }

  get options(): AddCaptionOptions {
    return this.payload.options
  }

  execute(state: ProjectState): ProjectState {
    return addCaption(state, this.payload.options)
  }
}

export class UpdateCaptionCommand
  implements EditorCommand<'UPDATE_CAPTION', { itemId: string; caption: Partial<CaptionProperties> }> {
  readonly type = 'UPDATE_CAPTION' as const
  readonly payload: { itemId: string; caption: Partial<CaptionProperties> }
  readonly mergeKey?: string

  constructor(itemId: string, caption: Partial<CaptionProperties>, mergeKey?: string) {
    this.payload = { itemId, caption }
    this.mergeKey = mergeKey
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return updateCaption(state, this.payload.itemId, this.payload.caption)
  }
}

export class SplitCaptionCommand
  implements EditorCommand<'SPLIT_CAPTION', { itemId: string; splitTime: number; leftItemId?: string; rightItemId?: string }> {
  readonly type = 'SPLIT_CAPTION' as const
  readonly payload: { itemId: string; splitTime: number; leftItemId?: string; rightItemId?: string }

  constructor(itemId: string, splitTime: number, leftItemId?: string, rightItemId?: string) {
    this.payload = { itemId, splitTime, leftItemId, rightItemId }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return splitCaption(state, this.payload.itemId, this.payload.splitTime, this.payload.leftItemId, this.payload.rightItemId)
  }
}

export class MergeCaptionsCommand
  implements EditorCommand<'MERGE_CAPTIONS', { firstItemId: string; secondItemId: string }> {
  readonly type = 'MERGE_CAPTIONS' as const
  readonly payload: { firstItemId: string; secondItemId: string }

  constructor(firstItemId: string, secondItemId: string) {
    this.payload = { firstItemId, secondItemId }
  }

  execute(state: ProjectState): ProjectState {
    return mergeCaptions(state, this.payload.firstItemId, this.payload.secondItemId)
  }
}

export class ApplyCaptionPresetCommand
  implements EditorCommand<'APPLY_CAPTION_PRESET', { itemId: string; preset: string }> {
  readonly type = 'APPLY_CAPTION_PRESET' as const
  readonly payload: { itemId: string; preset: string }

  constructor(itemId: string, preset: string) {
    this.payload = { itemId, preset }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return applyCaptionPreset(state, this.payload.itemId, this.payload.preset)
  }
}

export class ImportSubtitlesCommand
  implements EditorCommand<'IMPORT_SUBTITLES', { cues: SubtitleCue[] | string; targetTrackId?: string; startTimeOffset?: number }> {
  readonly type = 'IMPORT_SUBTITLES' as const
  readonly payload: { cues: SubtitleCue[] | string; targetTrackId?: string; startTimeOffset?: number }

  constructor(cues: SubtitleCue[] | string, targetTrackId?: string, startTimeOffset?: number) {
    this.payload = { cues, targetTrackId, startTimeOffset }
  }

  execute(state: ProjectState): ProjectState {
    return importSubtitles(state, this.payload.cues, this.payload.targetTrackId, this.payload.startTimeOffset)
  }
}

export class SetBlendModeCommand
  implements EditorCommand<'SET_BLEND_MODE', { itemId: string; blendMode: BlendMode | string }> {
  readonly type = 'SET_BLEND_MODE' as const
  readonly payload: { itemId: string; blendMode: BlendMode | string }

  constructor(itemId: string, blendMode: BlendMode | string) {
    this.payload = { itemId, blendMode }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  execute(state: ProjectState): ProjectState {
    return setBlendMode(state, this.payload.itemId, this.payload.blendMode)
  }
}

export type AnyEditorCommand =
  | AddMediaAssetCommand
  | RemoveMediaAssetCommand
  | AddTrackCommand
  | RemoveTrackCommand
  | AddTimelineItemCommand
  | AddTimelineItemPairCommand
  | RemoveTimelineItemCommand
  | RemoveTimelineItemsCommand
  | UpdateTimelineItemCommand
  | MoveTimelineItemCommand
  | MoveTimelineItemsCommand
  | TrimTimelineItemCommand
  | TrimTimelineItemsCommand
  | SplitTimelineItemCommand
  | SplitTimelineItemsCommand
  | SetPlayheadCommand
  | SelectItemCommand
  | SelectItemsCommand
  | LinkTimelineItemsCommand
  | UnlinkTimelineItemsCommand
  | CleanupEmptyTracksCommand
  | UpdateTransformCommand
  | UpdateTransformAtPlayheadCommand
  | ResetTransformCommand
  | FitToCanvasCommand
  | FillCanvasCommand
  | UpdateCropCommand
  | ResetCropCommand
  | UpdateAudioPropertiesCommand
  | ResetAudioPropertiesCommand
  | UpdateSpeedCommand
  | ResetSpeedCommand
  | ToggleKeyframeCommand
  | ToggleAllKeyframesCommand
  | AddKeyframeCommand
  | RemoveKeyframeCommand
  | UpdateKeyframeCommand
  | SetKeyframeValueCommand
  | ToggleKeyframeAtPlayheadCommand
  | MoveKeyframeCommand
  | SetKeyframeInterpolationCommand
  | AddSolidLayerCommand
  | UpdateSolidLayerCommand
  | AddAdjustmentLayerCommand
  | AddTextLayerCommand
  | UpdateTextCommand
  | AddCaptionCommand
  | UpdateCaptionCommand
  | SplitCaptionCommand
  | MergeCaptionsCommand
  | ApplyCaptionPresetCommand
  | ApplyCaptionStyleCommand
  | ImportSubtitlesCommand
  | ImportAutoCaptionsCommand
  | SetBlendModeCommand
  | UpdateProjectSettingsCommand
  | ApplyEffectCommand
  | RemoveEffectCommand
  | ToggleEffectCommand
  | UpdateEffectParamCommand
  | ReorderEffectsCommand

export class UpdateProjectSettingsCommand
  implements EditorCommand<'UPDATE_PROJECT_SETTINGS', UpdateProjectSettingsOptions> {
  readonly type = 'UPDATE_PROJECT_SETTINGS' as const
  readonly payload: UpdateProjectSettingsOptions

  constructor(options: UpdateProjectSettingsOptions) {
    this.payload = options
  }

  get options(): UpdateProjectSettingsOptions {
    return this.payload
  }

  execute(state: ProjectState): ProjectState {
    return updateProjectSettings(state, this.payload)
  }
}

export class ApplyEffectCommand
  implements EditorCommand<'APPLY_EFFECT', { itemId: string; effect: ItemEffect }> {
  readonly type = 'APPLY_EFFECT' as const
  readonly payload: { itemId: string; effect: ItemEffect }

  constructor(itemId: string, effect: ItemEffect) {
    this.payload = { itemId, effect }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  get effect(): ItemEffect {
    return this.payload.effect
  }

  execute(state: ProjectState): ProjectState {
    return applyItemEffect(state, this.payload.itemId, this.payload.effect)
  }
}

export class RemoveEffectCommand
  implements EditorCommand<'REMOVE_EFFECT', { itemId: string; effectInstanceId: string }> {
  readonly type = 'REMOVE_EFFECT' as const
  readonly payload: { itemId: string; effectInstanceId: string }

  constructor(itemId: string, effectInstanceId: string) {
    this.payload = { itemId, effectInstanceId }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  get effectInstanceId(): string {
    return this.payload.effectInstanceId
  }

  execute(state: ProjectState): ProjectState {
    return removeItemEffect(state, this.payload.itemId, this.payload.effectInstanceId)
  }
}

export class ToggleEffectCommand
  implements EditorCommand<'TOGGLE_EFFECT', { itemId: string; effectInstanceId: string; enabled?: boolean }> {
  readonly type = 'TOGGLE_EFFECT' as const
  readonly payload: { itemId: string; effectInstanceId: string; enabled?: boolean }

  constructor(itemId: string, effectInstanceId: string, enabled?: boolean) {
    this.payload = { itemId, effectInstanceId, enabled }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  get effectInstanceId(): string {
    return this.payload.effectInstanceId
  }

  get enabled(): boolean | undefined {
    return this.payload.enabled
  }

  execute(state: ProjectState): ProjectState {
    return toggleItemEffect(state, this.payload.itemId, this.payload.effectInstanceId, this.payload.enabled)
  }
}

export class UpdateEffectParamCommand
  implements
    EditorCommand<
      'UPDATE_EFFECT_PARAM',
      { itemId: string; effectInstanceId: string; paramKey: string; value: number | string | boolean }
    > {
  readonly type = 'UPDATE_EFFECT_PARAM' as const
  readonly payload: { itemId: string; effectInstanceId: string; paramKey: string; value: number | string | boolean }
  readonly mergeKey?: string

  constructor(
    itemId: string,
    effectInstanceId: string,
    paramKey: string,
    value: number | string | boolean,
    mergeKey?: string
  ) {
    this.payload = { itemId, effectInstanceId, paramKey, value }
    this.mergeKey = mergeKey
  }

  get itemId(): string {
    return this.payload.itemId
  }

  get effectInstanceId(): string {
    return this.payload.effectInstanceId
  }

  get paramKey(): string {
    return this.payload.paramKey
  }

  get value(): number | string | boolean {
    return this.payload.value
  }

  execute(state: ProjectState): ProjectState {
    return updateItemEffectParam(
      state,
      this.payload.itemId,
      this.payload.effectInstanceId,
      this.payload.paramKey,
      this.payload.value
    )
  }
}

export class ReorderEffectsCommand
  implements EditorCommand<'REORDER_EFFECTS', { itemId: string; fromIndex: number; toIndex: number }> {
  readonly type = 'REORDER_EFFECTS' as const
  readonly payload: { itemId: string; fromIndex: number; toIndex: number }

  constructor(itemId: string, fromIndex: number, toIndex: number) {
    this.payload = { itemId, fromIndex, toIndex }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  get fromIndex(): number {
    return this.payload.fromIndex
  }

  get toIndex(): number {
    return this.payload.toIndex
  }

  execute(state: ProjectState): ProjectState {
    return reorderItemEffects(state, this.payload.itemId, this.payload.fromIndex, this.payload.toIndex)
  }
}

export class UpdateEffectTimingCommand
  implements
    EditorCommand<
      'UPDATE_EFFECT_TIMING',
      {
        itemId: string
        effectInstanceId: string
        timing: {
          rangeMode?: 'fullClip' | 'custom'
          startOffset?: number
          endOffset?: number
        }
      }
    > {
  readonly type = 'UPDATE_EFFECT_TIMING' as const
  readonly payload: {
    itemId: string
    effectInstanceId: string
    timing: {
      rangeMode?: 'fullClip' | 'custom'
      startOffset?: number
      endOffset?: number
    }
  }

  constructor(
    itemId: string,
    effectInstanceId: string,
    timing: {
      rangeMode?: 'fullClip' | 'custom'
      startOffset?: number
      endOffset?: number
    }
  ) {
    this.payload = { itemId, effectInstanceId, timing }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  get effectInstanceId(): string {
    return this.payload.effectInstanceId
  }

  get timing(): {
    rangeMode?: 'fullClip' | 'custom'
    startOffset?: number
    endOffset?: number
  } {
    return this.payload.timing
  }

  execute(state: ProjectState): ProjectState {
    return updateItemEffectTiming(
      state,
      this.payload.itemId,
      this.payload.effectInstanceId,
      this.payload.timing
    )
  }
}

export class ResetEffectParamsCommand
  implements
    EditorCommand<
      'RESET_EFFECT_PARAMS',
      {
        itemId: string
        effectInstanceId: string
        defaultParams?: Record<string, number | string | boolean>
      }
    > {
  readonly type = 'RESET_EFFECT_PARAMS' as const
  readonly payload: {
    itemId: string
    effectInstanceId: string
    defaultParams?: Record<string, number | string | boolean>
  }

  constructor(
    itemId: string,
    effectInstanceId: string,
    defaultParams?: Record<string, number | string | boolean>
  ) {
    this.payload = { itemId, effectInstanceId, defaultParams }
  }

  get itemId(): string {
    return this.payload.itemId
  }

  get effectInstanceId(): string {
    return this.payload.effectInstanceId
  }

  execute(state: ProjectState): ProjectState {
    return resetItemEffectParams(
      state,
      this.payload.itemId,
      this.payload.effectInstanceId,
      this.payload.defaultParams
    )
  }
}

export class AddTransitionCommand implements EditorCommand<'ADD_TRANSITION', { transition: TimelineTransition }> {
  readonly type = 'ADD_TRANSITION' as const
  readonly payload: { transition: TimelineTransition }

  constructor(transition: TimelineTransition) {
    this.payload = { transition }
  }

  get transition(): TimelineTransition {
    return this.payload.transition
  }

  execute(state: ProjectState): ProjectState {
    return addTimelineTransition(state, this.payload.transition)
  }
}

export class RemoveTransitionCommand implements EditorCommand<'REMOVE_TRANSITION', { transitionId: string }> {
  readonly type = 'REMOVE_TRANSITION' as const
  readonly payload: { transitionId: string }

  constructor(transitionId: string) {
    this.payload = { transitionId }
  }

  get transitionId(): string {
    return this.payload.transitionId
  }

  execute(state: ProjectState): ProjectState {
    return removeTimelineTransition(state, this.payload.transitionId)
  }
}

export class UpdateTransitionCommand
  implements EditorCommand<'UPDATE_TRANSITION', { transitionId: string; updates: Partial<TimelineTransition> }> {
  readonly type = 'UPDATE_TRANSITION' as const
  readonly payload: { transitionId: string; updates: Partial<TimelineTransition> }

  constructor(transitionId: string, updates: Partial<TimelineTransition>) {
    this.payload = { transitionId, updates }
  }

  get transitionId(): string {
    return this.payload.transitionId
  }

  get updates(): Partial<TimelineTransition> {
    return this.payload.updates
  }

  execute(state: ProjectState): ProjectState {
    return updateTimelineTransition(state, this.payload.transitionId, this.payload.updates)
  }
}

export class SelectTransitionCommand implements EditorCommand<'SELECT_TRANSITION', { transitionId: string | null }> {
  readonly type = 'SELECT_TRANSITION' as const
  readonly isUndoable = false
  readonly payload: { transitionId: string | null }

  constructor(transitionId: string | null) {
    this.payload = { transitionId }
  }

  get transitionId(): string | null {
    return this.payload.transitionId
  }

  execute(state: ProjectState): ProjectState {
    return selectTimelineTransition(state, this.payload.transitionId)
  }
}

