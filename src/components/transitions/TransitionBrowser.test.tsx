import { describe, it, expect } from 'vitest'
// @ts-ignore
import { renderToStaticMarkup } from 'react-dom/server'
import { TransitionBrowser } from './TransitionBrowser'

describe('TransitionBrowser Component', () => {
  it('renders search input and category pills', () => {
    const html = renderToStaticMarkup(<TransitionBrowser />)
    expect(html).toContain('transition-browser')
    expect(html).toContain('Search transitions…')
    expect(html).toContain('Dissolve')
    expect(html).toContain('Motion')
    expect(html).toContain('Wipe')
    expect(html).toContain('Stylized')
  })

  it('renders standard transition cards with duration tags', () => {
    const html = renderToStaticMarkup(<TransitionBrowser />)
    expect(html).toContain('Cross Dissolve')
    expect(html).toContain('Dip to Black')
    expect(html).toContain('Push')
    expect(html).toContain('Slide')
    expect(html).toContain('Clock Wipe')
    expect(html).toContain('1s')
  })
})
