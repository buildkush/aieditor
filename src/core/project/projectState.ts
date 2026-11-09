import type { MediaAsset } from '../media/types'
import type { Track, TimelineItem, TimelineTransition } from '../timeline/types'
import type { CaptionTranscript } from '../captions/types'

export interface ProjectSettings {
  width: number
  height: number
  fps: number
  sampleRate: number
}

export const DEFAULT_PROJECT_SETTINGS: Readonly<ProjectSettings> = Object.freeze({
  width: 1920,
  height: 1080,
  fps: 30,
  sampleRate: 48000,
})

export interface ProjectState {
  id: string
  name: string
  projectFolder?: string
  projectFilePath?: string
  settings: ProjectSettings
  assets: Record<string, MediaAsset>
  tracks: Track[]
  items: Record<string, TimelineItem>
  transitions?: Record<string, TimelineTransition>
  captionTranscripts?: Record<string, CaptionTranscript>
  selectedTransitionId?: string | null
  playheadTime: number
  selectedItemId: string | null
  selectedItemIds?: string[]
}

export interface CreateProjectOptions {
  id?: string
  name?: string
  projectFolder?: string
  projectFilePath?: string
  settings?: Partial<ProjectSettings>
  initialTracks?: Track[]
}

/**
 * Creates a new empty ProjectState with sensible defaults.
 * ProjectState is the single source of truth for all editing and rendering.
 */
export function createEmptyProjectState(options?: CreateProjectOptions): ProjectState {
  const id = options?.id ?? 'project-1'
  const name = options?.name ?? 'Untitled Project'
  const projectFolder = options?.projectFolder
  const projectFilePath = options?.projectFilePath
  const settings: ProjectSettings = {
    ...DEFAULT_PROJECT_SETTINGS,
    ...options?.settings,
  }

  const defaultTracks: Track[] = options?.initialTracks ?? []

  return {
    id,
    name,
    projectFolder,
    projectFilePath,
    settings,
    assets: {},
    tracks: defaultTracks,
    items: {},
    transitions: {},
    selectedTransitionId: null,
    playheadTime: 0,
    selectedItemId: null,
    selectedItemIds: [],
  }
}
