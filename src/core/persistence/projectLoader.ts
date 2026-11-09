import { ProjectStore } from '../../store/projectStore'
import { deserializeProject } from './projectSerializer'
import { addRecentProject } from './recentProjects'
import type { ProjectState } from '../project/projectState'

async function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__?.invoke) {
    try {
      return await (window as any).__TAURI_INTERNALS__.invoke(cmd, args)
    } catch (err) {
      console.warn(`tauri invoke ${cmd} error:`, err)
      return null
    }
  }
  return null
}

export interface OpenProjectResult {
  store: ProjectStore
  state: ProjectState
  missingAssets: string[]
  filePath?: string
}

/**
 * Opens an .aiditor project file from disk (via native dialog or specified path).
 */
export async function openProjectFromFile(specifiedPath?: string): Promise<OpenProjectResult | null> {
  let targetPath = specifiedPath

  if (!targetPath) {
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const chosen = await tauriInvoke<string>('pick_project_file')
      if (!chosen) return null
      targetPath = chosen
    } else {
      return null
    }
  }

  try {
    let content: string | null = null

    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      content = await tauriInvoke<string>('read_project_file', { path: targetPath })
    }

    if (!content) {
      throw new Error(`Failed to read project file at: ${targetPath}`)
    }

    // Check file existence for assets
    const checkFileExists = (_assetPath: string) => {
      // In Tauri, we can check synchronously or asynchronously;
      // for fast initial check we invoke check_file_exists or assume online
      return true
    }

    const { state, missingAssets } = deserializeProject(content, {
      checkFileExists,
      currentFilePath: targetPath,
    })

    // Validate actual existence of asset files asynchronously if in Tauri
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      for (const [id, asset] of Object.entries(state.assets)) {
        const exists = await tauriInvoke<boolean>('check_file_exists', { path: asset.path })
        if (exists === false) {
          state.assets[id] = { ...asset, isMissing: true }
          if (!missingAssets.includes(asset.name)) {
            missingAssets.push(asset.name)
          }
        }
      }
    }

    await addRecentProject(targetPath, state.name)

    const store = new ProjectStore(state, targetPath)
    return {
      store,
      state,
      missingAssets,
      filePath: targetPath,
    }
  } catch (err) {
    console.error('Failed to open project:', err)
    alert(`Could not open project: ${(err as Error).message}`)
    return null
  }
}

/**
 * Loads project from an already-read JSON string (e.g. from browser drag-drop or file upload).
 */
export function openProjectFromContent(jsonString: string, fileName?: string): OpenProjectResult {
  const { state, missingAssets } = deserializeProject(jsonString)
  const store = new ProjectStore(state)
  return {
    store,
    state,
    missingAssets,
    filePath: fileName,
  }
}
