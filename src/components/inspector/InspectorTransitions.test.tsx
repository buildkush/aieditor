import { describe, expect, it, vi } from 'vitest'
// @ts-ignore — Installed react-dom typings omit the server entry point.
import { renderToStaticMarkup } from 'react-dom/server'
import { InspectorPanel } from './InspectorPanel'
import { createEmptyProjectState } from '../../core/project/projectState'
import { DEFAULT_TRANSFORM, type TimelineItem } from '../../core/timeline/types'
import { SelectTransitionCommand, SelectItemCommand, RemoveTransitionCommand } from '../../core/commands/editorCommand'
import { getClipTransitions } from '../../core/commands/projectCommands'
import { ProjectStore } from '../../store/projectStore'

const clip: TimelineItem = { id: 'clip', trackId: 'v1', assetId: 'media', startTime: 0, duration: 8,
  sourceIn: 0, sourceOut: 8, transform: { ...DEFAULT_TRANSFORM } }
function project() {
  return { ...createEmptyProjectState(), tracks: [{ id: 'v1', name: 'Video 1', type: 'video' as const }],
    items: { clip }, selectedItemId: 'clip', transitions: {
      start: { id: 'start', transitionId: 'tr-glitch', name: 'Digital Glitch', trackId: 'v1', startTime: 0, duration: 1, rightClipId: 'clip' },
      end: { id: 'end', transitionId: 'tr-cross-dissolve', name: 'Cross Dissolve', trackId: 'v1', startTime: 7, duration: 1, leftClipId: 'clip' },
    } }
}

describe('clip transition Inspector', () => {
  it('shows both transitions in one list with only their names and placement tags', () => {
    const html = renderToStaticMarkup(<InspectorPanel state={project()} dispatch={vi.fn()} forcedTab="transitions" />)
    expect(html).toContain('Digital Glitch (start)')
    expect(html).toContain('Cross Dissolve (end)')
    expect(html).toContain('inspector-transition-position">Start</span>')
    expect(html).toContain('inspector-transition-position">End</span>')
    expect(html).not.toContain('aria-label="Transition attachment"')
    expect(html).toContain('aria-label="Transition alignment"')
    expect(html).toContain('aria-label="Align transition left"')
    expect(html).toContain('aria-label="Align transition center"')
    expect(html).toContain('aria-label="Align transition right"')
    expect(html).not.toContain('Each clip supports')
    expect(html).not.toContain('In-Transition (Start of Clip)')
    expect(html).not.toContain('Out-Transition (End of Clip)')
    expect(html).not.toContain('>Active<')
  })

  it('keeps a selected transition without replacing the clip list or disabling Video', () => {
    const state = new SelectTransitionCommand('end').execute(project())
    expect(state.selectedItemId).toBe('clip')
    const html = renderToStaticMarkup(<InspectorPanel state={state} dispatch={vi.fn()} forcedTab="effects" />)
    expect(html).toContain('Digital Glitch (start)')
    expect(html).toContain('Cross Dissolve (end)')
    expect(html).not.toContain('inspector-transition-card selected')
    expect(html).toContain('data-transition-id="end"')
    expect(html).toContain('title="Video transforms, crop, composite, speed"')
    expect(html).not.toContain('No Transition Selected')
  })

  it('retains the list when opening an older transition-only selection', () => {
    const state = { ...project(), selectedItemId: null, selectedItemIds: [], selectedTransitionId: 'start' }
    const html = renderToStaticMarkup(<InspectorPanel state={state} dispatch={vi.fn()} />)
    expect(html).toContain('Digital Glitch (start)')
    expect(html).toContain('Cross Dissolve (end)')
  })

  it('disables Transitions and falls back to Video even when an empty tab is forced', () => {
    const state = { ...project(), transitions: {} }
    const html = renderToStaticMarkup(<InspectorPanel state={state} dispatch={vi.fn()} forcedTab="transitions" />)
    expect(html).not.toContain('Add start transition')
    expect(html).toContain('disabled="" title="No transitions applied (disabled until attached)"')
    expect(html).not.toContain('class="inspector-transitions-tab"')
    expect(html).toContain('class="inspector-tab-btn active "')
    expect(html).not.toContain('Add end transition')
    expect(html).not.toContain('No in-transition applied')
    expect(html).not.toContain('No out-transition applied')
  })


  it('disables the tab after deleting the last applied transition', () => {
    const original = project()
    const single = { ...original, transitions: { end: original.transitions.end } }
    const selected = new SelectTransitionCommand('end').execute(single)
    const removed = new RemoveTransitionCommand('end').execute(selected)
    const html = renderToStaticMarkup(<InspectorPanel state={removed} dispatch={vi.fn()} forcedTab="transitions" />)
    expect(html).toContain('disabled="" title="No transitions applied (disabled until attached)"')
    expect(html).not.toContain('class="inspector-transitions-tab"')
  })

  it('keeps the current owner of a shared transition, or chooses its incoming clip', () => {
    const right = { ...clip, id: 'right', startTime: 8 }
    const state = { ...project(), items: { clip, right }, transitions: { shared: {
      id: 'shared', transitionId: 'tr-push-left', name: 'Push', trackId: 'v1', startTime: 7.5, duration: 1, leftClipId: 'clip', rightClipId: 'right',
    } } }
    expect(new SelectTransitionCommand('shared').execute(state).selectedItemId).toBe('clip')
    const deselected = new SelectItemCommand(null).execute(state)
    const selected = new SelectTransitionCommand('shared').execute(deselected)
    expect(selected.selectedItemId).toBe('right')
    const removed = new RemoveTransitionCommand('shared').execute(selected)
    expect(Object.keys(removed.items)).toHaveLength(2)
    expect(removed.selectedItemId).toBe('right')
    expect(removed.selectedTransitionId).toBeNull()
  })

  it('labels a full-length outgoing transition as End', () => {
    const original = project()
    const state = { ...original, transitions: { ...original.transitions,
      end: { ...original.transitions.end, startTime: 0, duration: 8 },
    } }
    expect(getClipTransitions(state, 'clip').endTransition?.id).toBe('end')
  })

  it('highlighting a transition does not dirty the project or add an undo step', () => {
    const store = new ProjectStore(project())
    store.dispatch(new SelectTransitionCommand('end'))
    expect(store.getState().selectedTransitionId).toBe('end')
    expect(store.getIsDirty()).toBe(false)
    expect(store.canUndo()).toBe(false)
  })
})
