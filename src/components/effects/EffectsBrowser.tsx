import { useState, useMemo } from 'react'
import './EffectsBrowser.css'

export interface EffectItem {
  id: string
  name: string
  category: 'video' | 'audio' | 'ai'
  subCategory?: string
  description: string
  icon: string
  isAi?: boolean
}

const BUILTIN_EFFECTS: EffectItem[] = [
  // AI Tools
  {
    id: 'ai-smart-reframe',
    name: 'Smart Auto-Reframe',
    category: 'ai',
    subCategory: 'AI Reframe',
    description: 'Intelligently tracks subjects for 9:16 Shorts & Reels formats',
    icon: '🎯',
    isAi: true,
  },
  {
    id: 'ai-bg-removal',
    name: 'Background Removal',
    category: 'ai',
    subCategory: 'AI Segmentation',
    description: 'Instant AI rotoscoping and background cutout without green screen',
    icon: '✨',
    isAi: true,
  },
  {
    id: 'ai-caption-behind',
    name: 'Depth Layering',
    category: 'ai',
    subCategory: 'AI Compositing',
    description: 'Places animated captions and text behind the main subject',
    icon: '🎭',
    isAi: true,
  },
  {
    id: 'ai-silence-cut',
    name: 'Dead-Air Removal',
    category: 'ai',
    subCategory: 'Audio AI',
    description: 'Automatically detects and ripples away silent pauses and dead air',
    icon: '✂️',
    isAi: true,
  },
  {
    id: 'ai-subject-track',
    name: 'Subject Tracking',
    category: 'ai',
    subCategory: 'AI Motion',
    description: 'Locks graphics, zoom boxes, or highlights to moving objects',
    icon: '🔍',
    isAi: true,
  },

  // Video Effects
  {
    id: 'vf-lumetri-color',
    name: 'Color Grade & LUT',
    category: 'video',
    subCategory: 'Color',
    description: 'Curves, wheels, saturation, vibrance, and creative lookup tables',
    icon: '🎨',
  },
  {
    id: 'vf-gaussian-blur',
    name: 'Gaussian Blur',
    category: 'video',
    subCategory: 'Blur & Sharpen',
    description: 'Smooth multi-pass blur for backgrounds or emphasis',
    icon: '💧',
  },
  {
    id: 'vf-unsharp-mask',
    name: 'Unsharp Mask',
    category: 'video',
    subCategory: 'Blur & Sharpen',
    description: 'Enhances micro-contrast and edge clarity',
    icon: '🔍',
  },
  {
    id: 'vf-vignette',
    name: 'Cinematic Vignette',
    category: 'video',
    subCategory: 'Stylize',
    description: 'Darkens frame edges to draw viewer attention inward',
    icon: '⭕',
  },
  {
    id: 'vf-film-grain',
    name: '35mm Film Grain',
    category: 'video',
    subCategory: 'Stylize',
    description: 'Organic analog texture overlay with variable density',
    icon: '🎞️',
  },
  {
    id: 'vf-chroma-key',
    name: 'Ultra Chroma Key',
    category: 'video',
    subCategory: 'Matte',
    description: 'High-precision green and blue screen color isolation',
    icon: '🟩',
  },

  // Audio Effects
  {
    id: 'af-parametric-eq',
    name: 'Parametric Equalizer',
    category: 'audio',
    subCategory: 'EQ',
    description: '4-band frequency shaping for voice clarity and low-end clean up',
    icon: '🎚️',
  },
  {
    id: 'af-compressor',
    name: 'Voice Dynamics Limiter',
    category: 'audio',
    subCategory: 'Dynamics',
    description: 'Smooths vocal levels and peaks for podcast-ready loudness',
    icon: '🎙️',
  },
  {
    id: 'af-noise-reduction',
    name: 'Denoise & Clean',
    category: 'audio',
    subCategory: 'Restoration',
    description: 'Suppresses background hums, fan noise, and room reflections',
    icon: '🔇',
  },
  {
    id: 'af-reverb',
    name: 'Studio Reverb',
    category: 'audio',
    subCategory: 'Space',
    description: 'Adds spatial dimension and acoustic ambience',
    icon: '🏛️',
  },
]

type CategoryFilter = 'all' | 'video' | 'audio' | 'ai'

export interface EffectsBrowserProps {
  onApplyEffect?: (effect: EffectItem) => void
}

export function EffectsBrowser({ onApplyEffect }: EffectsBrowserProps) {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all')

  const filteredEffects = useMemo(() => {
    return BUILTIN_EFFECTS.filter((eff) => {
      if (activeCategory !== 'all' && eff.category !== activeCategory) {
        return false
      }
      if (search.trim()) {
        const query = search.toLowerCase()
        return (
          eff.name.toLowerCase().includes(query) ||
          eff.description.toLowerCase().includes(query) ||
          eff.subCategory?.toLowerCase().includes(query)
        )
      }
      return true
    })
  }, [search, activeCategory])

  return (
    <div className="effects-browser">
      <div className="effects-browser-header">
        <div className="effects-search-box">
          <span className="effects-search-icon">🔍</span>
          <input
            type="text"
            className="effects-search-input"
            placeholder="Search effects & AI tools…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="effects-search-clear"
              onClick={() => setSearch('')}
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Category Pills */}
        <div className="effects-category-tabs">
          <button
            className={`effects-cat-btn ${activeCategory === 'all' ? 'active' : ''}`}
            onClick={() => setActiveCategory('all')}
          >
            All ({BUILTIN_EFFECTS.length})
          </button>
          <button
            className={`effects-cat-btn ${activeCategory === 'ai' ? 'active' : ''}`}
            onClick={() => setActiveCategory('ai')}
          >
            ✨ AI Tools
          </button>
          <button
            className={`effects-cat-btn ${activeCategory === 'video' ? 'active' : ''}`}
            onClick={() => setActiveCategory('video')}
          >
            🎬 Video
          </button>
          <button
            className={`effects-cat-btn ${activeCategory === 'audio' ? 'active' : ''}`}
            onClick={() => setActiveCategory('audio')}
          >
            🔊 Audio
          </button>
        </div>
      </div>

      <div className="effects-list-container">
        {filteredEffects.length === 0 ? (
          <div className="effects-empty-state">
            <span className="effects-empty-icon">⚡</span>
            <h4>No effects found</h4>
            <p>Try searching for color, blur, denoise, or AI tools.</p>
            {search && (
              <button
                className="effects-reset-search-btn"
                onClick={() => setSearch('')}
              >
                Reset Search
              </button>
            )}
          </div>
        ) : (
          <div className="effects-grid">
            {filteredEffects.map((eff) => (
              <div
                key={eff.id}
                className={`effect-card ${eff.isAi ? 'is-ai' : ''}`}
                onClick={() => onApplyEffect?.(eff)}
                title={`${eff.name} — ${eff.description}`}
              >
                <div className="effect-card-header">
                  <span className="effect-card-icon">{eff.icon}</span>
                  <div className="effect-card-meta">
                    <span className="effect-card-title">{eff.name}</span>
                    <span className="effect-card-subcat">{eff.subCategory || eff.category}</span>
                  </div>
                  {eff.isAi && <span className="effect-ai-badge">AI</span>}
                </div>
                <p className="effect-card-desc">{eff.description}</p>
                <div className="effect-card-footer">
                  <span className="effect-apply-hint">Click or drag to apply</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
