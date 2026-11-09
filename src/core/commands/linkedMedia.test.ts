import { describe, it, expect } from 'vitest'
import { createEmptyProjectState } from '../project/projectState'
import {
  selectItems,
  addTimelineItem,
} from './projectCommands'
import {
  LinkTimelineItemsCommand,
  UnlinkTimelineItemsCommand,
  MoveTimelineItemsCommand,
  TrimTimelineItemsCommand,
  SplitTimelineItemsCommand,
  RemoveTrackCommand,
} from './editorCommand'
import { DEFAULT_TRANSFORM } from '../timeline/types'

describe('Linked Media & Multi-Selection Commands', () => {
  it('selects multiple items and links them together', () => {
    let state = createEmptyProjectState()
    state = addTimelineItem(state, {
      id: 'clip-v1',
      trackId: 'track-v1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { ...DEFAULT_TRANSFORM },
      streamType: 'video',
    })
    state = addTimelineItem(state, {
      id: 'clip-a1',
      trackId: 'track-a1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { ...DEFAULT_TRANSFORM },
      streamType: 'audio',
    })

    // Multi-selection
    state = selectItems(state, ['clip-v1', 'clip-a1'])
    expect(state.selectedItemId).toBe('clip-v1')
    expect(state.selectedItemIds).toEqual(['clip-v1', 'clip-a1'])

    // Link items
    state = new LinkTimelineItemsCommand(['clip-v1', 'clip-a1']).execute(state)
    expect(state.items['clip-v1'].linkedItemId).toBe('clip-a1')
    expect(state.items['clip-a1'].linkedItemId).toBe('clip-v1')

    // Unlink items
    state = new UnlinkTimelineItemsCommand(['clip-v1']).execute(state)
    expect(state.items['clip-v1'].linkedItemId).toBeUndefined()
    expect(state.items['clip-a1'].linkedItemId).toBeUndefined()
  })

  it('moves linked/multiple items atomically', () => {
    let state = createEmptyProjectState()
    state = addTimelineItem(state, {
      id: 'clip-v1',
      trackId: 'track-v1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { ...DEFAULT_TRANSFORM },
      streamType: 'video',
    })
    state = addTimelineItem(state, {
      id: 'clip-a1',
      trackId: 'track-a1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { ...DEFAULT_TRANSFORM },
      streamType: 'audio',
    })

    state = new MoveTimelineItemsCommand([
      { itemId: 'clip-v1', newStartTime: 5 },
      { itemId: 'clip-a1', newStartTime: 5 },
    ]).execute(state)

    expect(state.items['clip-v1'].startTime).toBe(5)
    expect(state.items['clip-a1'].startTime).toBe(5)
  })

  it('trims and splits multiple/linked items atomically', () => {
    let state = createEmptyProjectState()
    state = addTimelineItem(state, {
      id: 'clip-v1',
      trackId: 'track-v1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { ...DEFAULT_TRANSFORM },
      streamType: 'video',
      linkedItemId: 'clip-a1',
    })
    state = addTimelineItem(state, {
      id: 'clip-a1',
      trackId: 'track-a1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { ...DEFAULT_TRANSFORM },
      streamType: 'audio',
      linkedItemId: 'clip-v1',
    })

    // Trim both right edges to 8
    state = new TrimTimelineItemsCommand([
      { itemId: 'clip-v1', trim: { edge: 'right', newTime: 8 } },
      { itemId: 'clip-a1', trim: { edge: 'right', newTime: 8 } },
    ]).execute(state)

    expect(state.items['clip-v1'].duration).toBe(8)
    expect(state.items['clip-a1'].duration).toBe(8)

    // Split both at playhead time 4
    state = new SplitTimelineItemsCommand([
      { itemId: 'clip-v1', splitTime: 4, leftItemId: 'clip-v1-left', rightItemId: 'clip-v1-right' },
      { itemId: 'clip-a1', splitTime: 4, leftItemId: 'clip-a1-left', rightItemId: 'clip-a1-right' },
    ]).execute(state)

    expect(state.items['clip-v1-left']).toBeDefined()
    expect(state.items['clip-v1-right']).toBeDefined()
    expect(state.items['clip-a1-left']).toBeDefined()
    expect(state.items['clip-a1-right']).toBeDefined()

    // Left halves should be linked to each other; right halves should be linked to each other
    expect(state.items['clip-v1-left'].linkedItemId).toBe('clip-a1-left')
    expect(state.items['clip-a1-left'].linkedItemId).toBe('clip-v1-left')
    expect(state.items['clip-v1-right'].linkedItemId).toBe('clip-a1-right')
    expect(state.items['clip-a1-right'].linkedItemId).toBe('clip-v1-right')
  })

  it('moves linked items across layers and creates corresponding second layers', () => {
    let state = createEmptyProjectState()
    state = addTimelineItem(state, {
      id: 'clip-v1',
      trackId: 'track-v1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { ...DEFAULT_TRANSFORM },
      streamType: 'video',
      linkedItemId: 'clip-a1',
    })
    state = addTimelineItem(state, {
      id: 'clip-a1',
      trackId: 'track-a1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { ...DEFAULT_TRANSFORM },
      streamType: 'audio',
      linkedItemId: 'clip-v1',
    })

    // Move to Layer 2: NEW_VIDEO_TRACK and NEW_AUDIO_TRACK
    state = new MoveTimelineItemsCommand([
      { itemId: 'clip-v1', newStartTime: 2, newTrackId: 'NEW_VIDEO_TRACK' },
      { itemId: 'clip-a1', newStartTime: 2, newTrackId: 'NEW_AUDIO_TRACK' },
    ]).execute(state)

    const v2Track = state.tracks.find((t) => t.type === 'video' && t.name === 'Video 2')
    const a2Track = state.tracks.find((t) => t.type === 'audio' && t.name === 'Audio 2')

    expect(v2Track).toBeDefined()
    expect(a2Track).toBeDefined()
    expect(state.items['clip-v1'].trackId).toBe(v2Track!.id)
    expect(state.items['clip-a1'].trackId).toBe(a2Track!.id)
    expect(state.items['clip-v1'].startTime).toBe(2)
    expect(state.items['clip-a1'].startTime).toBe(2)
    expect(state.items['clip-v1'].linkedItemId).toBe('clip-a1')
    expect(state.items['clip-a1'].linkedItemId).toBe('clip-v1')

    // Move back down from Layer 2 to Layer 1
    state = new MoveTimelineItemsCommand([
      { itemId: 'clip-v1', newStartTime: 0, newTrackId: 'track-v1' },
      { itemId: 'clip-a1', newStartTime: 0, newTrackId: 'track-a1' },
    ]).execute(state)

    expect(state.items['clip-v1'].trackId).toBe('track-v1')
    expect(state.items['clip-a1'].trackId).toBe('track-a1')
    expect(state.items['clip-v1'].startTime).toBe(0)
    expect(state.items['clip-a1'].startTime).toBe(0)
  })

  it('allows deleting any layer down to 0 tracks', () => {
    let state = createEmptyProjectState({
      initialTracks: [
        { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
      ],
    })
    expect(state.tracks.filter((t) => t.type === 'video').length).toBe(1)
    expect(state.tracks.filter((t) => t.type === 'audio').length).toBe(1)

    // Delete video track (track-v1)
    const stateAfterV1 = new RemoveTrackCommand('track-v1').execute(state)
    expect(stateAfterV1.tracks.some((t) => t.id === 'track-v1')).toBe(false)
    expect(stateAfterV1.tracks.length).toBe(1)

    // Delete audio track (track-a1)
    const stateAfterA1 = new RemoveTrackCommand('track-a1').execute(stateAfterV1)
    expect(stateAfterA1.tracks.some((t) => t.id === 'track-a1')).toBe(false)
    expect(stateAfterA1.tracks.length).toBe(0)
  })

  it('deleting a secondary layer removes its clips and unlinks surviving partner clips', () => {
    let state = createEmptyProjectState()

    state = addTimelineItem(state, {
      id: 'clip-v2',
      trackId: 'track-v1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 5,
      sourceIn: 0,
      sourceOut: 5,
      transform: { ...DEFAULT_TRANSFORM },
      streamType: 'video',
      linkedItemId: 'clip-a1',
    })

    // Move clip-v2 to NEW_VIDEO_TRACK, creating Video 2
    state = new MoveTimelineItemsCommand([
      {
        itemId: 'clip-v2',
        newStartTime: 0,
        newTrackId: 'NEW_VIDEO_TRACK',
      },
    ]).execute(state)

    // Link clip-a1 on Audio 1 to clip-v2 on Video 2
    state = addTimelineItem(state, {
      id: 'clip-a1',
      trackId: 'track-a1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 5,
      sourceIn: 0,
      sourceOut: 5,
      transform: { ...DEFAULT_TRANSFORM },
      streamType: 'audio',
      linkedItemId: 'clip-v2',
    })

    const v2Track = state.tracks.find((t) => t.name === 'Video 2')!
    expect(v2Track).toBeDefined()
    expect(state.items['clip-v2'].trackId).toBe(v2Track.id)
    expect(state.items['clip-a1'].linkedItemId).toBe('clip-v2')

    // Delete Video 2 layer
    state = new RemoveTrackCommand(v2Track.id).execute(state)

    expect(state.tracks.some((t) => t.id === v2Track.id)).toBe(false)
    expect(state.items['clip-v2']).toBeUndefined()
    expect(state.items['clip-a1']).toBeDefined()
    // Surviving partner clip should have linkedItemId cleaned up!
    expect(state.items['clip-a1'].linkedItemId).toBeUndefined()
  })
})
