export interface RecentProject {
  path: string
  name: string
  lastOpened: string
}

const LOCAL_STORAGE_KEY = 'aiditor_recent_projects_v1'

async function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__?.invoke) {
    try {
      return await (window as any).__TAURI_INTERNALS__.invoke(cmd, args)
    } catch {
      return null
    }
  }
  return null
}

export async function loadRecentProjects(): Promise<RecentProject[]> {
  // 1. Try Tauri backend
  const tauriRecents = await tauriInvoke<RecentProject[]>('get_recent_projects')
  if (tauriRecents && Array.isArray(tauriRecents) && tauriRecents.length > 0) {
    // Keep localStorage in sync
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(tauriRecents))
    } catch {
      // ignore
    }
    return tauriRecents
  }

  // 2. Fallback to localStorage
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed
      }
    }
  } catch {
    // ignore
  }

  return []
}

export async function addRecentProject(path: string, name: string): Promise<RecentProject[]> {
  const now = new Date().toISOString()

  // 1. Try Tauri backend
  const tauriResult = await tauriInvoke<RecentProject[]>('add_recent_project', {
    path,
    name,
    lastOpened: now,
  })

  if (tauriResult && Array.isArray(tauriResult)) {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(tauriResult))
    } catch {
      // ignore
    }
    return tauriResult
  }

  // 2. Fallback to localStorage
  if (typeof localStorage === 'undefined') return []
  try {
    const current = await loadRecentProjects()
    const filtered = current.filter((item) => item.path !== path)
    const updated: RecentProject[] = [
      {
        path,
        name,
        lastOpened: now,
      },
      ...filtered,
    ].slice(0, 20)

    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated))
    return updated
  } catch {
    return []
  }
}

export async function removeRecentProject(path: string): Promise<RecentProject[]> {
  const current = await loadRecentProjects()
  const updated = current.filter((item) => item.path !== path)

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated))
    } catch {
      // ignore
    }
  }

  return updated
}

export async function clearRecentProjects(): Promise<void> {
  await tauriInvoke('clear_recent_projects')
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY)
    } catch {
      // ignore
    }
  }
}
