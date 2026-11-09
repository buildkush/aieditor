
export function TextPresetIcon({ id }: { id: string }) {
  switch (id) {
    case 'heading':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect width="20" height="20" rx="4" fill="rgba(255, 255, 255, 0.06)" />
          <path d="M5 5v10M15 5v10M5 10h10" stroke="#f1f5f9" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
    case 'corner-label':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect width="20" height="20" rx="4" fill="rgba(255, 255, 255, 0.06)" />
          <rect x="3" y="3" width="7" height="4" rx="1.5" fill="#ef4444" />
          <rect x="3" y="9" width="14" height="2" rx="1" fill="rgba(255, 255, 255, 0.25)" />
          <rect x="3" y="13" width="10" height="2" rx="1" fill="rgba(255, 255, 255, 0.15)" />
        </svg>
      )
    case 'lower-third':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect width="20" height="20" rx="4" fill="rgba(255, 255, 255, 0.06)" />
          <rect x="3" y="11" width="14" height="5" rx="1" fill="#0ea5e9" fillOpacity="0.8" />
          <line x1="3" y1="11" x2="3" y2="16" stroke="#38bdf8" strokeWidth="2" />
        </svg>
      )
    case 'subtitle':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect width="20" height="20" rx="4" fill="rgba(255, 255, 255, 0.06)" />
          <rect x="3" y="12" width="14" height="4" rx="1" fill="rgba(0,0,0,0.7)" />
          <path d="M6 14h8" stroke="#facc15" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'animated-caption':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect width="20" height="20" rx="4" fill="rgba(255, 255, 255, 0.06)" />
          <rect x="3" y="11" width="14" height="5" rx="1" fill="#00f0ff" fillOpacity="0.25" stroke="#00f0ff" strokeWidth="1" />
          <path d="M10 2l.8 2.2L13 5l-2.2.8L10 8l-.8-2.2L7 5l2.2-.8L10 2z" fill="#00f0ff" />
        </svg>
      )
    case 'text':
    default:
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect width="20" height="20" rx="4" fill="rgba(255, 255, 255, 0.06)" />
          <path d="M6 6h8M10 6v9" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )
  }
}

export function OverlayIcon() {
  return (
    <div
      style={{
        width: 20,
        height: 20,
        borderRadius: 4,
        background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
        boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.4)',
      }}
    />
  )
}

export function LayerIcon() {
  return (
    <div
      style={{
        width: 20,
        height: 20,
        borderRadius: 4,
        background: 'linear-gradient(135deg, #a855f7 0%, #7e22ce 100%)',
        boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M6 1L1 3.5 6 6l5-2.5L6 1zM1 6l5 2.5L11 6M1 8.5L6 11l5-2.5" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

export function TransitionIcon({ id }: { id: string }) {
  if (id === 'tr-wipe' || id === 'tr-linear-wipe' || id === 'tr-clock-wipe') {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect width="20" height="20" rx="4" fill="rgba(255, 255, 255, 0.06)" />
        <rect x="3" y="4" width="7" height="12" fill="#818cf8" fillOpacity="0.4" />
        <line x1="10" y1="4" x2="10" y2="16" stroke="#c7d2fe" strokeWidth="1.5" />
        <path d="M8 10h4m-1.5-2l2 2-2 2" stroke="#c7d2fe" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (id === 'tr-zoom' || id === 'tr-crash-zoom' || id === 'tr-zoom-in') {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect width="20" height="20" rx="4" fill="rgba(255, 255, 255, 0.06)" />
        <circle cx="9.5" cy="9.5" r="5" stroke="#38bdf8" strokeWidth="1.5" />
        <line x1="13.5" y1="13.5" x2="17" y2="17" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
        <path d="M7 9.5h5M9.5 7v5" stroke="#38bdf8" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    )
  }
  const symbol = id.includes('push') ? '↤' : id.includes('slide') ? '↥' : id.includes('whip') ? '≋' :
    id.includes('black') ? '◼' : id.includes('white') ? '◻' : id.includes('glitch') ? 'ϟ' : null
  if (symbol) return <span aria-hidden="true" style={{ width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#c7d2fe', fontSize: 20 }}>{symbol}</span>
  // dissolve
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect width="20" height="20" rx="4" fill="rgba(255, 255, 255, 0.06)" />
      <circle cx="7" cy="10" r="4.5" fill="#a78bfa" fillOpacity="0.5" />
      <circle cx="13" cy="10" r="4.5" fill="#f472b6" fillOpacity="0.5" />
    </svg>
  )
}

export function EffectGlyph({ category, id }: { category: string; id: string }) {
  switch (id) {
    case 'blur':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="6" fill="#38bdf8" fillOpacity="0.4" filter="blur(1px)" />
          <circle cx="10" cy="10" r="3" fill="#38bdf8" />
        </svg>
      )
    case 'sharpen':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M10 3l6 14H4L10 3z" stroke="#38bdf8" strokeWidth="1.5" fill="#38bdf8" fillOpacity="0.2" />
        </svg>
      )
    case 'grayscale':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7" stroke="#cbd5e1" strokeWidth="1.5" />
          <path d="M10 3a7 7 0 010 14V3z" fill="#cbd5e1" />
        </svg>
      )
    case 'vignette':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect width="20" height="20" rx="4" fill="#000000" />
          <ellipse cx="10" cy="10" rx="7" ry="5" fill="#475569" />
          <ellipse cx="10" cy="10" rx="4" ry="2.5" fill="#f1f5f9" />
        </svg>
      )
    case 'brightness':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="3.5" fill="#facc15" />
          <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4" stroke="#facc15" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'contrast':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7" stroke="#facc15" strokeWidth="1.5" />
          <path d="M10 3a7 7 0 000 14V3z" fill="#facc15" />
        </svg>
      )
    case 'saturation':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="7" cy="8" r="4" fill="#ef4444" fillOpacity="0.7" />
          <circle cx="13" cy="8" r="4" fill="#3b82f6" fillOpacity="0.7" />
          <circle cx="10" cy="13" r="4" fill="#10b981" fillOpacity="0.7" />
        </svg>
      )
    case 'glow':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M10 2l1.8 5.2L17 9l-5.2 1.8L10 16l-1.8-5.2L3 9l5.2-1.8L10 2z" fill="#f43f5e" />
        </svg>
      )
    case 'chroma-key':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect width="20" height="20" rx="4" fill="#10b981" />
          <path d="M6 10a4 4 0 108 0 4 4 0 00-8 0z" stroke="#ffffff" strokeWidth="1.5" strokeDasharray="2 2" />
        </svg>
      )
    case 'gain':
    case 'eq':
    case 'compressor':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="4" y="8" width="2.5" height="8" rx="1" fill="#34d399" />
          <rect x="8.7" y="4" width="2.5" height="12" rx="1" fill="#34d399" />
          <rect x="13.5" y="10" width="2.5" height="6" rx="1" fill="#34d399" />
        </svg>
      )
    default:
      // Category fallback
      if (category === 'audio') {
        return (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M8 6H5a1 1 0 00-1 1v6a1 1 0 001 1h3l4 3V3L8 6z" fill="#34d399" />
            <path d="M14 8a3 3 0 010 4" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )
      }
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect width="20" height="20" rx="4" fill="rgba(255, 255, 255, 0.06)" />
          <circle cx="10" cy="10" r="5" stroke="#a855f7" strokeWidth="1.5" />
          <circle cx="10" cy="10" r="2" fill="#a855f7" />
        </svg>
      )
  }
}
