import type { ProjectState, ProjectSettings } from '../project/projectState'
import type { MediaAsset } from '../media/types'
import type { TimelineItem, Transform, Crop, AudioProperties } from '../timeline/types'
import { isCaptionTranscript } from '../captions/types'
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  AIDITOR_SCHEMA_URL,
  CURRENT_APP_VERSION,
  type AiditorProjectFile,
  type AiditorProjectData,
  type ValidationResult,
} from './projectFileSchema'

export interface DeserializeOptions {
  checkFileExists?: (filePath: string) => boolean
  currentFilePath?: string
}

export interface DeserializedProjectResult {
  state: ProjectState
  missingAssets: string[]
  projectFilePath?: string
  schemaVersion: number
}

/**
 * Serializes ProjectState to an .aiditor JSON string.
 * Strictly maintains architectural separation:
 * - ProjectState is serialized completely
 * - Source media paths are saved immutably
 * - Generated cache / runtime blob URLs are NOT serialized as project state
 */
export function serializeProject(state: ProjectState, projectFilePath?: string): string {
  // Strip out transient runtime-only properties (like runtime blob thumbnail URLs)
  const cleanAssets: Record<string, MediaAsset> = {}
  for (const [id, asset] of Object.entries(state.assets)) {
    const { isMissing, ...persistedAsset } = asset
    // Do not save blob: URLs as thumbnail in persistent file
    const cleanThumbnail =
      persistedAsset.thumbnailUrl && !persistedAsset.thumbnailUrl.startsWith('blob:')
        ? persistedAsset.thumbnailUrl
        : undefined

    cleanAssets[id] = {
      ...persistedAsset,
      thumbnailUrl: cleanThumbnail,
    }
  }

  const projectData: AiditorProjectData = {
    id: state.id,
    name: state.name,
    projectFolder: state.projectFolder,
    projectFilePath: projectFilePath ?? state.projectFilePath,
    settings: { ...state.settings },
    assets: cleanAssets,
    tracks: state.tracks.map((t) => ({ ...t })),
    items: { ...state.items },
    transitions: state.transitions ? { ...state.transitions } : {},
    ...(state.captionTranscripts ? { captionTranscripts: state.captionTranscripts } : {}),
    playheadTime: state.playheadTime,
    selectedItemId: state.selectedItemId,
  }

  const projectFile: AiditorProjectFile = {
    $schema: AIDITOR_SCHEMA_URL,
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    appVersion: CURRENT_APP_VERSION,
    savedAt: new Date().toISOString(),
    project: projectData,
  }

  return JSON.stringify(projectFile, null, 2)
}

/**
 * Validates the structure and types of an .aiditor project file.
 */
export function validateProjectFile(data: unknown): ValidationResult {
  if (!data || typeof data !== 'object') {
    return { isValid: false, error: 'Project file must be a JSON object' }
  }

  const candidate = data as Partial<AiditorProjectFile>

  if (typeof candidate.schemaVersion !== 'number') {
    return { isValid: false, error: 'Missing or invalid schemaVersion' }
  }

  if (candidate.schemaVersion > CURRENT_PROJECT_SCHEMA_VERSION) {
    return {
      isValid: false,
      error: `Unsupported project schema version ${candidate.schemaVersion}. This app supports up to version ${CURRENT_PROJECT_SCHEMA_VERSION}. Please update aiditor.`,
    }
  }

  if (candidate.schemaVersion < 1) {
    return { isValid: false, error: 'Invalid schemaVersion: must be >= 1' }
  }

  if (!candidate.project || typeof candidate.project !== 'object') {
    return { isValid: false, error: 'Missing "project" object in project file' }
  }

  const proj = candidate.project as Partial<AiditorProjectData>

  if (typeof proj.id !== 'string' || !proj.id.trim()) {
    return { isValid: false, error: 'Project must have a valid non-empty id' }
  }

  if (typeof proj.name !== 'string') {
    return { isValid: false, error: 'Project must have a valid name string' }
  }

  // Validate settings
  if (!proj.settings || typeof proj.settings !== 'object') {
    return { isValid: false, error: 'Project must have a valid settings object' }
  }

  const settings = proj.settings as Partial<ProjectSettings>
  if (
    typeof settings.width !== 'number' ||
    typeof settings.height !== 'number' ||
    typeof settings.fps !== 'number' ||
    settings.width <= 0 ||
    settings.height <= 0 ||
    settings.fps <= 0
  ) {
    return { isValid: false, error: 'Project settings must include positive width, height, and fps' }
  }

  // Validate tracks
  if (!Array.isArray(proj.tracks)) {
    return { isValid: false, error: 'Project tracks must be an array' }
  }

  for (const track of proj.tracks) {
    if (!track || typeof track.id !== 'string' || typeof track.name !== 'string' || typeof track.type !== 'string') {
      return { isValid: false, error: 'Each track must have id, name, and type' }
    }
  }

  // Validate items
  if (!proj.items || typeof proj.items !== 'object') {
    return { isValid: false, error: 'Project items must be an object map' }
  }

  for (const [itemId, item] of Object.entries(proj.items)) {
    if (!item || typeof item !== 'object') {
      return { isValid: false, error: `Invalid item format for item ${itemId}` }
    }
    const tItem = item as Partial<TimelineItem>
    const isGenerated =
      tItem.itemType === 'solid' ||
      tItem.itemType === 'text' ||
      tItem.itemType === 'caption' ||
      !!tItem.solid ||
      !!tItem.text ||
      !!tItem.caption
    const hasValidAssetId = typeof tItem.assetId === 'string' || isGenerated
    if (
      typeof tItem.id !== 'string' ||
      typeof tItem.trackId !== 'string' ||
      !hasValidAssetId ||
      typeof tItem.startTime !== 'number' ||
      typeof tItem.duration !== 'number' ||
      typeof tItem.sourceIn !== 'number' ||
      typeof tItem.sourceOut !== 'number'
    ) {
      return { isValid: false, error: `Timeline item ${itemId} is missing required fields` }
    }
    if (tItem.duration <= 0) {
      return { isValid: false, error: `Timeline item ${itemId} duration must be positive` }
    }
    if (tItem.keyframes !== undefined) {
      if (typeof tItem.keyframes !== 'object' || tItem.keyframes === null) {
        return { isValid: false, error: `Timeline item ${itemId} keyframes must be an object` }
      }
      for (const [prop, kfList] of Object.entries(tItem.keyframes)) {
        if (!Array.isArray(kfList)) {
          return { isValid: false, error: `Timeline item ${itemId} keyframes for ${prop} must be an array` }
        }
        for (const kf of kfList) {
          if (
            typeof kf !== 'object' ||
            kf === null ||
            typeof (kf as any).id !== 'string' ||
            typeof (kf as any).time !== 'number' ||
            typeof (kf as any).value !== 'number'
          ) {
            return { isValid: false, error: `Timeline item ${itemId} contains an invalid keyframe in ${prop}` }
          }
        }
      }
    }
  }

  if (proj.captionTranscripts !== undefined) {
    if (!proj.captionTranscripts || typeof proj.captionTranscripts !== 'object' || Array.isArray(proj.captionTranscripts) || Object.entries(proj.captionTranscripts).some(([id, transcript]) => !isCaptionTranscript(transcript) || transcript.id !== id)) {
      return { isValid: false, error: 'Invalid native caption transcript or word timings' }
    }
  }

  // Validate assets
  if (!proj.assets || typeof proj.assets !== 'object') {
    return { isValid: false, error: 'Project assets must be an object map' }
  }

  for (const [assetId, asset] of Object.entries(proj.assets)) {
    if (!asset || typeof asset !== 'object') {
      return { isValid: false, error: `Invalid asset format for asset ${assetId}` }
    }
    const mAsset = asset as Partial<MediaAsset>
    if (
      typeof mAsset.id !== 'string' ||
      typeof mAsset.name !== 'string' ||
      typeof mAsset.type !== 'string' ||
      typeof mAsset.path !== 'string'
    ) {
      return { isValid: false, error: `Media asset ${assetId} is missing required fields` }
    }
  }

  return {
    isValid: true,
    data: candidate as AiditorProjectFile,
  }
}

