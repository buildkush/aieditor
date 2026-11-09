import { useState, useMemo } from 'react'
import { setActiveDraggedTool, type ActiveToolDrag } from '../tools/activeDragTool'
import { TRANSITION_DEFINITIONS, type TransitionDefinition } from '../../core/timeline/transitionDefinitions'
import './TransitionBrowser.css'

export type TransitionItem = TransitionDefinition
const BUILTIN_TRANSITIONS = TRANSITION_DEFINITIONS

type TransitionCategoryFilter = 'all' | 'dissolve' | 'motion' | 'wipe' | 'stylized'

export interface TransitionBrowserProps {
  onApplyTransition?: (transition: TransitionItem) => void
}

export function TransitionBrowser({ onApplyTransition }: TransitionBrowserProps) {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<TransitionCategoryFilter>('all')

  const filteredTransitions = useMemo(() => {
    return BUILTIN_TRANSITIONS.filter((tr) => {
      if (activeCategory !== 'all' && tr.category !== activeCategory) {
        return false
      }
      if (search.trim()) {
        const query = search.toLowerCase()
        return (
          tr.name.toLowerCase().includes(query) ||
          tr.description.toLowerCase().includes(query) ||
          tr.category.toLowerCase().includes(query)
        )
      }
      return true
    })
  }, [search, activeCategory])

  return (
    <div className="transition-browser">
      <div className="transition-browser-header">
        <div className="transition-search-box">
          <span className="transition-search-icon">🔍</span>
          <input
            type="text"
            className="transition-search-input"
            placeholder="Search transitions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="transition-search-clear"
              onClick={() => setSearch('')}
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Category Pills */}
        <div className="transition-category-tabs">
          <button
            className={`transition-cat-btn ${activeCategory === 'all' ? 'active' : ''}`}
            onClick={() => setActiveCategory('all')}
          >
            All ({BUILTIN_TRANSITIONS.length})
          </button>
          <button
            className={`transition-cat-btn ${activeCategory === 'dissolve' ? 'active' : ''}`}
            onClick={() => setActiveCategory('dissolve')}
          >
            Dissolve
          </button>
          <button
            className={`transition-cat-btn ${activeCategory === 'motion' ? 'active' : ''}`}
            onClick={() => setActiveCategory('motion')}
          >
            Motion
          </button>
          <button
            className={`transition-cat-btn ${activeCategory === 'wipe' ? 'active' : ''}`}
            onClick={() => setActiveCategory('wipe')}
          >
            Wipe
          </button>
          <button
            className={`transition-cat-btn ${activeCategory === 'stylized' ? 'active' : ''}`}
            onClick={() => setActiveCategory('stylized')}
          >
            Stylized
          </button>
        </div>
      </div>

      <div className="transition-list-container">
        {filteredTransitions.length === 0 ? (
          <div className="transition-empty-state">
            <span className="transition-empty-icon">🔀</span>
            <h4>No transitions found</h4>
            <p>Try searching for dissolve, push, glitch, or wipe.</p>
            {search && (
              <button
                className="transition-reset-search-btn"
                onClick={() => setSearch('')}
              >
                Reset Search
              </button>
            )}
          </div>
        ) : (
          <div className="transition-grid">
            {filteredTransitions.map((tr) => (
              <div
                key={tr.id}
                className="transition-card"
                draggable={true}
                onDragStart={(e) => {
                  const dragPayload: ActiveToolDrag = {
                    type: 'transition',
                    dragType: 'transition',
                    transitionId: tr.id,
                    name: tr.name,
                    category: tr.category,
                    duration: tr.defaultDurationSec ?? 1.0,
                  }
                  setActiveDraggedTool(dragPayload)
                  e.dataTransfer.setData('application/aiditor-tool', JSON.stringify(dragPayload))
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onDragEnd={() => setActiveDraggedTool(null)}
                onClick={() => onApplyTransition?.(tr)}
                title={`${tr.name} (${tr.defaultDurationSec}s) — ${tr.description}`}
              >
                <div className="transition-card-header">
                  <span className="transition-card-icon">{tr.icon}</span>
                  <div className="transition-card-meta">
                    <span className="transition-card-title">{tr.name}</span>
                    <span className="transition-card-subcat">
                      {tr.category.toUpperCase()} • {tr.defaultDurationSec}s
                    </span>
                  </div>
                </div>
                <p className="transition-card-desc">{tr.description}</p>
                <div className="transition-card-footer">
                  <span className="transition-apply-hint">Click or drag between clips</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
