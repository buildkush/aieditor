import { describe, it, expect } from 'vitest'
import { createEmptyProjectState, type ProjectState } from '../project/projectState'
import {
  serializeProject,
  deserializeProject,
  validateProjectFile,
} from './projectSerializer'
import { CURRENT_PROJECT_SCHEMA_VERSION } from './projectFileSchema'
import { ProjectStore } from '../../store/projectStore'
import {
  AddMediaAssetCommand,
  SetPlayheadCommand,
} from '../commands/editorCommand'

describe('Project Persistence (.aiditor)', () => {
  function createSampleProject(): ProjectState {
    let state = createEmptyProjectState({
      name: 'Persistence Test Project',
      projectFolder: 'C:\\Videos\\Aiditor Projects',
      settings: { width: 1080, height: 1920, fps: 30 },
    })

    // Add media assets
    state = {
      ...state,
      assets: {
        'asset-v1': {
          id: 'asset-v1',
          name: 'clip1.mp4',
          type: 'video',
          path: 'C:\\Videos\\clip1.mp4',
          duration: 20,
          metadata: { width: 1080, height: 1920, fps: 30, duration: 20 },
        },
        'asset-a1': {
          id: 'asset-a1',
          name: 'music.mp3',
          type: 'audio',
          path: 'C:\\Audio\\music.mp3',
          duration: 60,
          metadata: { duration: 60, sampleRate: 48000 },
        },
      },
      items: {
        'item-1': {
          id: 'item-1',
          trackId: 'track-v1',
          assetId: 'asset-v1',
          startTime: 2,
          duration: 8,
          sourceIn: 5,
          sourceOut: 13,
          transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
        },
      },
      playheadTime: 4.5,
      selectedItemId: 'item-1',
    }

    return state
  }

  it('serializes ProjectState to versioned .aiditor JSON', () => {
    const project = createSampleProject()
    const json = serializeProject(project, 'C:\\test\\myproject.aiditor')

    expect(typeof json).toBe('string')
    const parsed = JSON.parse(json)

    expect(parsed.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION)
    expect(parsed.$schema).toContain(`schema/v${CURRENT_PROJECT_SCHEMA_VERSION}.json`)
    expect(parsed.project.name).toBe('Persistence Test Project')
    expect(parsed.project.projectFilePath).toBe('C:\\test\\myproject.aiditor')
    expect(parsed.project.settings.width).toBe(1080)
    expect(parsed.project.settings.height).toBe(1920)
    expect(parsed.project.assets['asset-v1'].path).toBe('C:\\Videos\\clip1.mp4')
    expect(parsed.project.items['item-1'].sourceIn).toBe(5)
    expect(parsed.project.items['item-1'].sourceOut).toBe(13)
    expect(parsed.project.playheadTime).toBe(4.5)
  })

  it('round-trip deserialization restores exact ProjectState', () => {
    const original = createSampleProject()
    const filePath = 'C:\\Projects\\Awesome.aiditor'
    const serialized = serializeProject(original, filePath)

    const { state: restored, missingAssets, projectFilePath } = deserializeProject(serialized)

    expect(missingAssets).toHaveLength(0)
    expect(projectFilePath).toBe(filePath)
    expect(restored.id).toBe(original.id)
    expect(restored.name).toBe(original.name)
    expect(restored.projectFolder).toBe(original.projectFolder)
    expect(restored.settings).toEqual(original.settings)
    expect(restored.tracks).toEqual(original.tracks)
    expect(restored.items).toEqual(original.items)
    expect(restored.playheadTime).toBe(original.playheadTime)
    expect(restored.selectedItemId).toBe(original.selectedItemId)
    expect(restored.assets['asset-v1']).toEqual(original.assets['asset-v1'])
    expect(restored.assets['asset-a1']).toEqual(original.assets['asset-a1'])
  })

  it('validates schema version and rejects unsupported future schemas', () => {
    const original = createSampleProject()
    const json = serializeProject(original)
    const data = JSON.parse(json)

    // Future version
    data.schemaVersion = 999
    const validation = validateProjectFile(data)
    expect(validation.isValid).toBe(false)
    expect(validation.error).toContain('Unsupported project schema version 999')

    expect(() => deserializeProject(JSON.stringify(data))).toThrow(/Unsupported project schema version 999/)
  })

  it('validates project file structure and rejects malformed formats', () => {
    expect(validateProjectFile(null).isValid).toBe(false)
    expect(validateProjectFile('string').isValid).toBe(false)
    expect(validateProjectFile({ schemaVersion: 'not-a-number' }).isValid).toBe(false)
    expect(validateProjectFile({ schemaVersion: 1 }).isValid).toBe(false)
    expect(
      validateProjectFile({
        schemaVersion: 1,
        project: { id: '', name: 'Test' },
      }).isValid
    ).toBe(false)
  })

  it('gracefully handles missing source media without crashing or deleting assets', () => {
    const original = createSampleProject()
    const serialized = serializeProject(original)

    // Mock file checker where clip1.mp4 is missing
    const checkFileExists = (path: string) => {
      if (path.includes('clip1.mp4')) return false
      return true
    }

    const { state: restored, missingAssets } = deserializeProject(serialized, { checkFileExists })

    expect(missingAssets).toContain('clip1.mp4')
    // Asset still exists in projectState!
    expect(restored.assets['asset-v1']).toBeDefined()
    expect(restored.assets['asset-v1'].isMissing).toBe(true)
    // Non-missing asset is not marked missing
    expect(restored.assets['asset-a1'].isMissing).toBeFalsy()
    // Timeline items referencing the missing asset are PRESERVED!
    expect(restored.items['item-1']).toBeDefined()
    expect(restored.items['item-1'].assetId).toBe('asset-v1')
  })

  it('tracks dirty and unsaved state correctly through ProjectStore', () => {
    const original = createSampleProject()
    const store = new ProjectStore(original, 'C:\\test\\project.aiditor')

    // Initial state is clean
    expect(store.getIsDirty()).toBe(false)

    // Non-undoable commands (e.g. SetPlayheadCommand) do NOT mark dirty
    store.dispatch(new SetPlayheadCommand(10))
    expect(store.getIsDirty()).toBe(false)

    // Editing command (e.g. AddMediaAssetCommand) marks project as dirty
    store.dispatch(
      new AddMediaAssetCommand({
        id: 'new-asset',
        name: 'new.mp4',
        type: 'video',
        path: 'C:\\Videos\\new.mp4',
      })
    )
    expect(store.getIsDirty()).toBe(true)

    // Undo reverts back to clean state
    store.undo()
    expect(store.getIsDirty()).toBe(false)

    // Redo makes it dirty again
    store.redo()
    expect(store.getIsDirty()).toBe(true)

    // Marking clean (e.g. after save) resets dirty flag
    store.markClean('C:\\test\\saved.aiditor')
    expect(store.getIsDirty()).toBe(false)
    expect(store.getProjectFilePath()).toBe('C:\\test\\saved.aiditor')
  })
})
