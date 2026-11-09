import { describe, it, expect } from 'vitest'
import { createEmptyProjectState } from '../project/projectState'
import {
  AddTransitionCommand,
  RemoveTransitionCommand,
  UpdateTransitionCommand,
  SelectTransitionCommand,
  ApplyEffectCommand,
  SplitTimelineItemCommand,
  RemoveTimelineItemCommand,
  SelectItemCommand,
  MoveTimelineItemCommand,
  TrimTimelineItemCommand,
  UpdateSpeedCommand,
} from '../commands/editorCommand'
import { CommandHistory } from '../commands/commandHistory'
import { serializeProject, deserializeProject } from '../persistence/projectSerializer'
import { getPlaybackFrameInfo } from '../playback/timelinePlayback'
import { getLinkedItemIdsForState, splitTimelineItems, selectItem, computeTransitionTrim } from '../commands/projectCommands'
import type { TimelineTransition, ItemEffect, TimelineItem, Track } from './types'
import { evaluateItemEffects } from './effectEvaluation'

function createSampleClips(): { state: ReturnType<typeof createEmptyProjectState>; clipA: TimelineItem; clipB: TimelineItem } {
  let state = createEmptyProjectState()
  const vTrack: Track = { id: 'track-v1', name: 'Video 1', type: 'video' }
  const aTrack: Track = { id: 'track-a1', name: 'Audio 1', type: 'audio' }
  state = { ...state, tracks: [vTrack, aTrack] }

  const clipA: TimelineItem = {
    id: 'clip-a',
    trackId: 'track-v1',
    assetId: 'asset-1',
    startTime: 0,
    duration: 4,
    sourceIn: 0,
    sourceOut: 4,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    effects: [],
  }

  const clipB: TimelineItem = {
    id: 'clip-b',
    trackId: 'track-v1',
    assetId: 'asset-2',
    startTime: 4,
    duration: 4,
    sourceIn: 0,
    sourceOut: 4,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    effects: [],
  }

  state = {
    ...state,
    items: {
      'clip-a': clipA,
      'clip-b': clipB,
    },
  }

  return { state, clipA, clipB }
}

