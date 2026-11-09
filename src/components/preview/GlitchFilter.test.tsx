import { describe, expect, it } from 'vitest'
// @ts-ignore — Installed react-dom typings omit the server entry point.
import { renderToStaticMarkup } from 'react-dom/server'
import { VideoLayerItem } from './VideoLayerItem'
import { DEFAULT_TRANSFORM } from '../../core/timeline/types'

function renderGlitch(progress: number) {
  return renderToStaticMarkup(<VideoLayerItem clip={{
    item: { id: 'clip', assetId: 'image', trackId: 'v1', startTime: 0, duration: 5, sourceIn: 0, sourceOut: 5, transform: { ...DEFAULT_TRANSFORM } },
    asset: { id: 'image', name: 'test', type: 'image', path: 'test.png', metadata: { width: 640, height: 360 } },
    track: { id: 'v1', name: 'Video 1', type: 'video' }, sourceTime: progress, isMissing: false,
  }} activeTransition={{ transition: { id: 'glitch', transitionId: 'tr-glitch', name: 'Digital Glitch', trackId: 'v1', startTime: 0, duration: 1, rightClipId: 'clip' }, progress }}
    canvasScale={1} projectWidth={640} projectHeight={360} zIndex={1} isPlayingForward={false} playheadTime={progress} />)
}

describe('Digital Glitch compositing', () => {
  it('filters the real media pixels with tearing, split channels and static', () => {
    const html = renderGlitch(0.5)
    expect(html).toContain('feDisplacementMap')
    expect(html).toContain('result="staticNoise"')
    expect(html).toContain('result="redOffset"')
    expect(html).toContain('result="blueOffset"')
    expect(html).toContain('filter:url(#glitch-')
    expect(html.match(/<img /g)).toHaveLength(1)
  })

  it('removes all glitch processing at the transition boundaries', () => {
    for (const progress of [0, 1]) {
      expect(renderGlitch(progress)).not.toContain('feTurbulence')
      expect(renderGlitch(progress)).not.toContain('url(#glitch-')
    }
  })
})
