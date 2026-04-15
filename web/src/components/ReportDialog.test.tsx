import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReportDialog } from './ReportDialog'

vi.mock('../lib/report', async () => {
  const actual = await vi.importActual<typeof import('../lib/report')>(
    '../lib/report',
  )

  return {
    ...actual,
    createReport: vi.fn(),
  }
})

describe('ReportDialog', () => {
  it('traps focus inside the dialog and restores focus to the trigger on close', async () => {
    render(
      <ReportDialog
        dialogDescription="Flag this post for moderation review."
        dialogTitle="Report this post"
        successMessage="Post report submitted."
        target={{
          targetType: 'post',
          targetId: 'post-1',
          targetProfileHandle: 'grace',
        }}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Report' })
    trigger.focus()

    fireEvent.click(trigger)

    const closeButton = await screen.findByRole('button', {
      name: 'Close report dialog',
    })
    const submitButton = screen.getByRole('button', { name: 'Submit report' })
    const detailsInput = screen.getByLabelText('Notes for moderators')

    expect(detailsInput).toHaveFocus()

    closeButton.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(submitButton).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(closeButton).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger).toHaveFocus()
    expect(
      screen.queryByRole('dialog', { name: 'Report this post' }),
    ).not.toBeInTheDocument()
  })
})
