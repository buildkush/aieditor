import { describe, it, expect } from 'vitest'
import {
  createEmptyProjectState,
  type ProjectState,
} from './project/projectState'
import {
  AddSolidLayerCommand,
  UpdateSolidLayerCommand,
  AddTextLayerCommand,
  UpdateTextCommand,
  AddCaptionCommand,
  UpdateCaptionCommand,
  SplitCaptionCommand,
  MergeCaptionsCommand,
  ApplyCaptionPresetCommand,
  ImportSubtitlesCommand,
  SetBlendModeCommand,
  UpdateTransformCommand,
  RemoveTimelineItemCommand,
  SetKeyframeValueCommand,
} from './commands/editorCommand'
import { CommandHistory } from './commands/commandHistory'
import {
  parseSrt,
  parseVtt,
  generateWordTiming,
  serializeToSrt,
  serializeToVtt,
} from './subtitles/subtitleParser'
import { evaluateItemProperty, evaluateItemTransform } from './timeline/keyframeEvaluation'
import { getPlaybackFrameInfo } from './playback/timelinePlayback'
import { serializeProject, deserializeProject } from './persistence/projectSerializer'
import { CAPTION_PRESETS, type BlendMode, type Track } from './timeline/types'

function initProject(name = 'Test Project'): ProjectState {
  const track1: Track = {
    id: 'track-v1',
    name: 'Video 1',
    type: 'video',
    visible: true,
    locked: false,
  }
  return createEmptyProjectState({
    id: 'proj-1',
    name,
    initialTracks: [track1],
  })
}

