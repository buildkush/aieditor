import type { ProjectState } from '../project/projectState'
import { serializeProject, deserializeProject } from './projectSerializer'

const AUTOSAVE_KEY_PREFIX = 'aiditor_autosave_'
const LATEST_AUTOSAVE_ID_KEY = 'aiditor_latest_autosave_id'

export interface AutosaveEntry {
  state: ProjectState
  savedAt: string
  filePath?: string
}

export function saveAutosave(state: ProjectState, filePath?: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    const serialized = serializeProject(state, filePath)
    const payload = JSON.stringify({
      savedAt: new Date().toISOString(),
      filePath: filePath ?? state.projectFilePath,
      serialized,
    })

    localStorage.setItem(`${AUTOSAVE_KEY_PREFIX}${state.id}`, payload)
    localStorage.setItem(LATEST_AUTOSAVE_ID_KEY, state.id)
  } catch (err) {
    console.warn('Autosave failed:', err)
  }
}

export function loadAutosave(projectId?: string): AutosaveEntry | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const id = projectId ?? localStorage.getItem(LATEST_AUTOSAVE_ID_KEY)
    if (!id) return null

    const raw = localStorage.getItem(`${AUTOSAVE_KEY_PREFIX}${id}`)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    const { state, projectFilePath } = deserializeProject(parsed.serialized)
    return {
      state,
      savedAt: parsed.savedAt,
      filePath: parsed.filePath ?? projectFilePath,
    }
  } catch (err) {
    console.warn('Failed to load autosave:', err)
    return null
  }
}

export function clearAutosave(projectId?: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    const id = projectId ?? localStorage.getItem(LATEST_AUTOSAVE_ID_KEY)
    if (id) {
      localStorage.removeItem(`${AUTOSAVE_KEY_PREFIX}${id}`)
    }
    if (!projectId || projectId === localStorage.getItem(LATEST_AUTOSAVE_ID_KEY)) {
      localStorage.removeItem(LATEST_AUTOSAVE_ID_KEY)
    }
  } catch {
    // ignore
  }
}

export function hasAutosave(projectId?: string): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    const id = projectId ?? localStorage.getItem(LATEST_AUTOSAVE_ID_KEY)
    if (!id) return false
    return !!localStorage.getItem(`${AUTOSAVE_KEY_PREFIX}${id}`)
  } catch {
    return false
  }
}
