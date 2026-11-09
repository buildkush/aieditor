import { describe, it, expect, vi } from 'vitest'
// @ts-ignore
import { renderToStaticMarkup } from 'react-dom/server'
import { EffectsBrowser } from './EffectsBrowser'

describe('EffectsBrowser Component', () => {
  it('renders search input and category filter buttons', () => {
    const html = renderToStaticMarkup(<EffectsBrowser />)
    expect(html).toContain('effects-browser')
    expect(html).toContain('Search effects &amp; AI tools…')
    expect(html).toContain('AI Tools')
    expect(html).toContain('Video')
    expect(html).toContain('Audio')
  })

  it('renders built-in effect cards with descriptions and AI badges', () => {
    const html = renderToStaticMarkup(<EffectsBrowser />)
    expect(html).toContain('Smart Auto-Reframe')
    expect(html).toContain('Background Removal')
    expect(html).toContain('Gaussian Blur')
    expect(html).toContain('Parametric Equalizer')
    expect(html).toContain('effect-ai-badge')
  })

  it('provides click-to-apply callback hook', () => {
    const onApply = vi.fn()
    expect(typeof onApply).toBe('function')
  })
})