describe('Phase 5 — Text, Subtitles, Stylized Captions & Compositing Layers', () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // 1. SOLID / COLOR LAYERS
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Solid Layers', () => {
    it('creates a first-class solid layer without a source media asset', () => {
      let state = initProject('Solid Test')

      const cmd = new AddSolidLayerCommand({
        startTime: 2,
        duration: 4,
        color: '#ff0000',
        blendMode: 'overlay',
      })
      state = cmd.execute(state)

      const solidItem = state.selectedItemId ? state.items[state.selectedItemId] : null
      expect(solidItem).toBeDefined()
      expect(solidItem?.itemType).toBe('solid')
      expect(solidItem?.assetId).toBe('') // No media library asset required!
      expect(solidItem?.solid?.color).toBe('#ff0000')
      expect(solidItem?.startTime).toBe(2)
      expect(solidItem?.duration).toBe(4)
      expect(solidItem?.transform?.blendMode).toBe('overlay')
    })

    it('updates solid layer color and properties', () => {
      let state = initProject('Solid Test')
      state = new AddSolidLayerCommand({ startTime: 0, duration: 5, color: '#123456' }).execute(state)
      const itemId = state.selectedItemId!

      state = new UpdateSolidLayerCommand(itemId, { color: '#abcdef' }).execute(state)
      expect(state.items[itemId].solid?.color).toBe('#abcdef')
    })

    it('updates solid layer opacity and transform', () => {
      let state = initProject('Solid Test')
      state = new AddSolidLayerCommand({ startTime: 0, duration: 5 }).execute(state)
      const itemId = state.selectedItemId!

      state = new UpdateTransformCommand(itemId, { opacity: 0.5, scale: 1.5, rotation: 45 }).execute(state)
      expect(state.items[itemId].transform.opacity).toBe(0.5)
      expect(state.items[itemId].transform.scale).toBe(1.5)
      expect(state.items[itemId].transform.rotation).toBe(45)
    })

    it('deletes solid layer properly via RemoveTimelineItemCommand', () => {
      let state = initProject('Solid Test')
      state = new AddSolidLayerCommand({ startTime: 0, duration: 5 }).execute(state)
      const itemId = state.selectedItemId!
      expect(state.items[itemId]).toBeDefined()

      state = new RemoveTimelineItemCommand(itemId).execute(state)
      expect(state.items[itemId]).toBeUndefined()
    })

    it('supports keyframed animation on solid layers', () => {
      let state = initProject('Solid Test')
      state = new AddSolidLayerCommand({ startTime: 0, duration: 10 }).execute(state)
      const itemId = state.selectedItemId!

      // Animate opacity from 0s -> 0 to 2s -> 1
      state = new SetKeyframeValueCommand(itemId, 'opacity', 0, 0).execute(state)
      state = new SetKeyframeValueCommand(itemId, 'opacity', 2, 1).execute(state)

      const item = state.items[itemId]
      const evalAt0 = evaluateItemTransform(item, 0)
      const evalAt1 = evaluateItemTransform(item, 1)
      const evalAt2 = evaluateItemTransform(item, 2)

      expect(evalAt0.opacity).toBe(0)
      expect(evalAt1.opacity).toBeCloseTo(0.5, 2)
      expect(evalAt2.opacity).toBe(1)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. TEXT LAYERS
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Text Layers', () => {
    it('creates a first-class text layer with full typography properties', () => {
      let state = initProject('Text Test')

      const cmd = new AddTextLayerCommand({
        startTime: 1,
        duration: 4,
        text: 'Antigravity Video Editor',
        properties: {
          fontFamily: 'Montserrat, sans-serif',
          fontSize: 64,
          fontWeight: 700,
          fontStyle: 'normal',
          color: '#f59e0b',
          strokeColor: '#000000',
          strokeWidth: 4,
          backgroundColor: '#000000',
          backgroundOpacity: 0.8,
          padding: 16,
          align: 'center',
        },
      })
      state = cmd.execute(state)

      const textItem = state.selectedItemId ? state.items[state.selectedItemId] : null
      expect(textItem).toBeDefined()
      expect(textItem?.itemType).toBe('text')
      expect(textItem?.assetId).toBe('')
      expect(textItem?.text?.text).toBe('Antigravity Video Editor')
      expect(textItem?.text?.fontSize).toBe(64)
      expect(textItem?.text?.color).toBe('#f59e0b')
      expect(textItem?.text?.strokeWidth).toBe(4)
      expect(textItem?.text?.backgroundOpacity).toBe(0.8)
    })

    it('updates text properties via UpdateTextCommand', () => {
      let state = initProject('Text Test')
      state = new AddTextLayerCommand({ startTime: 0, duration: 5, text: 'Hello' }).execute(state)
      const itemId = state.selectedItemId!

      state = new UpdateTextCommand(itemId, {
        text: 'Updated World',
        fontSize: 72,
        color: '#10b981',
      }).execute(state)

      expect(state.items[itemId].text?.text).toBe('Updated World')
      expect(state.items[itemId].text?.fontSize).toBe(72)
      expect(state.items[itemId].text?.color).toBe('#10b981')
    })

    it('supports keyframing text properties (fontSize, strokeWidth, padding)', () => {
      let state = initProject('Text Test')
      state = new AddTextLayerCommand({
        startTime: 0,
        duration: 10,
        text: 'Scaling Text',
        properties: { fontSize: 40, strokeWidth: 2 },
      }).execute(state)
      const itemId = state.selectedItemId!

      // Keyframe fontSize: 0s -> 40, 4s -> 80
      state = new SetKeyframeValueCommand(itemId, 'fontSize', 0, 40).execute(state)
      state = new SetKeyframeValueCommand(itemId, 'fontSize', 4, 80).execute(state)

      const item = state.items[itemId]
      const sizeAt0 = evaluateItemProperty(item, 'fontSize', 0)
      const sizeAt2 = evaluateItemProperty(item, 'fontSize', 2)
      const sizeAt4 = evaluateItemProperty(item, 'fontSize', 4)

      expect(sizeAt0).toBe(40)
      expect(sizeAt2).toBeCloseTo(60, 1)
      expect(sizeAt4).toBe(80)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. BLEND MODES & COMPOSITING STACK
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Blend Modes & Compositing Stack', () => {
    const supportedBlendModes: BlendMode[] = [
      'normal',
      'multiply',
      'screen',
      'overlay',
      'soft-light',
      'hard-light',
      'darken',
      'lighten',
      'difference',
      'add',
      'color-dodge',
      'color-burn',
      'exclusion',
      'luminosity',
    ]

    it('supports all required blend modes in SetBlendModeCommand and ProjectState', () => {
      let state = initProject('Blend Test')
      state = new AddSolidLayerCommand({ startTime: 0, duration: 5 }).execute(state)
      const itemId = state.selectedItemId!

      for (const mode of supportedBlendModes) {
        state = new SetBlendModeCommand(itemId, mode).execute(state)
        expect(state.items[itemId].transform.blendMode).toBe(mode)
      }
    })

    it('correctly stacks layers V1 -> V2 -> Text in getPlaybackFrameInfo', () => {
      const track1: Track = {
        id: 'track-v1',
        name: 'Video 1',
        type: 'video',
        visible: true,
        locked: false,
      }
      const track2: Track = {
        id: 'track-v2',
        name: 'Video 2',
        type: 'video',
        visible: true,
        locked: false,
      }
      let state = createEmptyProjectState({ id: 'comp-test', name: 'Comp Test', initialTracks: [track1, track2] })

      // V1: video item
      state = {
        ...state,
        assets: {
          'asset-bg': {
            id: 'asset-bg',
            name: 'background.mp4',
            type: 'video',
            path: '/media/bg.mp4',
            duration: 10,
          },
        },
        items: {
          'item-v1': {
            id: 'item-v1',
            trackId: 'track-v1',
            assetId: 'asset-bg',
            startTime: 0,
            duration: 10,
            sourceIn: 0,
            sourceOut: 10,
            transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
          },
        },
      }

      // V2: Solid overlay with opacity 0.5 and screen blend mode
      state = new AddSolidLayerCommand({
        startTime: 0,
        duration: 10,
        color: '#ff00ff',
        trackId: 'track-v2',
        blendMode: 'screen',
        transform: { opacity: 0.5 },
      }).execute(state)

      // V3: Text on top
      state = new AddTextLayerCommand({
        startTime: 0,
        duration: 10,
        text: 'Top Text',
        trackId: 'track-v2',
      }).execute(state)

      const frameInfo = getPlaybackFrameInfo(state, 2)
      // Visual clips should be ordered V1 bottom -> V2 middle -> Text top
      expect(frameInfo.activeVideos.length).toBeGreaterThanOrEqual(2)
      expect(frameInfo.activeVideos[0].item.id).toBe('item-v1')
      const solidClip = frameInfo.activeVideos.find((c) => c.item.itemType === 'solid')
      expect(solidClip).toBeDefined()
      expect(solidClip?.item.transform.blendMode).toBe('screen')
      expect(solidClip?.item.transform.opacity).toBe(0.5)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. SUBTITLES & CAPTIONS (SRT, VTT, EDITING, SPLIT, MERGE, PRESETS)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Subtitles and Captions', () => {
    const sampleSrt = `1
00:00:01,000 --> 00:00:03,500
First subtitle line

2
00:00:04,200 --> 00:00:07,800
Second subtitle line with multiple words
`

    const sampleVtt = `WEBVTT

1
00:00:01.000 --> 00:00:03.500
First VTT cue

2
00:00:04.200 --> 00:00:07.800
Second VTT cue
`

    it('parses SRT files into cues with correct timestamps', () => {
      const cues = parseSrt(sampleSrt)
      expect(cues.length).toBe(2)
      expect(cues[0].startTime).toBe(1.0)
      expect(cues[0].endTime).toBe(3.5)
      expect(cues[0].text).toBe('First subtitle line')
      expect(cues[1].startTime).toBe(4.2)
      expect(cues[1].endTime).toBe(7.8)
      expect(cues[1].text).toBe('Second subtitle line with multiple words')
    })

    it('parses WebVTT files into cues with correct timestamps', () => {
      const cues = parseVtt(sampleVtt)
      expect(cues.length).toBe(2)
      expect(cues[0].startTime).toBe(1.0)
      expect(cues[0].endTime).toBe(3.5)
      expect(cues[0].text).toBe('First VTT cue')
    })

    it('serializes cues back to SRT and VTT formats correctly', () => {
      const cues = parseSrt(sampleSrt)
      const srtOut = serializeToSrt(cues)
      expect(srtOut).toContain('00:00:01,000 --> 00:00:03,500')
      expect(srtOut).toContain('First subtitle line')

      const vttOut = serializeToVtt(cues)
      expect(vttOut).toContain('WEBVTT')
      expect(vttOut).toContain('00:00:01.000 --> 00:00:03.500')
    })

    it('imports subtitles into ProjectState via ImportSubtitlesCommand', () => {
      let state = initProject('Caption Test')
      state = new ImportSubtitlesCommand(sampleSrt).execute(state)

      const captionTrack = state.tracks.find((t) => t.type === 'caption')
      expect(captionTrack).toBeDefined()

      const captionItems = Object.values(state.items).filter((it) => it.trackId === captionTrack?.id)
      expect(captionItems.length).toBe(2)
      expect(captionItems[0].caption?.text).toBe('First subtitle line')
      expect(captionItems[0].startTime).toBe(1.0)
      expect(captionItems[0].duration).toBe(2.5)
    })

    it('generates word-level timing data structure for imported/created captions', () => {
      const words = generateWordTiming('Hello world from aiditor', 1.0, 3.0)
      expect(words.length).toBe(4)
      expect(words[0].word).toBe('Hello')
      expect(words[0].start).toBe(1.0)
      expect(words[3].word).toBe('aiditor')
      expect(words[3].end).toBeCloseTo(3.0, 2)
    })

    it('splits a caption segment cleanly and partitions words', () => {
      let state = initProject('Split Caption')
      state = new AddCaptionCommand({
        startTime: 0,
        duration: 4,
        text: 'One two three four',
      }).execute(state)
      const itemId = state.selectedItemId!

      state = new SplitCaptionCommand(itemId, 2.0).execute(state)

      // Original item is replaced by two split items
      expect(state.items[itemId]).toBeUndefined()
      const remainingItems = Object.values(state.items).filter((it) => it.itemType === 'caption')
      expect(remainingItems.length).toBe(2)

      const [left, right] = remainingItems.sort((a, b) => a.startTime - b.startTime)
      expect(left.startTime).toBe(0)
      expect(left.duration).toBe(2)
      expect(right.startTime).toBe(2)
      expect(right.duration).toBe(2)
    })

    it('merges adjacent captions into a single caption with unified text and words', () => {
      let state = initProject('Merge Caption')
      state = new AddCaptionCommand({ id: 'c1', startTime: 0, duration: 2, text: 'Hello' }).execute(state)
      state = new AddCaptionCommand({ id: 'c2', startTime: 2, duration: 2, text: 'World' }).execute(state)

      state = new MergeCaptionsCommand('c1', 'c2').execute(state)

      const captions = Object.values(state.items).filter((it) => it.itemType === 'caption')
      expect(captions.length).toBe(1)
      expect(captions[0].caption?.text).toBe('Hello World')
      expect(captions[0].startTime).toBe(0)
      expect(captions[0].duration).toBe(4)
    })

    it('applies stylized caption presets (Clean, Bold, Meme, Highlight, Minimal)', () => {
      let state = initProject('Preset Test')
      state = new AddCaptionCommand({ startTime: 0, duration: 3, text: 'Stylized punch' }).execute(state)
      const itemId = state.selectedItemId!

      for (const preset of ['Clean', 'Bold', 'Meme', 'Highlight', 'Minimal']) {
        state = new ApplyCaptionPresetCommand(itemId, preset).execute(state)
        const cap = state.items[itemId].caption
        expect(cap?.preset).toBe(preset)
        expect(cap?.style?.fontFamily).toBe(CAPTION_PRESETS[preset].fontFamily)
        expect(cap?.style?.fontSize).toBe(CAPTION_PRESETS[preset].fontSize)
      }
    })

    it('allows word-level styling overrides (word emphasis for Reels/Shorts)', () => {
      let state = initProject('Word Override')
      state = new AddCaptionCommand({
        startTime: 0,
        duration: 2,
        text: 'This is crazy',
      }).execute(state)
      const itemId = state.selectedItemId!

      const currentWords = state.items[itemId].caption!.words!
      // Override second word "crazy" with vibrant color highlight
      const updatedWords = currentWords.map((w, idx) =>
        idx === 2 ? { ...w, color: '#ef4444' } : w
      )

      state = new UpdateCaptionCommand(itemId, { words: updatedWords }).execute(state)
      expect(state.items[itemId].caption?.words?.[2].color).toBe('#ef4444')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. COMMAND HISTORY & PERSISTENCE ROUND-TRIP
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Command History & Persistence', () => {
    it('supports undo and redo for text, solid, and caption commands', () => {
      let state = initProject('Undo Test')
      const history = new CommandHistory(state)

      // 1. Add Text
      const addText = new AddTextLayerCommand({ startTime: 0, duration: 5, text: 'Undo me' })
      state = history.execute(addText)
      const textId = state.selectedItemId!
      expect(state.items[textId]).toBeDefined()

      // Undo Add Text
      state = history.undo()!
      expect(state.items[textId]).toBeUndefined()

      // Redo Add Text
      state = history.redo()!
      expect(state.items[textId]).toBeDefined()
    })

    it('fully serializes and deserializes text, solid, caption, and blendMode properties', () => {
      let state = initProject('Persist Roundtrip')
      const vtId = state.tracks[0].id

      // Add a solid layer
      state = new AddSolidLayerCommand({
        startTime: 0,
        duration: 4,
        color: '#8b5cf6',
        blendMode: 'difference',
        trackId: vtId,
      }).execute(state)

      // Add a text layer
      state = new AddTextLayerCommand({
        startTime: 1,
        duration: 5,
        text: 'Persistent Title',
        properties: {
          fontSize: 54,
          color: '#ffffff',
          strokeColor: '#000000',
          strokeWidth: 3,
        },
        trackId: vtId,
      }).execute(state)

      // Add a caption layer
      state = new AddCaptionCommand({
        startTime: 2,
        duration: 3,
        text: 'Persistent Subtitle',
        preset: 'Highlight',
      }).execute(state)

      const savedJson = serializeProject(state, 'C:/test/phase5_project.aiditor')
      expect(savedJson).toContain('Persistent Title')
      expect(savedJson).toContain('Persistent Subtitle')
      expect(savedJson).toContain('#8b5cf6')
      expect(savedJson).toContain('difference')
      expect(savedJson).toContain('Highlight')

      const deserialized = deserializeProject(savedJson, { currentFilePath: 'C:/test/phase5_project.aiditor' })
      expect(deserialized.state.name).toBe('Persist Roundtrip')

      const items = Object.values(deserialized.state.items)
      const solid = items.find((i) => i.itemType === 'solid')
      const text = items.find((i) => i.itemType === 'text')
      const caption = items.find((i) => i.itemType === 'caption')

      expect(solid?.solid?.color).toBe('#8b5cf6')
      expect(solid?.transform.blendMode).toBe('difference')
      expect(text?.text?.text).toBe('Persistent Title')
      expect(text?.text?.fontSize).toBe(54)
      expect(caption?.caption?.text).toBe('Persistent Subtitle')
      expect(caption?.caption?.preset).toBe('Highlight')
    })
  })
})
