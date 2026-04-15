import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppImage } from './AppImage'

describe('AppImage', () => {
  it('defaults to lazy loading with async decoding', () => {
    render(<AppImage alt="Preview" src="/demo.png" />)

    const image = screen.getByRole('img', { name: 'Preview' })
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('decoding', 'async')
  })

  it('allows eager loading for above-the-fold media', () => {
    render(<AppImage alt="Banner" loading="eager" src="/banner.png" />)

    const image = screen.getByRole('img', { name: 'Banner' })
    expect(image).toHaveAttribute('loading', 'eager')
  })
})
