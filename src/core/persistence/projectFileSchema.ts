import type { ProjectSettings } from '../project/projectState'
import type { MediaAsset } from '../media/types'
import type { Track, TimelineItem, TimelineTransition } from '../timeline/types'
import type { CaptionTranscript } from '../captions/types'

export const CURRENT_PROJECT_SCHEMA_VERSION = 2
export const PROJECT_FILE_EXTENSION = '.aiditor'
export const AIDITOR_SCHEMA_URL = 'https://aiditor.app/schema/v2.json'
export const CURRENT_APP_VERSION = '0.1.0'

export interface AiditorProjectData {
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
  playheadTime: number
  selectedItemId: string | null
}

export interface AiditorProjectFile {
  $schema: string
  schemaVersion: number
  appVersion: string
  savedAt: string
  project: AiditorProjectData
}

export interface ValidationResult {
  isValid: boolean
  error?: string
  data?: AiditorProjectFile
}