describe('Transitions On Clip System', () => {
  it('adds, updates, selects, and removes transitions via editor commands with undo/redo', () => {
    const { state: initState } = createSampleClips()
    const history = new CommandHistory(initState)

    const tr: TimelineTransition = {
      id: 'tr-1',
      transitionId: 'tr-crash-zoom',
      name: 'Crash Zoom',
      trackId: 'track-v1',
      startTime: 3.5,
      duration: 1.0,
      leftClipId: 'clip-a',
      rightClipId: 'clip-b',
    }

    // 1. Add transition
    const addCmd = new AddTransitionCommand(tr)
    let state = history.execute(addCmd)
    expect(state.transitions?.['tr-1']).toBeDefined()
    expect(state.transitions?.['tr-1']?.name).toBe('Crash Zoom')
    expect(state.selectedTransitionId).toBe('tr-1')

    // 2. Select transition
    const selCmd = new SelectTransitionCommand(null)
    state = history.execute(selCmd)
    expect(state.selectedTransitionId).toBeNull()

    const selBackCmd = new SelectTransitionCommand('tr-1')
    state = history.execute(selBackCmd)
    expect(state.selectedTransitionId).toBe('tr-1')

    // 3. Update transition duration (for two-clip transition, cutPoint is 4, newDur=1.6 => start=4-0.8=3.2)
    const updateCmd = new UpdateTransitionCommand('tr-1', {
      duration: 1.6,
    })
    state = history.execute(updateCmd)
    expect(state.transitions?.['tr-1']?.startTime).toBe(3.2)
    expect(state.transitions?.['tr-1']?.duration).toBe(1.6)

    // 4. Undo update
    state = history.undo()!
    expect(state.transitions?.['tr-1']?.startTime).toBe(3.5)
    expect(state.transitions?.['tr-1']?.duration).toBe(1.0)

    // 5. Redo update
    state = history.redo()!
    expect(state.transitions?.['tr-1']?.startTime).toBe(3.2)
    expect(state.transitions?.['tr-1']?.duration).toBe(1.6)

    // 6. Remove transition
    const removeCmd = new RemoveTransitionCommand('tr-1')
    state = history.execute(removeCmd)
    expect(state.transitions?.['tr-1']).toBeUndefined()
    expect(state.selectedTransitionId).toBeNull()

    // 7. Undo remove
    state = history.undo()!
    expect(state.transitions?.['tr-1']).toBeDefined()
    expect(state.transitions?.['tr-1']?.duration).toBe(1.6)
  })

  it('rejects adding transitions on audio tracks or empty timeline space', () => {
    const { state } = createSampleClips()

    // Transition on audio track
    const audioTr: TimelineTransition = {
      id: 'tr-audio',
      transitionId: 'tr-dissolve',
      name: 'Dissolve',
      trackId: 'track-a1',
      startTime: 2,
      duration: 1,
    }
    const stateAudio = new AddTransitionCommand(audioTr).execute(state)
    expect(stateAudio.transitions?.['tr-audio']).toBeUndefined()

    // Transition on empty space (time 20-22 on video track where no clip exists)
    const emptyTr: TimelineTransition = {
      id: 'tr-empty',
      transitionId: 'tr-dissolve',
      name: 'Dissolve',
      trackId: 'track-v1',
      startTime: 20,
      duration: 1,
    }
    const stateEmpty = new AddTransitionCommand(emptyTr).execute(state)
    expect(stateEmpty.transitions?.['tr-empty']).toBeUndefined()
  })

  it('keeps two-clip transitions anchored to cut point, rejecting moves away from edit cut', () => {
    const { state } = createSampleClips()
    const tr: TimelineTransition = {
      id: 'tr-cut',
      transitionId: 'tr-crash-zoom',
      name: 'Crash Zoom',
      trackId: 'track-v1',
      startTime: 3.5,
      duration: 1.0,
      leftClipId: 'clip-a',
      rightClipId: 'clip-b',
    }

    let next = new AddTransitionCommand(tr).execute(state)
    // Cut point between clip-a (0->4) and clip-b (4->8) is 4.0
    expect(next.transitions?.['tr-cut']?.startTime).toBe(3.5)

    // Attempting to move start time to 0.5 (start of clip-a) must be rejected / kept anchored at cut point
    next = new UpdateTransitionCommand('tr-cut', { startTime: 0.5 }).execute(next)
    expect(next.transitions?.['tr-cut']?.startTime).toBe(3.5)
  })

  it('anchors single-clip transitions strictly to start (In) or end (Out) of parent clip (max 2)', () => {
    const { state } = createSampleClips()
    // Place in-transition on clip-a (startTime: 0, duration: 4)
    const inTr: TimelineTransition = {
      id: 'tr-in',
      transitionId: 'tr-dissolve',
      name: 'Dissolve',
      trackId: 'track-v1',
      startTime: 0.5, // Placed near start -> snaps to clipStart (0.0)
      duration: 1.0,
      leftClipId: 'clip-a',
    }

    let next = new AddTransitionCommand(inTr).execute(state)
    expect(next.transitions?.['tr-in']?.startTime).toBe(0.0)
    expect(next.transitions?.['tr-in']?.duration).toBe(1.0)

    // Updating duration of in-transition keeps it anchored at start of clip (0.0)
    next = new UpdateTransitionCommand('tr-in', { duration: 1.5 }).execute(next)
    expect(next.transitions?.['tr-in']?.startTime).toBe(0.0)
    expect(next.transitions?.['tr-in']?.duration).toBe(1.5)

    // Place out-transition on clip-a near end (3.0s) -> snaps to clipEnd - duration = 4.0 - 1.0 = 3.0
    const outTr: TimelineTransition = {
      id: 'tr-out',
      transitionId: 'tr-wipe',
      name: 'Linear Wipe',
      trackId: 'track-v1',
      startTime: 3.5,
      duration: 1.0,
      leftClipId: 'clip-a',
    }
    next = new AddTransitionCommand(outTr).execute(next)
    expect(next.transitions?.['tr-out']?.startTime).toBe(3.0)
    expect(next.transitions?.['tr-out']?.duration).toBe(1.0)

    // Updating duration of out-transition expands backward from end of clip (4.0 - 2.0 = 2.0)
    next = new UpdateTransitionCommand('tr-out', { duration: 2.0 }).execute(next)
    expect(next.transitions?.['tr-out']?.startTime).toBe(2.0)
    expect(next.transitions?.['tr-out']?.duration).toBe(2.0)

    // Adding another in-transition replaces the previous in-transition (max 2 rule)
    const newInTr: TimelineTransition = {
      id: 'tr-in-2',
      transitionId: 'tr-zoom',
      name: 'Zoom In',
      trackId: 'track-v1',
      startTime: 0.0,
      duration: 0.8,
      leftClipId: 'clip-a',
    }
    next = new AddTransitionCommand(newInTr).execute(next)
    expect(next.transitions?.['tr-in']).toBeUndefined() // Replaced!
    expect(next.transitions?.['tr-in-2']?.startTime).toBe(0.0)
    expect(next.transitions?.['tr-out']).toBeDefined() // Out transition retained
  })

  it('automatically selects linked audio clip when video clip is selected', () => {
    let state = createEmptyProjectState()
    const videoClip: TimelineItem = {
      id: 'v-clip',
      trackId: 'track-v1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      linkedItemId: 'a-clip',
    }
    const audioClip: TimelineItem = {
      id: 'a-clip',
      trackId: 'track-a1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      linkedItemId: 'v-clip',
    }

    state = {
      ...state,
      items: {
        'v-clip': videoClip,
        'a-clip': audioClip,
      },
    }

    // Selecting video clip automatically gathers its linked audio partner
    const linkedIds = getLinkedItemIdsForState(state, 'v-clip')
    expect(linkedIds).toContain('v-clip')
    expect(linkedIds).toContain('a-clip')

    const selectedState = selectItem(state, 'v-clip')
    expect(selectedState.selectedItemId).toBe('v-clip')
    expect(selectedState.selectedItemIds).toEqual(expect.arrayContaining(['v-clip', 'a-clip']))
  })

  it('splits linked video and audio together, keeping both left and right halves linked and selected', () => {
    let state = createEmptyProjectState()
    const videoClip: TimelineItem = {
      id: 'v1',
      trackId: 'track-v1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      linkedItemId: 'a1',
    }
    const audioClip: TimelineItem = {
      id: 'a1',
      trackId: 'track-a1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      linkedItemId: 'v1',
    }

    state = {
      ...state,
      items: { v1: videoClip, a1: audioClip },
      selectedItemId: 'v1',
      selectedItemIds: ['v1', 'a1'],
    }

    const splits = [
      { itemId: 'v1', splitTime: 4, leftItemId: 'v1-L', rightItemId: 'v1-R' },
      { itemId: 'a1', splitTime: 4, leftItemId: 'a1-L', rightItemId: 'a1-R' },
    ]

    const nextState = splitTimelineItems(state, splits)

    // Left halves created and linked
    expect(nextState.items['v1-L']).toBeDefined()
    expect(nextState.items['a1-L']).toBeDefined()
    expect(nextState.items['v1-L'].linkedItemId).toBe('a1-L')
    expect(nextState.items['a1-L'].linkedItemId).toBe('v1-L')

    // Right halves created and linked
    expect(nextState.items['v1-R']).toBeDefined()
    expect(nextState.items['a1-R']).toBeDefined()
    expect(nextState.items['v1-R'].linkedItemId).toBe('a1-R')
    expect(nextState.items['a1-R'].linkedItemId).toBe('v1-R')

    // Left halves are both selected
    expect(nextState.selectedItemIds).toContain('v1-L')
    expect(nextState.selectedItemIds).toContain('a1-L')
  })

  it('persists transitions across project serialization and deserialization', () => {
    let state = createEmptyProjectState()
    const tr: TimelineTransition = {
      id: 'tr-zoom',
      transitionId: 'tr-crash-zoom',
      name: 'Crash Zoom',
      trackId: 'track-v1',
      startTime: 5.0,
      duration: 0.8,
    }

    state = {
      ...state,
      transitions: {
        'tr-zoom': tr,
      },
      selectedTransitionId: 'tr-zoom',
    }

    const serialized = serializeProject(state)
    const deserialized = deserializeProject(serialized)

    expect(deserialized.state.transitions).toBeDefined()
    expect(deserialized.state.transitions?.['tr-zoom']).toBeDefined()
    expect(deserialized.state.transitions?.['tr-zoom']?.name).toBe('Crash Zoom')
    expect(deserialized.state.transitions?.['tr-zoom']?.duration).toBe(0.8)
    expect(deserialized.state.selectedTransitionId).toBeNull()
  })

  it('computes active transitions and progress in getPlaybackFrameInfo', () => {
    let state = createEmptyProjectState()
    const tr: TimelineTransition = {
      id: 'tr-zoom',
      transitionId: 'tr-crash-zoom',
      name: 'Crash Zoom',
      trackId: 'track-v1',
      startTime: 4.0,
      duration: 2.0,
    }

    state = {
      ...state,
      transitions: {
        'tr-zoom': tr,
      },
    }

    const beforeFrame = getPlaybackFrameInfo(state, 3.5)
    expect(beforeFrame.activeTransitions?.length).toBe(0)

    const startFrame = getPlaybackFrameInfo(state, 4.0)
    expect(startFrame.activeTransitions?.length).toBe(1)
    expect(startFrame.activeTransitions?.[0].progress).toBe(0)

    const midFrame = getPlaybackFrameInfo(state, 5.0)
    expect(midFrame.activeTransitions?.length).toBe(1)
    expect(midFrame.activeTransitions?.[0].progress).toBe(0.5)

    const endFrame = getPlaybackFrameInfo(state, 6.0)
    expect(endFrame.activeTransitions?.length).toBe(1)
    expect(endFrame.activeTransitions?.[0].progress).toBe(1.0)

    const afterFrame = getPlaybackFrameInfo(state, 6.5)
    expect(afterFrame.activeTransitions?.length).toBe(0)
  })

  it('keeps effects in item.effects without creating timeline layer lanes', () => {
    let state = createEmptyProjectState()
    const testClip: TimelineItem = {
      id: 'clip-1',
      trackId: 'track-v1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      effects: [],
    }
    state = {
      ...state,
      items: {
        'clip-1': testClip,
      },
    }

    const effect: ItemEffect = {
      id: 'fx-blur',
      effectId: 'fx-gaussian-blur',
      name: 'Gaussian Blur',
      category: 'stylize',
      enabled: true,
      params: { radius: 10 },
      rangeMode: 'fullClip',
      startOffset: 0,
      endOffset: 10,
    }

    const cmd = new ApplyEffectCommand('clip-1', effect)
    state = cmd.execute(state)

    expect(state.items['clip-1'].effects?.length).toBe(1)
    expect(state.items['clip-1'].effects?.[0].name).toBe('Gaussian Blur')
    expect(Object.keys(state.items).length).toBe(1)
  })

  it('SplitTimelineItemCommand automatically splits linked audio partner when video is split', () => {
    let state = createEmptyProjectState()
    const vTrack: Track = { id: 'track-v1', name: 'Video 1', type: 'video' }
    const aTrack: Track = { id: 'track-a1', name: 'Audio 1', type: 'audio' }
    state = { ...state, tracks: [vTrack, aTrack] }

    const videoItem: TimelineItem = {
      id: 'v-clip',
      trackId: 'track-v1',
      assetId: 'asset-video',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      streamType: 'video',
      linkedItemId: 'a-clip',
    }

    const audioItem: TimelineItem = {
      id: 'a-clip',
      trackId: 'track-a1',
      assetId: 'asset-video',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      streamType: 'audio',
      linkedItemId: 'v-clip',
    }

    state = {
      ...state,
      items: {
        'v-clip': videoItem,
        'a-clip': audioItem,
      },
    }

    // Split video clip at 4.0 seconds using single-item SplitTimelineItemCommand
    const cmd = new SplitTimelineItemCommand('v-clip', 4.0, 'v-left', 'v-right')
    const nextState = cmd.execute(state)

    // Verify video was split
    expect(nextState.items['v-clip']).toBeUndefined()
    expect(nextState.items['v-left']).toBeDefined()
    expect(nextState.items['v-right']).toBeDefined()
    expect(nextState.items['v-left'].duration).toBe(4.0)
    expect(nextState.items['v-right'].duration).toBe(6.0)

    // Verify audio was ALSO automatically split in lockstep
    expect(nextState.items['a-clip']).toBeUndefined()
    const audioLeft = Object.values(nextState.items).find((it) => it.trackId === 'track-a1' && it.startTime === 0)
    const audioRight = Object.values(nextState.items).find((it) => it.trackId === 'track-a1' && it.startTime === 4.0)
    expect(audioLeft).toBeDefined()
    expect(audioRight).toBeDefined()
    expect(audioLeft?.duration).toBe(4.0)
    expect(audioRight?.duration).toBe(6.0)

    // Verify left is linked to left, right is linked to right
    expect(nextState.items['v-left'].linkedItemId).toBe(audioLeft?.id)
    expect(audioLeft?.linkedItemId).toBe('v-left')
    expect(nextState.items['v-right'].linkedItemId).toBe(audioRight?.id)
    expect(audioRight?.linkedItemId).toBe('v-right')

    // Both left clips are selected together
    expect(nextState.selectedItemIds).toContain('v-left')
    expect(nextState.selectedItemIds).toContain(audioLeft?.id)
  })

  it('rejects adding transitions on audio clips or audio tracks', () => {
    let state = createEmptyProjectState()
    const aTrack: Track = { id: 'track-a1', name: 'Audio 1', type: 'audio' }
    state = { ...state, tracks: [aTrack] }

    const audioItem: TimelineItem = {
      id: 'a-clip',
      trackId: 'track-a1',
      assetId: 'asset-audio',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      streamType: 'audio',
    }
    state = { ...state, items: { 'a-clip': audioItem } }

    const tr: TimelineTransition = {
      id: 'tr-test',
      transitionId: 'tr-dissolve',
      name: 'Dissolve',
      trackId: 'track-a1',
      startTime: 2,
      duration: 1,
      leftClipId: 'a-clip',
    }

    const nextState = new AddTransitionCommand(tr).execute(state)
    expect(nextState.transitions?.['tr-test']).toBeUndefined()
  })

  it('keeps both outgoing and incoming clips active simultaneously during a two-clip transition', () => {
    const { state: sampleState, clipA, clipB } = createSampleClips()
    // clipA is 0-4s on track-v1, clipB is 4-8s on track-v1 (cut point at 4.0s)
    const stateWithAssets = {
      ...sampleState,
      assets: {
        'asset-1': { id: 'asset-1', name: 'Video 1', type: 'video' as const, path: '/video1.mp4', duration: 10 },
        'asset-2': { id: 'asset-2', name: 'Video 2', type: 'video' as const, path: '/video2.mp4', duration: 10 },
      },
    }

    const tr: TimelineTransition = {
      id: 'tr-two-clips',
      transitionId: 'tr-dissolve',
      name: 'Cross Dissolve',
      trackId: 'track-v1',
      startTime: 3.5,
      duration: 1.0,
      leftClipId: clipA.id,
      rightClipId: clipB.id,
    }

    const stateWithTransition = new AddTransitionCommand(tr).execute(stateWithAssets)
    expect(stateWithTransition.transitions?.['tr-two-clips']).toBeDefined()

    // At playhead 3.8s (mid-transition, before cut point):
    // Both clipA (outgoing) and clipB (incoming) must be present in activeVideos!
    const frameAt38 = getPlaybackFrameInfo(stateWithTransition, 3.8)
    expect(frameAt38.activeVideos.length).toBe(2)
    expect(frameAt38.activeVideos[0].item.id).toBe(clipA.id)
    expect(frameAt38.activeVideos[1].item.id).toBe(clipB.id)

    // At playhead 4.2s (mid-transition, after cut point):
    // Both clipA and clipB must STILL be present in activeVideos!
    const frameAt42 = getPlaybackFrameInfo(stateWithTransition, 4.2)
    expect(frameAt42.activeVideos.length).toBe(2)
    expect(frameAt42.activeVideos[0].item.id).toBe(clipA.id)
    expect(frameAt42.activeVideos[1].item.id).toBe(clipB.id)

    // Outside transition at 2.0s: only clipA is active
    const frameAt20 = getPlaybackFrameInfo(stateWithTransition, 2.0)
    expect(frameAt20.activeVideos.length).toBe(1)
    expect(frameAt20.activeVideos[0].item.id).toBe(clipA.id)

    // Outside transition at 6.0s: only clipB is active
    const frameAt60 = getPlaybackFrameInfo(stateWithTransition, 6.0)
    expect(frameAt60.activeVideos.length).toBe(1)
    expect(frameAt60.activeVideos[0].item.id).toBe(clipB.id)
  })

  it('evaluates chroma-key effect with keyColor, tolerance, and smoothness', () => {
    const item: TimelineItem = {
      id: 'clip-green',
      trackId: 'track-v1',
      assetId: 'asset-video',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      effects: [
        {
          id: 'fx-chroma',
          effectId: 'chroma-key',
          name: 'Chroma Key',
          category: 'keying',
          enabled: true,
          params: {
            keyColor: '#00ff00',
            tolerance: 40,
            smoothness: 15,
          },
        },
      ],
    }

    const fx = evaluateItemEffects(item, 2.0, 1)
    expect(fx.chromaKey).toBeDefined()
    expect(fx.chromaKey?.keyColor).toBe('#00ff00')
    expect(fx.chromaKey?.tolerance).toBe(40)
    expect(fx.chromaKey?.smoothness).toBe(15)
  })

  it('automatically removes transition when either attached clip is removed', () => {
    const { state, clipA, clipB } = createSampleClips()
    const tr: TimelineTransition = {
      id: 'tr-shared',
      transitionId: 'tr-wipe',
      name: 'Linear Wipe',
      trackId: 'track-v1',
      startTime: 3.5,
      duration: 1.0,
      leftClipId: clipA.id,
      rightClipId: clipB.id,
    }

    let next = new AddTransitionCommand(tr).execute(state)
    expect(next.transitions?.['tr-shared']).toBeDefined()
    expect(next.selectedTransitionId).toBe('tr-shared')

    // Remove clipA: transition should be automatically cleaned up because it was between two clips
    next = new RemoveTimelineItemCommand(clipA.id).execute(next)
    expect(next.transitions?.['tr-shared']).toBeUndefined()
    expect(next.selectedTransitionId).toBeNull()
  })

  it('clears transition selection when a clip is selected', () => {
    const { state, clipA } = createSampleClips()
    const tr: TimelineTransition = {
      id: 'tr-sel',
      transitionId: 'tr-dissolve',
      name: 'Cross Dissolve',
      trackId: 'track-v1',
      startTime: 0,
      duration: 1.0,
      leftClipId: clipA.id,
    }

    let next = new AddTransitionCommand(tr).execute(state)
    expect(next.selectedTransitionId).toBe('tr-sel')

    // Selecting clipA clears selectedTransitionId
    next = new SelectItemCommand(clipA.id).execute(next)
    expect(next.selectedItemId).toBe(clipA.id)
    expect(next.selectedTransitionId).toBeNull()
  })

  it('removes transition when attached clip is moved', () => {
    const { state, clipA, clipB } = createSampleClips()
    const tr: TimelineTransition = {
      id: 'tr-move-test',
      transitionId: 'tr-dissolve',
      name: 'Cross Dissolve',
      trackId: 'track-v1',
      startTime: 3.5,
      duration: 1.0,
      leftClipId: clipA.id,
      rightClipId: clipB.id,
    }

    let next = new AddTransitionCommand(tr).execute(state)
    expect(next.transitions?.['tr-move-test']).toBeDefined()

    // Move clipA to start time 10 -> transition must be removed!
    next = new MoveTimelineItemCommand(clipA.id, 10).execute(next)
    expect(next.transitions?.['tr-move-test']).toBeUndefined()
  })

  it('removes transition on video clip when its linked audio clip is moved', () => {
    const { state, clipA } = createSampleClips()
    // Add linked audio clip
    const audioClip: TimelineItem = {
      id: 'clip-audio-linked',
      trackId: 'track-a1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 4,
      sourceIn: 0,
      sourceOut: 4,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      linkedItemId: clipA.id,
    }
    let withAudio = {
      ...state,
      items: {
        ...state.items,
        [clipA.id]: { ...clipA, linkedItemId: audioClip.id },
        [audioClip.id]: audioClip,
      },
    }

    const tr: TimelineTransition = {
      id: 'tr-video-linked',
      transitionId: 'tr-dissolve',
      name: 'Cross Dissolve',
      trackId: 'track-v1',
      startTime: 0,
      duration: 1.0,
      leftClipId: clipA.id,
    }

    withAudio = new AddTransitionCommand(tr).execute(withAudio)
    expect(withAudio.transitions?.['tr-video-linked']).toBeDefined()

    // Move ONLY the audio clip: the video clip transition must be removed!
    withAudio = new MoveTimelineItemCommand(audioClip.id, 5).execute(withAudio)
    expect(withAudio.transitions?.['tr-video-linked']).toBeUndefined()
  })

  it('removes transition when attached clip is trimmed', () => {
    const { state, clipA, clipB } = createSampleClips()
    const tr: TimelineTransition = {
      id: 'tr-trim-test',
      transitionId: 'tr-wipe',
      name: 'Linear Wipe',
      trackId: 'track-v1',
      startTime: 3.5,
      duration: 1.0,
      leftClipId: clipA.id,
      rightClipId: clipB.id,
    }

    let next = new AddTransitionCommand(tr).execute(state)
    expect(next.transitions?.['tr-trim-test']).toBeDefined()

    // Trim clipB's left edge
    next = new TrimTimelineItemCommand(clipB.id, { edge: 'left', newTime: 5.0 }).execute(next)
    expect(next.transitions?.['tr-trim-test']).toBeUndefined()
  })

  it('removes transition on video clip when its linked audio clip is trimmed', () => {
    const { state, clipA } = createSampleClips()
    const audioClip: TimelineItem = {
      id: 'clip-audio-trim-linked',
      trackId: 'track-a1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 4,
      sourceIn: 0,
      sourceOut: 4,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      linkedItemId: clipA.id,
    }
    let withAudio = {
      ...state,
      items: {
        ...state.items,
        [clipA.id]: { ...clipA, linkedItemId: audioClip.id },
        [audioClip.id]: audioClip,
      },
    }

    const tr: TimelineTransition = {
      id: 'tr-video-audio-trim',
      transitionId: 'tr-dissolve',
      name: 'Cross Dissolve',
      trackId: 'track-v1',
      startTime: 3.0,
      duration: 1.0,
      leftClipId: clipA.id,
    }

    withAudio = new AddTransitionCommand(tr).execute(withAudio)
    expect(withAudio.transitions?.['tr-video-audio-trim']).toBeDefined()

    // Trim the linked audio clip -> transition on video clip removed!
    withAudio = new TrimTimelineItemCommand(audioClip.id, { edge: 'right', newTime: 3.0 }).execute(withAudio)
    expect(withAudio.transitions?.['tr-video-audio-trim']).toBeUndefined()
  })

  it('removes transition when clip is split', () => {
    const { state, clipA } = createSampleClips()
    const tr: TimelineTransition = {
      id: 'tr-split-test',
      transitionId: 'tr-zoom',
      name: 'Zoom In',
      trackId: 'track-v1',
      startTime: 0,
      duration: 1.0,
      leftClipId: clipA.id,
    }

    let next = new AddTransitionCommand(tr).execute(state)
    expect(next.transitions?.['tr-split-test']).toBeDefined()

    // Split clipA at 2.0s
    next = new SplitTimelineItemCommand(clipA.id, 2.0, 'clipA-left', 'clipA-right').execute(next)
    expect(next.transitions?.['tr-split-test']).toBeUndefined()
  })

  it('removes transition when clip speed is updated', () => {
    const { state, clipA } = createSampleClips()
    const tr: TimelineTransition = {
      id: 'tr-speed-test',
      transitionId: 'tr-dissolve',
      name: 'Cross Dissolve',
      trackId: 'track-v1',
      startTime: 0,
      duration: 1.0,
      leftClipId: clipA.id,
    }

    let next = new AddTransitionCommand(tr).execute(state)
    expect(next.transitions?.['tr-speed-test']).toBeDefined()

    // Update speed of clipA to 2x -> transition removed!
    next = new UpdateSpeedCommand(clipA.id, { speed: 2.0 }).execute(next)
    expect(next.transitions?.['tr-speed-test']).toBeUndefined()
  })

  it('does not remove transition if clip is moved back to its exact original place', () => {
    const { state, clipA } = createSampleClips()
    const tr: TimelineTransition = {
      id: 'tr-same-place',
      transitionId: 'tr-dissolve',
      name: 'Cross Dissolve',
      trackId: 'track-v1',
      startTime: 0,
      duration: 1.0,
      leftClipId: clipA.id,
    }

    let next = new AddTransitionCommand(tr).execute(state)
    expect(next.transitions?.['tr-same-place']).toBeDefined()

    // Move clipA to 0 (its current startTime) on the same track -> no actual move!
    next = new MoveTimelineItemCommand(clipA.id, 0, 'track-v1').execute(next)
    expect(next.transitions?.['tr-same-place']).toBeDefined()
  })

  it('does not remove transition if clip is trimmed back to original boundary', () => {
    const { state, clipA } = createSampleClips()
    const tr: TimelineTransition = {
      id: 'tr-same-trim',
      transitionId: 'tr-wipe',
      name: 'Linear Wipe',
      trackId: 'track-v1',
      startTime: 3.0,
      duration: 1.0,
      leftClipId: clipA.id,
    }

    let next = new AddTransitionCommand(tr).execute(state)
    expect(next.transitions?.['tr-same-trim']).toBeDefined()

    // Trim right edge to 4.0 (its current end time: startTime 0 + duration 4) -> no boundary change!
    next = new TrimTimelineItemCommand(clipA.id, { edge: 'right', newTime: 4.0 }).execute(next)
    expect(next.transitions?.['tr-same-trim']).toBeDefined()
  })

  it('symmetrically extends both sides of two-clip transition when dragging left handle outward', () => {
    const { state, clipA, clipB } = createSampleClips()
    // clipA: 0..4 (cut at 4.0), clipB: 4..8
    // tr: centered at 4.0, duration 1.0 (starts at 3.5, ends at 4.5)
    const tr: TimelineTransition = {
      id: 'tr-cut-sym',
      transitionId: 'tr-dissolve',
      name: 'Dissolve',
      trackId: 'track-v1',
      startTime: 3.5,
      duration: 1.0,
      leftClipId: clipA.id,
      rightClipId: clipB.id,
    }
    const next = new AddTransitionCommand(tr).execute(state)

    // User drags left handle outward by 0.5s (deltaTime = -0.5)
    const res = computeTransitionTrim(next, 'tr-cut-sym', 'trim-left', 3.5, 1.0, -0.5)
    // Left edge moves from 3.5 -> 3.0 (-0.5s)
    // Right edge moves from 4.5 -> 5.0 (+0.5s)
    // Center remains strictly at 4.0
    // Total duration becomes 2.0s
    expect(res.duration).toBeCloseTo(2.0, 5)
    expect(res.startTime).toBeCloseTo(3.0, 5)
    expect(res.startTime + res.duration).toBeCloseTo(5.0, 5)
  })

  it('symmetrically extends both sides of two-clip transition when dragging right handle outward', () => {
    const { state, clipA, clipB } = createSampleClips()
    const tr: TimelineTransition = {
      id: 'tr-cut-sym-r',
      transitionId: 'tr-dissolve',
      name: 'Dissolve',
      trackId: 'track-v1',
      startTime: 3.5,
      duration: 1.0,
      leftClipId: clipA.id,
      rightClipId: clipB.id,
    }
    const next = new AddTransitionCommand(tr).execute(state)

    // User drags right handle outward by 0.4s (deltaTime = +0.4)
    const res = computeTransitionTrim(next, 'tr-cut-sym-r', 'trim-right', 3.5, 1.0, 0.4)
    // Left edge moves from 3.5 -> 3.1 (-0.4s)
    // Right edge moves from 4.5 -> 4.9 (+0.4s)
    // Center remains strictly at 4.0
    // Total duration becomes 1.8s
    expect(res.duration).toBeCloseTo(1.8, 5)
    expect(res.startTime).toBeCloseTo(3.1, 5)
    expect(res.startTime + res.duration).toBeCloseTo(4.9, 5)
  })

  it('symmetrically shrinks both sides of two-clip transition when dragging handles inward', () => {
    const { state, clipA, clipB } = createSampleClips()
    const tr: TimelineTransition = {
      id: 'tr-cut-sym-shrink',
      transitionId: 'tr-dissolve',
      name: 'Dissolve',
      trackId: 'track-v1',
      startTime: 3.0,
      duration: 2.0,
      leftClipId: clipA.id,
      rightClipId: clipB.id,
    }
    const next = new AddTransitionCommand(tr).execute(state)

    // Drag left handle inward by 0.3s (deltaTime = +0.3)
    const resLeft = computeTransitionTrim(next, 'tr-cut-sym-shrink', 'trim-left', 3.0, 2.0, 0.3)
    expect(resLeft.duration).toBeCloseTo(1.4, 5)
    expect(resLeft.startTime).toBeCloseTo(3.3, 5)
    expect(resLeft.startTime + resLeft.duration).toBeCloseTo(4.7, 5)

    // Drag right handle inward by 0.3s (deltaTime = -0.3)
    const resRight = computeTransitionTrim(next, 'tr-cut-sym-shrink', 'trim-right', 3.0, 2.0, -0.3)
    expect(resRight.duration).toBeCloseTo(1.4, 5)
    expect(resRight.startTime).toBeCloseTo(3.3, 5)
    expect(resRight.startTime + resRight.duration).toBeCloseTo(4.7, 5)
  })

  it('clamps symmetric two-clip transition expansion to available clip lengths', () => {
    const { state, clipA, clipB } = createSampleClips()
    // clipA duration is 4.0s (0..4), clipB duration is 4.0s (4..8)
    // Maximum possible half duration is 4.0s (total 8.0s)
    const tr: TimelineTransition = {
      id: 'tr-clamp',
      transitionId: 'tr-dissolve',
      name: 'Dissolve',
      trackId: 'track-v1',
      startTime: 3.5,
      duration: 1.0,
      leftClipId: clipA.id,
      rightClipId: clipB.id,
    }
    const next = new AddTransitionCommand(tr).execute(state)

    // Try to drag right handle by 10s
    const res = computeTransitionTrim(next, 'tr-clamp', 'trim-right', 3.5, 1.0, 10.0)
    expect(res.duration).toBeCloseTo(8.0, 5)
    expect(res.startTime).toBeCloseTo(0.0, 5)
    expect(res.startTime + res.duration).toBeCloseTo(8.0, 5)
  })

  it('correctly trims single clip In and Out transitions', () => {
    const { state, clipA } = createSampleClips()
    // In-transition anchored to clipA start (0.0)
    const inTr: TimelineTransition = {
      id: 'tr-in',
      transitionId: 'tr-dissolve',
      name: 'Dissolve',
      trackId: 'track-v1',
      startTime: 0,
      duration: 1.0,
      rightClipId: clipA.id,
    }
    const withIn = new AddTransitionCommand(inTr).execute(state)

    // Dragging right handle extends duration from 1.0 to 1.8, start stays at 0
    const inRes = computeTransitionTrim(withIn, 'tr-in', 'trim-right', 0, 1.0, 0.8)
    expect(inRes.startTime).toBe(0)
    expect(inRes.duration).toBeCloseTo(1.8, 5)

    // Out-transition anchored to clipA end (4.0)
    const outTr: TimelineTransition = {
      id: 'tr-out',
      transitionId: 'tr-dissolve',
      name: 'Dissolve',
      trackId: 'track-v1',
      startTime: 3.0,
      duration: 1.0,
      leftClipId: clipA.id,
    }
    const withOut = new AddTransitionCommand(outTr).execute(state)

    // Dragging left handle outward by 0.5s extends duration from 1.0 to 1.5, end stays at 4.0
    const outRes = computeTransitionTrim(withOut, 'tr-out', 'trim-left', 3.0, 1.0, -0.5)
    expect(outRes.duration).toBeCloseTo(1.5, 5)
    expect(outRes.startTime).toBeCloseTo(2.5, 5)
    expect(outRes.startTime + outRes.duration).toBeCloseTo(4.0, 5)
  })
})



