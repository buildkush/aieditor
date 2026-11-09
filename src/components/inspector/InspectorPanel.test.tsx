import { describe, it, expect, vi } from 'vitest'
// @ts-ignore
import { renderToStaticMarkup } from 'react-dom/server'
import { InspectorPanel } from './InspectorPanel'
import type {
  ProjectState,
  TimelineItem,
  Track,
  MediaAsset,
} from '../../core'

describe('InspectorPanel Component', () => {
  const asset1: MediaAsset = {
    id: 'asset-1',
    name: 'Interview.mp4',
    type: 'video',
    path: '/media/interview.mp4',
    duration: 30,
  }

  const track1: Track = { id: 'track-v1', name: 'Video 1', type: 'video' }

  const item1: TimelineItem = {
    id: 'item-1',
    trackId: 'track-v1',
    assetId: 'asset-1',
    startTime: 2,
    duration: 8,
    sourceIn: 1,
    sourceOut: 9,
    transform: {
      x: 120,
      y: -60,
      scale: 1.25,
      rotation: 10,
      opacity: 0.9,
    },
    crop: {
      left: 15,
      right: 10,
      top: 5,
      bottom: 5,
    },
  }

  it('renders empty prompt when no clip is selected', () => {
    const emptyState: ProjectState = {
      id: 'p1',
      name: 'Project',
      settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000 },
      assets: {},
      tracks: [track1],
      items: {},
      playheadTime: 0,
      selectedItemId: null,
    }

    const html = renderToStaticMarkup(<InspectorPanel state={emptyState} dispatch={vi.fn()} />)
    expect(html).toContain('inspector-empty')
    expect(html).toContain('Select a clip to inspect')
  })

  it('renders streamlined operational sections: Transform, Crop, Composite, Speed', () => {
    const selectedState: ProjectState = {
      id: 'p1',
      name: 'Project',
      settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000 },
      assets: { 'asset-1': asset1 },
      tracks: [track1],
      items: { 'item-1': item1 },
      playheadTime: 3,
      selectedItemId: 'item-1',
    }

    const html = renderToStaticMarkup(<InspectorPanel state={selectedState} dispatch={vi.fn()} />)

    // Transform Section
    expect(html).toContain('Transform')
    expect(html).toContain('Zoom')
    expect(html).toContain('Position')
    expect(html).toContain('Rotation')
    expect(html).toContain('Anchor')
    expect(html).toContain('Pitch')
    expect(html).toContain('Yaw')
    expect(html).toContain('Flip')
    expect(html).toContain('120.000') // Position X (3 decimals)
    expect(html).toContain('-60.000') // Position Y (3 decimals)
    expect(html).toContain('1.250') // Zoom X/Y (3 decimals)
    expect(html).toContain('10.0') // Rotation
    expect(html).toContain('🔗') // Zoom link button

    // Crop Section
    expect(html).toContain('Crop')
    expect(html).toContain('Left')
    expect(html).toContain('Right')
    expect(html).toContain('Top')
    expect(html).toContain('Bottom')
    expect(html).toContain('15.0')
    expect(html).toContain('10.0')
    expect(html).toContain('5.0')

    // Composite Section
    expect(html).toContain('Composite')
    expect(html).toContain('Blend Mode')
    expect(html).toContain('Opacity')
    expect(html).toContain('90.000')

    // Speed Section
    expect(html).toContain('Speed')
    expect(html).toContain('Frame Rate')
    expect(html).toContain('Direction')
    expect(html).toContain('100.000')
  })

  it('renders both Video and Audio tabs when linked clips are selected', () => {
    const trackAudio: Track = { id: 'track-a1', name: 'Audio 1', type: 'audio' }
    const assetAudio: MediaAsset = {
      id: 'asset-a1',
      name: 'Interview.mp4',
      type: 'audio',
      path: '/media/interview.mp4',
      duration: 30,
    }
    const itemAudio: TimelineItem = {
      id: 'item-audio-1',
      trackId: 'track-a1',
      assetId: 'asset-a1',
      startTime: 2,
      duration: 8,
      sourceIn: 1,
      sourceOut: 9,
      streamType: 'audio',
      linkedItemId: 'item-1',
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      audio: { volume: 0.8, pan: -0.2, muted: false },
    }

    const linkedVideoItem: TimelineItem = {
      ...item1,
      linkedItemId: 'item-audio-1',
    }

    const stateWithLinked: ProjectState = {
      id: 'p1',
      name: 'Linked Project',
      settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000 },
      assets: { 'asset-1': asset1, 'asset-a1': assetAudio },
      tracks: [track1, trackAudio],
      items: {
        'item-1': linkedVideoItem,
        'item-audio-1': itemAudio,
      },
      playheadTime: 2,
      selectedItemId: 'item-1',
    }

    const html = renderToStaticMarkup(<InspectorPanel state={stateWithLinked} dispatch={vi.fn()} />)

    // Exactly three primary tabs: Video, Audio, Effects
    expect(html).toContain('inspector-tabs')
    expect(html).toContain('Video')
    expect(html).toContain('Audio')
    expect(html).toContain('<span>Effect</span>')
    expect(html).not.toContain('Captions</span>')
    // Both Video and Audio buttons should be present and active tab is video
    expect(html).toContain('inspector-tab-btn active')
    expect(html).toContain('Video</span></button>')
    expect(html).toContain('Audio</span></button>')
    // Effects tab is disabled when item has no applied effects
    expect(html).toContain('Effect</span></button>')
  })

  it('renders audio controls when an audio clip is selected', () => {
    const trackAudio: Track = { id: 'track-a1', name: 'Voiceover', type: 'audio' }
    const assetAudio: MediaAsset = {
      id: 'asset-a2',
      name: 'Voiceover.wav',
      type: 'audio',
      path: '/media/voiceover.wav',
      duration: 15,
    }
    const itemAudioOnly: TimelineItem = {
      id: 'item-vo',
      trackId: 'track-a1',
      assetId: 'asset-a2',
      startTime: 0,
      duration: 15,
      sourceIn: 0,
      sourceOut: 15,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      audio: { volume: 0.75, pan: 0.3, muted: true },
    }

    const audioOnlyState: ProjectState = {
      id: 'p1',
      name: 'Audio Project',
      settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000 },
      assets: { 'asset-a2': assetAudio },
      tracks: [trackAudio],
      items: { 'item-vo': itemAudioOnly },
      playheadTime: 0,
      selectedItemId: 'item-vo',
    }

    const html = renderToStaticMarkup(<InspectorPanel state={audioOnlyState} dispatch={vi.fn()} />)

    // Audio tab should be active
    expect(html).toContain('inspector-section-title">Audio</span>')
    expect(html).toContain('Volume')
    expect(html).toContain('75.000')
    expect(html).toContain('Pan')
    expect(html).toContain('30.000')
    expect(html).toContain('inspector-slider')
    expect(html).toContain('Keyframe Volume')
    expect(html).toContain('Keyframe Pan')
    expect(html).toContain('Reset Audio')
  })

  it('highlights inspector keyframe button ONLY when playhead reaches a keyframe timestamp and hides prev/next buttons', () => {
    const itemWithKeyframes: TimelineItem = {
      ...item1,
      keyframes: {
        scale: [{ id: 'kf-scale-1', time: 5.0, value: 2.0, interpolation: 'linear' }],
        x: [{ id: 'kf-x-1', time: 5.0, value: 200, interpolation: 'linear' }],
        y: [{ id: 'kf-y-1', time: 5.0, value: 100, interpolation: 'linear' }],
      },
    }

    // 1. Playhead AT keyframe timestamp (5.0s) -> Should be highlighted (◆, active)
    const stateAtKf: ProjectState = {
      id: 'p1',
      name: 'Keyframe Project',
      settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000 },
      assets: { 'asset-1': asset1 },
      tracks: [track1],
      items: { 'item-1': itemWithKeyframes },
      playheadTime: 5.0,
      selectedItemId: 'item-1',
    }

    const htmlAtKf = renderToStaticMarkup(<InspectorPanel state={stateAtKf} dispatch={vi.fn()} />)
    expect(htmlAtKf).toContain('inspector-kf-btn active')
    expect(htmlAtKf).toContain('◆')
    // No previous/next buttons on inspector
    expect(htmlAtKf).not.toContain('inspector-kf-nav-btn')

    // 2. Playhead NOT at keyframe timestamp (2.5s) -> Should NOT be highlighted (◇, no active)
    const stateAwayFromKf: ProjectState = {
      ...stateAtKf,
      playheadTime: 2.5,
    }

    const htmlAway = renderToStaticMarkup(<InspectorPanel state={stateAwayFromKf} dispatch={vi.fn()} />)
    expect(htmlAway).not.toContain('inspector-kf-btn active')
    expect(htmlAway).not.toContain('◆')
    expect(htmlAway).toContain('◇')
    expect(htmlAway).not.toContain('inspector-kf-nav-btn')
  })

  it('precisely highlights keyframe only at the exact frame (e.g. 00:00:02:25) and not at adjacent frames (24, 26, 27)', () => {
    const fps = 30
    // Keyframe 1: at 00:00:00:00 (0s), value 1.0
    // Keyframe 2: at 00:00:02:25 (85 frames = 85/30 = 2.8333s), value 1.5
    const itemZoomKfs: TimelineItem = {
      ...item1,
      keyframes: {
        scale: [
          { id: 'kf-z0', time: 0.0, value: 1.0, interpolation: 'linear' },
          { id: 'kf-z1', time: Math.round((85 / fps) * 10000) / 10000, value: 1.5, interpolation: 'linear' },
        ],
      },
    }

    const baseState: ProjectState = {
      id: 'p1',
      name: 'Precision Keyframe Test',
      settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000 },
      assets: { 'asset-1': asset1 },
      tracks: [track1],
      items: { 'item-1': itemZoomKfs },
      playheadTime: 0,
      selectedItemId: 'item-1',
    }

    // Frame 25 (85/30 = 2.8333s): MUST be active (◆), and Zoom must be 1.500
    const stateFrame25 = { ...baseState, playheadTime: 85 / fps }
    const html25 = renderToStaticMarkup(<InspectorPanel state={stateFrame25} dispatch={vi.fn()} />)
    expect(html25).toContain('inspector-kf-btn active')
    expect(html25).toContain('◆')
    expect(html25).toContain('1.500') // Exact keyframe value, never 1.496
    expect(html25).not.toContain('1.496')

    // Frame 24 (84/30 = 2.8000s): MUST NOT be active (no active class on zoom), must render ◇
    const stateFrame24 = { ...baseState, playheadTime: 84 / fps }
    const html24 = renderToStaticMarkup(<InspectorPanel state={stateFrame24} dispatch={vi.fn()} />)
    expect(html24).not.toContain('inspector-kf-btn active')
    expect(html24).not.toContain('◆')

    // Frame 26 (86/30 = 2.8667s): MUST NOT be active
    const stateFrame26 = { ...baseState, playheadTime: 86 / fps }
    const html26 = renderToStaticMarkup(<InspectorPanel state={stateFrame26} dispatch={vi.fn()} />)
    expect(html26).not.toContain('inspector-kf-btn active')
    expect(html26).not.toContain('◆')

    // Frame 27 (87/30 = 2.9000s): MUST NOT be active
    const stateFrame27 = { ...baseState, playheadTime: 87 / fps }
    const html27 = renderToStaticMarkup(<InspectorPanel state={stateFrame27} dispatch={vi.fn()} />)
    expect(html27).not.toContain('inspector-kf-btn active')
    expect(html27).not.toContain('◆')
  })

  it('renders property names with resettable class and double-click reset tooltips', () => {
    const testState: ProjectState = {
      id: 'p1',
      name: 'Project',
      settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000 },
      assets: { 'asset-1': asset1 },
      tracks: [track1],
      items: { 'item-1': item1 },
      playheadTime: 3,
      selectedItemId: 'item-1',
    }
    const html = renderToStaticMarkup(<InspectorPanel state={testState} dispatch={vi.fn()} />)

    // Check that property labels are marked resettable and have double-click titles
    expect(html).toContain('inspector-label resettable')
    expect(html).toContain('Double-click to reset Zoom')
    expect(html).toContain('Double-click to reset Position')
    expect(html).toContain('Double-click to reset Rotation')
    expect(html).toContain('Double-click to reset Anchor')
    expect(html).toContain('Double-click to reset Pitch')
    expect(html).toContain('Double-click to reset Yaw')
    expect(html).toContain('Double-click to reset Flip')
    expect(html).toContain('Double-click to reset Crop Left')
    expect(html).toContain('Double-click to reset Crop Right')
    expect(html).toContain('Double-click to reset Crop Top')
    expect(html).toContain('Double-click to reset Crop Bottom')
    expect(html).toContain('Double-click to reset Blend Mode')
    expect(html).toContain('Double-click to reset Opacity')
    expect(html).toContain('Double-click to reset Speed')
    expect(html).toContain('Double-click to reset Frame Rate')
    expect(html).toContain('Double-click to reset Direction')

    // Sublabels X and Y are also resettable
    expect(html).toContain('inspector-sublabel resettable')
    expect(html).toContain('Double-click to reset Zoom X')
    expect(html).toContain('Double-click to reset Zoom Y')
    expect(html).toContain('Double-click to reset Position X')
    expect(html).toContain('Double-click to reset Position Y')
  })

  it('renders caption contextually inside Video tab without a separate captions tab', () => {
    const captionItem: TimelineItem = {
      id: 'cap-1',
      trackId: 'track-c1',
      assetId: '',
      itemType: 'caption',
      streamType: 'caption',
      startTime: 1,
      duration: 4,
      sourceIn: 0,
      sourceOut: 4,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      caption: {
        text: 'Hello world caption',
        words: [
          { word: 'Hello', startTime: 1, endTime: 2 },
          { word: 'world', startTime: 2, endTime: 3 },
          { word: 'caption', startTime: 3, endTime: 5 },
        ],
        preset: 'Clean',
      },
    }

    const captionState: ProjectState = {
      id: 'p1',
      name: 'Project',
      settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000 },
      assets: {},
      tracks: [{ id: 'track-c1', name: 'Captions 1', type: 'caption' }],
      items: { 'cap-1': captionItem },
      playheadTime: 2,
      selectedItemId: 'cap-1',
    }

    const html = renderToStaticMarkup(<InspectorPanel state={captionState} dispatch={vi.fn()} />)

    // Tabs must be exactly Video, Audio, Effects
    expect(html).toContain('Video</span></button>')
    expect(html).toContain('Audio</span></button>')
    expect(html).toContain('Effect</span></button>')
    expect(html).not.toContain('Captions</span></button>')

    // Contextual controls rendered in Video tab
    expect(html).toContain('Subtitle Content')
    expect(html).toContain('Hello world caption')
    expect(html).toContain('Caption Presets')
    expect(html).toContain('Clean')
    expect(html).toContain('Word Animation')
    expect(html).toContain('Word Timing')
    expect(html).toContain('Hello')
    expect(html).toContain('world')
    expect(html).toContain('Transform')
  })

  it('enables Effects tab and renders applied effects stack when clip has attached effects', () => {
    const itemWithEffect: TimelineItem = {
      id: 'item-fx-1',
      trackId: 'track-v1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 5,
      sourceIn: 0,
      sourceOut: 5,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      effects: [
        {
          id: 'fx-inst-1',
          effectId: 'blur',
          name: 'Blur',
          category: 'video',
          enabled: true,
          params: { radius: 15 },
        },
      ],
    }

    const effectState: ProjectState = {
      id: 'p1',
      name: 'Project',
      settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000 },
      assets: { 'asset-1': asset1 },
      tracks: [track1],
      items: { 'item-fx-1': itemWithEffect },
      playheadTime: 0,
      selectedItemId: 'item-fx-1',
    }

    // Render with forcedTab = 'effects'
    const html = renderToStaticMarkup(
      <InspectorPanel state={effectState} dispatch={vi.fn()} forcedTab="effects" />
    )

    // Effects tab is active and shows badge count
    expect(html).toContain('<span>Effect</span>')
    expect(html).toContain('inspector-effect-card')
    expect(html).toContain('Blur')
    expect(html).toContain('inspector-header-toggle')
    expect(html).toContain('inspector-effect-toggle')
    expect(html).toContain('Radius')
    expect(html).toContain('15')
  })

  it('renders expanded Text Inspector properties with Drop Shadow, Background sections, and Transform controls', () => {
    const textItem: TimelineItem = {
      id: 'text-1',
      trackId: 'track-v1',
      assetId: 'text-asset-1',
      startTime: 0,
      duration: 5,
      sourceIn: 0,
      sourceOut: 5,
      itemType: 'text',
      text: {
        text: 'Custom Title',
        fontFamily: 'Montserrat, sans-serif',
        fontSize: 72,
        fontWeight: '700',
        fontStyle: 'italic',
        underline: true,
        textCase: 'uppercase',
        align: 'center',
        lineHeight: 1.4,
        letterSpacing: 2,
        color: '#FFDD00',
        strokeColor: '#111111',
        strokeWidth: 4,
        shadowEnabled: true,
        shadowColor: '#222222',
        shadowOpacity: 0.9,
        shadowOffsetX: 3,
        shadowOffsetY: 5,
        shadowBlur: 12,
        backgroundEnabled: true,
        backgroundColor: '#000000',
        backgroundOpacity: 0.85,
        bgStrokeColor: '#ffffff',
        bgStrokeWidth: 2,
        paddingX: 24,
        paddingY: 14,
        cornerRadius: 8,
        bgOffsetX: 1,
        bgOffsetY: -2,
      },
      transform: {
        x: 50,
        y: -30,
        scale: 1,
        scaleX: 1.2,
        scaleY: 1.2,
        rotation: 15,
        anchorX: 10,
        anchorY: -5,
        opacity: 1,
      },
    }

    const textState: ProjectState = {
      id: 'p1',
      name: 'Text Project',
      settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000 },
      assets: {},
      tracks: [track1],
      items: { 'text-1': textItem },
      playheadTime: 0,
      selectedItemId: 'text-1',
    }

    const html = renderToStaticMarkup(<InspectorPanel state={textState} dispatch={vi.fn()} />)

    // Typography
    expect(html).toContain('Custom Title')
    expect(html).toContain('Font')
    expect(html).toContain('Weight')
    expect(html).toContain('Style')
    expect(html).toContain('Case')
    expect(html).toContain('Align')
    expect(html).toContain('Size')
    expect(html).toContain('Tracking')
    expect(html).toContain('Line Spacing')
    expect(html).toContain('Color')
    expect(html).toContain('Outline Color')
    expect(html).toContain('Outline Width')

    // Drop Shadow Section & Toggle
    expect(html).toContain('Drop Shadow')
    expect(html).toContain('inspector-header-toggle')
    expect(html).toContain('Shadow Blur')
    expect(html).toContain('Shadow Offset X')
    expect(html).toContain('Shadow Offset Y')
    expect(html).toContain('Shadow Opacity')

    // Background Section & Toggle
    expect(html).toContain('Background')
    expect(html).toContain('Fill Color')
    expect(html).toContain('Corner Radius')
    expect(html).toContain('Padding X')
    expect(html).toContain('Padding Y')
    expect(html).toContain('Position X')
    expect(html).toContain('Position Y')

    // Transform Section (Position, Scale with link, Rotation, Anchor)
    expect(html).toContain('Transform')
    expect(html).toContain('Anchor')
    expect(html).toContain('Rotation')
    expect(html).toContain('Position')
    expect(html).toContain('Zoom')
  })

  it('shares typography, drop shadow, and background controls with Captions while keeping timing separate', () => {
    const captionItem: TimelineItem = {
      id: 'cap-1',
      trackId: 'track-v1',
      assetId: 'cap-asset-1',
      startTime: 0,
      duration: 4,
      sourceIn: 0,
      sourceOut: 4,
      itemType: 'caption',
      transform: {
        x: 0,
        y: 200,
        scale: 1,
        rotation: 0,
        opacity: 1,
      },
      caption: {
        text: 'Shared Caption Subtitle',
        style: {
          fontFamily: 'Outfit, sans-serif',
          fontSize: 50,
          fontWeight: '600',
          color: '#FFFFFF',
          shadowEnabled: true,
          shadowBlur: 8,
          backgroundEnabled: true,
          backgroundColor: '#222222',
          paddingX: 18,
          paddingY: 12,
        },
        words: [
          { word: 'Shared', startTime: 0, endTime: 1 },
          { word: 'Caption', startTime: 1, endTime: 2.5 },
          { word: 'Subtitle', startTime: 2.5, endTime: 4 },
        ],
      },
    }

    const captionState: ProjectState = {
      id: 'p1',
      name: 'Caption Project',
      settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000 },
      assets: {},
      tracks: [track1],
      items: { 'cap-1': captionItem },
      playheadTime: 0,
      selectedItemId: 'cap-1',
    }

    const html = renderToStaticMarkup(<InspectorPanel state={captionState} dispatch={vi.fn()} />)

    // Subtitle Content & Presets
    expect(html).toContain('Subtitle Content')
    expect(html).toContain('Shared Caption Subtitle')
    expect(html).toContain('Caption Presets')

    // Shared Style & Typography
    expect(html).toContain('Style &amp; Typography')
    expect(html).toContain('Font')
    expect(html).toContain('Weight')
    expect(html).toContain('Tracking')
    expect(html).toContain('Line Spacing')

    // Shared Drop Shadow & Background
    expect(html).toContain('Drop Shadow')
    expect(html).toContain('Background')
    expect(html).toContain('inspector-header-toggle')

    // Caption-specific Word Animation & Timing
    expect(html).toContain('Word Animation')
    expect(html).toContain('Word Timing')
    expect(html).toContain('Shared')
    expect(html).toContain('Caption')
    expect(html).toContain('Subtitle')
  })
})



