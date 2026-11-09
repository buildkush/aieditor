import { useState, useCallback, useEffect, lazy, Suspense } from 'react'
import { ProjectStore, ProjectStoreProvider } from './store/projectStore'
import { WelcomeScreen, type NewProjectConfig } from './components/welcome/WelcomeScreen'
import { EditorShell } from './components/editor/EditorShell'
import { TitleBar } from './components/titlebar/TitleBar'
import { createEmptyProjectState } from './core/project/projectState'
import { createDemoProject } from './core/demoProject'

const SpeechLab = import.meta.env.DEV ? lazy(() => import('./speech-lab/ui/SpeechLab')) : null

export function App() {
  const [store, setStore] = useState<ProjectStore | null>(null)
  const [speechLabOpen, setSpeechLabOpen] = useState(import.meta.env.DEV && typeof window !== 'undefined' && window.location.hash === '#/speech-lab')
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onHash = () => setSpeechLabOpen(window.location.hash === '#/speech-lab')
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && (event.code === 'KeyL' || event.key.toLowerCase() === 'l')) {
        event.preventDefault(); setSpeechLabOpen(true); window.location.hash = '/speech-lab'
      }
    }
    window.addEventListener('hashchange', onHash)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('keydown', onKey) }
  }, [])

  const handleCreateProject = useCallback((config: NewProjectConfig) => {
    const project = createEmptyProjectState({
      name: config.name,
      projectFolder: config.projectFolder,
      settings: config.settings,
    })
    setStore(new ProjectStore(project))
  }, [])

  const handleLoadDemo = useCallback(() => {
    const demo = createDemoProject()
    setStore(new ProjectStore(demo))
  }, [])

  const handleOpenProject = useCallback((openedStore: ProjectStore) => {
    setStore(openedStore)
  }, [])

  const handleCloseProject = useCallback(() => {
    setStore(null)
  }, [])

  if (SpeechLab && speechLabOpen) return <Suspense fallback={<div>Opening Speech Lab…</div>}><SpeechLab onClose={() => { window.location.hash = ''; setSpeechLabOpen(false) }} /></Suspense>

  if (!store) {
    return (
      <div className="aiditor-app-root">
        <TitleBar />
        {import.meta.env.DEV && <button className="recovery-btn secondary" style={{ position: 'absolute', top: 44, right: 20, zIndex: 5 }}
          onClick={() => { setSpeechLabOpen(true); window.location.hash = '/speech-lab' }} title="Development only · Ctrl+Shift+L">Developer · Speech Lab</button>}
        <WelcomeScreen
          onCreateProject={handleCreateProject}
          onLoadDemo={handleLoadDemo}
          onOpenProject={handleOpenProject}
        />
      </div>
    )
  }

  return (
    <div className="aiditor-app-root">
      <ProjectStoreProvider store={store}>
        <EditorShell
          onCloseProject={handleCloseProject}
          onOpenProject={handleOpenProject}
          onNewProject={handleCloseProject}
        />
      </ProjectStoreProvider>
    </div>
  )
}

export default App
