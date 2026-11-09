import type { ProjectState } from './project/projectState'
import { createEmptyProjectState } from './project/projectState'
import { DEFAULT_TRANSFORM } from './timeline/types'
import type { MediaAsset } from './media/types'
import type { TimelineItem } from './timeline/types'

/**
 * Creates a demo ProjectState with sample assets, tracks, and timeline items.
 * This uses the exact same ProjectState and data model as a user-created project.
 * There is no fake UI-only demo state.
 */
export function createDemoProject(): ProjectState {
  // Start with a standard project
  let project = createEmptyProjectState({
    id: 'demo-project',
    name: 'Demo Project',
    settings: {
      width: 1920,
      height: 1080,
      fps: 30,
      sampleRate: 48000,
    },
    initialTracks: [
      { id: 'track-v2', name: 'Video 2', type: 'video', visible: true, locked: false },
      { id: 'track-v1', name: 'Video 1', type: 'video', visible: true, locked: false },
      { id: 'track-a1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
    ],
  })

  // --- Demo media assets ---
  const videoAsset1: MediaAsset = {
    id: 'demo-asset-video-1',
    name: 'Intro.mp4',
    type: 'video',
    path: '/demo/Intro.mp4',
    duration: 15,
    metadata: { width: 1920, height: 1080, fps: 30, duration: 15 },
  }

  const videoAsset2: MediaAsset = {
    id: 'demo-asset-video-2',
    name: 'Main Content.mp4',
    type: 'video',
    path: '/demo/MainContent.mp4',
    duration: 45,
    metadata: { width: 1920, height: 1080, fps: 30, duration: 45 },
  }

  const videoAsset3: MediaAsset = {
    id: 'demo-asset-video-3',
    name: 'B-Roll.mp4',
    type: 'video',
    path: '/demo/BRoll.mp4',
    duration: 20,
    metadata: { width: 1920, height: 1080, fps: 30, duration: 20 },
  }

  const audioAsset: MediaAsset = {
    id: 'demo-asset-audio-1',
    name: 'Background Music.mp3',
    type: 'audio',
    path: '/demo/BackgroundMusic.mp3',
    duration: 60,
    metadata: { sampleRate: 48000, audioChannels: 2, duration: 60 },
  }

  project = {
    ...project,
    assets: {
      [videoAsset1.id]: videoAsset1,
      [videoAsset2.id]: videoAsset2,
      [videoAsset3.id]: videoAsset3,
      [audioAsset.id]: audioAsset,
    },
  }

  // --- Demo timeline items ---
  const introClip: TimelineItem = {
    id: 'demo-item-intro',
    trackId: 'track-v1',
    assetId: videoAsset1.id,
    startTime: 0,
    duration: 10,
    sourceIn: 2,
    sourceOut: 12,
    transform: DEFAULT_TRANSFORM,
  }

  const mainClip: TimelineItem = {
    id: 'demo-item-main',
    trackId: 'track-v1',
    assetId: videoAsset2.id,
    startTime: 10,
    duration: 20,
    sourceIn: 5,
    sourceOut: 25,
    transform: DEFAULT_TRANSFORM,
  }

  const brollClip: TimelineItem = {
    id: 'demo-item-broll',
    trackId: 'track-v2',
    assetId: videoAsset3.id,
    startTime: 12,
    duration: 10,
    sourceIn: 0,
    sourceOut: 10,
    transform: {
      ...DEFAULT_TRANSFORM,
      scale: 0.5,
      x: 350,
      y: 180,
    },
  }

  const musicClip: TimelineItem = {
    id: 'demo-item-music',
    trackId: 'track-a1',
    assetId: audioAsset.id,
    startTime: 0,
    duration: 40,
    sourceIn: 0,
    sourceOut: 40,
    transform: DEFAULT_TRANSFORM,
  }

  project = {
    ...project,
    items: {
      [introClip.id]: introClip,
      [mainClip.id]: mainClip,
      [brollClip.id]: brollClip,
      [musicClip.id]: musicClip,
    },
  }

  return project
}
