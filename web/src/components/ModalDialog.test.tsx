import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModalDialog } from './ModalDialog'

describe('ModalDialog', () => {
  it('uses the latest onClose callback after rerenders while open', () => {
    const initialOnClose = vi.fn()
    const nextOnClose = vi.fn()

    const { rerender } = render(
      <ModalDialog isOpen onClose={initialOnClose} title="Media dialog">
        <button type="button">Primary action</button>
      </ModalDialog>,
    )

    rerender(
      <ModalDialog isOpen onClose={nextOnClose} title="Media dialog">
        <button type="button">Primary action</button>
      </ModalDialog>,
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(initialOnClose).not.toHaveBeenCalled()
    expect(nextOnClose).toHaveBeenCalledTimes(1)
  })

  it('keeps tall dialog content scrollable within the viewport', () => {
    const { container } = render(
      <ModalDialog isOpen onClose={() => {}} title="Media dialog">
        <div>Dialog content</div>
      </ModalDialog>,
    )

    expect(container.firstChild).toHaveClass('overflow-y-auto')
    expect(
      screen.getByRole('dialog', { name: 'Media dialog' }),
    ).toHaveClass('max-h-[calc(100vh-3rem)]')
  })
})