describe('transition alignment', () => {
  const transition: TimelineTransition = { id: 'aligned', transitionId: 'tr-cross-dissolve', name: 'Cross Dissolve',
    trackId: 'track-v1', startTime: 3, duration: 2, leftClipId: 'clip-a', rightClipId: 'clip-b' }

  it.each([
    ['end', 2, 1], ['center', 3, 2.5], ['start', 4, 4],
  ] as const)('keeps %s alignment when adding and changing duration', (alignment, start, resizedStart) => {
    const sample = createSampleClips().state
    let state = new AddTransitionCommand({ ...transition, alignment }).execute({ ...sample, assets: {
      'asset-1': { id: 'asset-1', name: 'Video 1', type: 'video', path: '/video1.mp4', duration: 10 },
      'asset-2': { id: 'asset-2', name: 'Video 2', type: 'video', path: '/video2.mp4', duration: 10 },
    } })
    expect(state.transitions!.aligned.startTime).toBe(start)
    state = new UpdateTransitionCommand('aligned', { duration: 3 }).execute(state)
    expect(state.transitions!.aligned.startTime).toBe(resizedStart)
    expect(state.transitions!.aligned.duration).toBe(3)
    expect(getPlaybackFrameInfo(state, resizedStart + 1.5).activeVideos).toHaveLength(2)
    expect(getPlaybackFrameInfo(state, resizedStart + 1.5).activeTransitions?.[0].progress).toBeCloseTo(0.5)
  })

  it('changes real timing through commands and supports undo, redo and saving', () => {
    const initial = new AddTransitionCommand(transition).execute(createSampleClips().state)
    const history = new CommandHistory(initial)
    let state = history.execute(new UpdateTransitionCommand('aligned', { alignment: 'end' }))
    expect(state.transitions!.aligned.startTime).toBe(2)
    expect(history.undo()!.transitions!.aligned.startTime).toBe(3)
    state = history.redo()!
    expect(deserializeProject(serializeProject(state)).state.transitions!.aligned).toEqual(state.transitions!.aligned)
  })

  it.each(['end', 'start', 'center'] as const)('clamps %s alignment to the participating clips', alignment => {
    const state = new AddTransitionCommand({ ...transition, alignment, duration: 20 }).execute(createSampleClips().state)
    const tr = state.transitions!.aligned
    expect(tr.startTime).toBeGreaterThanOrEqual(0)
    expect(tr.startTime + tr.duration).toBeLessThanOrEqual(8)
    expect(tr.duration).toBe(alignment === 'center' ? 8 : 4)
  })

  it.each([
    ['end', 'trim-left', -1, 1, 3], ['start', 'trim-right', 1, 4, 3],
    ['end', 'trim-right', 1, 2, 2], ['start', 'trim-left', -1, 4, 2],
    ['center', 'trim-left', -1, 2, 4],
  ] as const)('resizes %s from %s while keeping its cut anchor', (alignment, edge, delta, start, duration) => {
    const state = new AddTransitionCommand({ ...transition, alignment }).execute(createSampleClips().state)
    const tr = state.transitions!.aligned
    const trim = computeTransitionTrim(state, tr.id, edge, tr.startTime, tr.duration, delta)
    const updated = new UpdateTransitionCommand(tr.id, trim).execute(state).transitions!.aligned
    expect(updated.startTime).toBe(start)
    expect(updated.duration).toBe(duration)
  })
})


it('keeps a full-length incoming transition at the clip start when shortened', () => {
  const initial = new AddTransitionCommand({ id: 'in', transitionId: 'tr-cross-dissolve', name: 'Cross Dissolve',
    trackId: 'track-v1', startTime: 4, duration: 4, rightClipId: 'clip-b' }).execute(createSampleClips().state)
  const updated = new UpdateTransitionCommand('in', { duration: 1 }).execute(initial)
  expect(updated.transitions!.in.startTime).toBe(4)
  expect(computeTransitionTrim(initial, 'in', 'trim-right', 4, 4, -3)).toEqual({ startTime: 4, duration: 1 })
})