/**
 * Deserializes an .aiditor JSON string into a ProjectState.
 * Gracefully marks missing source files as offline without crashing or deleting assets.
 */
export function deserializeProject(
  jsonString: string,
  options?: DeserializeOptions
): DeserializedProjectResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonString)
  } catch (err) {
    throw new Error(`Failed to parse .aiditor file: Invalid JSON (${(err as Error).message})`)
  }

  const validation = validateProjectFile(parsed)
  if (!validation.isValid || !validation.data) {
    throw new Error(`Failed to open project: ${validation.error}`)
  }

  const projectFile = validation.data
  const proj = projectFile.project
  const checkFileExists = options?.checkFileExists
  const missingAssets: string[] = []

  // Check asset availability
  const processedAssets: Record<string, MediaAsset> = {}
  for (const [id, asset] of Object.entries(proj.assets)) {
    let isMissing = false
    if (checkFileExists) {
      const exists = checkFileExists(asset.path)
      if (!exists) {
        isMissing = true
        missingAssets.push(asset.name)
      }
    }

    processedAssets[id] = {
      ...asset,
      ...(isMissing ? { isMissing: true } : {}),
    }
  }

  // Ensure default transform if missing, preserve crop if present
  const processedItems: Record<string, TimelineItem> = {}
  for (const [id, item] of Object.entries(proj.items)) {
    const transform: Transform = item.transform ?? {
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      opacity: 1,
    }
    const crop: Crop | undefined = item.crop
      ? {
          left: item.crop.left ?? 0,
          right: item.crop.right ?? 0,
          top: item.crop.top ?? 0,
          bottom: item.crop.bottom ?? 0,
        }
      : undefined
    const audio: AudioProperties | undefined = item.audio
      ? {
          volume: item.audio.volume ?? 1,
          pan: item.audio.pan ?? 0,
          muted: !!item.audio.muted,
        }
      : undefined
    processedItems[id] = {
      ...item,
      transform,
      ...(crop ? { crop } : {}),
      ...(audio ? { audio } : {}),
    }
  }

  const resolvedFilePath = options?.currentFilePath ?? proj.projectFilePath

  const state: ProjectState = {
    id: proj.id,
    name: proj.name,
    projectFolder: proj.projectFolder,
    projectFilePath: resolvedFilePath,
    settings: {
      width: proj.settings.width,
      height: proj.settings.height,
      fps: proj.settings.fps,
      sampleRate: proj.settings.sampleRate || 48000,
    },
    assets: processedAssets,
    tracks: proj.tracks,
    items: processedItems,
    transitions: proj.transitions ? { ...proj.transitions } : {},
    ...(proj.captionTranscripts ? { captionTranscripts: proj.captionTranscripts } : {}),
    selectedTransitionId: null,
    playheadTime: typeof proj.playheadTime === 'number' ? proj.playheadTime : 0,
    selectedItemId: proj.selectedItemId ?? null,
  }

  return {
    state,
    missingAssets,
    projectFilePath: resolvedFilePath,
    schemaVersion: projectFile.schemaVersion,
  }
}
