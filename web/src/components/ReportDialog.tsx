import { startTransition, useEffect, useId, useRef, useState } from 'react'
import {
  createReport,
  reportReasonOptions,
  type CreateReportInput,
  type ReportReasonCode,
} from '../lib/report'

type SubmissionState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'error'; message: string }

interface ReportDialogProps {
  actionClassName?: string
  actionLabel?: string
  dialogDescription: string
  dialogTitle: string
  successMessage: string
  target: Omit<CreateReportInput, 'reasonCode' | 'details'>
}

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function ReportDialog({
  actionClassName,
  actionLabel = 'Report',
  dialogDescription,
  dialogTitle,
  successMessage,
  target,
}: ReportDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [reasonCode, setReasonCode] = useState<ReportReasonCode>('spam')
  const [details, setDetails] = useState('')
  const [submissionState, setSubmissionState] = useState<SubmissionState>({
    status: 'idle',
  })
  const [flashMessage, setFlashMessage] = useState<string | null>(null)
  const dialogId = useId()
  const titleId = useId()
  const descriptionId = useId()
  const detailsInputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && submissionState.status !== 'submitting') {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, submissionState.status])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    detailsInputRef.current?.focus()
  }, [isOpen])

  const closeDialog = () => {
    if (submissionState.status === 'submitting') {
      return
    }

    setIsOpen(false)
  }

  const handleSubmit = async () => {
    startTransition(() => {
      setSubmissionState({ status: 'submitting' })
      setFlashMessage(null)
    })

    try {
      await createReport({
        ...target,
        reasonCode,
        details: normalizeOptionalText(details),
      })

      startTransition(() => {
        setSubmissionState({ status: 'idle' })
        setFlashMessage(successMessage)
        setIsOpen(false)
        setReasonCode('spam')
        setDetails('')
      })
    } catch (error) {
      startTransition(() => {
        setSubmissionState({
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to submit the report.',
        })
      })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        aria-controls={dialogId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => {
          setIsOpen(true)
          setFlashMessage(null)
          setSubmissionState({ status: 'idle' })
        }}
        className={
          actionClassName ??
          'rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-sm font-medium text-amber-100 transition hover:border-amber-300/35 hover:bg-amber-300/15'
        }
      >
        {actionLabel}
      </button>

      {flashMessage && (
        <span
          aria-live="polite"
          className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100"
        >
          {flashMessage}
        </span>
      )}

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/82 px-4 py-6 backdrop-blur-sm"
          onClick={closeDialog}
        >
          <section
            id={dialogId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="w-full max-w-2xl rounded-[1.9rem] border border-white/10 bg-slate-950/96 p-6 shadow-2xl shadow-slate-950/50"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p
                  id={titleId}
                  className="text-2xl font-semibold tracking-tight text-white"
                >
                  {dialogTitle}
                </p>
                <p
                  id={descriptionId}
                  className="mt-3 max-w-2xl text-sm leading-7 text-slate-300"
                >
                  {dialogDescription}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close report dialog"
                onClick={closeDialog}
                className="rounded-full border border-white/10 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/8"
              >
                Close
              </button>
            </div>

            <fieldset className="mt-6 space-y-3">
              <legend className="text-sm font-medium uppercase tracking-[0.22em] text-slate-300">
                Reason taxonomy
              </legend>
              <div className="grid gap-3">
                {reportReasonOptions.map((option) => {
                  const checked = reasonCode === option.code

                  return (
                    <label
                      key={option.code}
                      className={`cursor-pointer rounded-[1.35rem] border px-4 py-4 transition ${
                        checked
                          ? 'border-cyan-300/25 bg-cyan-300/10'
                          : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/8'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="radio"
                          name={`report-reason-${dialogId}`}
                          value={option.code}
                          checked={checked}
                          onChange={() => {
                            setReasonCode(option.code)
                          }}
                          className="mt-1 h-4 w-4 border-white/20 bg-slate-950 text-cyan-300 focus:ring-cyan-200/70"
                        />
                        <div>
                          <p className="text-sm font-semibold text-white">
                            {option.label}
                          </p>
                          <p className="mt-1 text-sm leading-6 text-slate-300">
                            {option.description}
                          </p>
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <div className="mt-6">
              <label
                htmlFor={`${dialogId}-details`}
                className="text-sm font-medium uppercase tracking-[0.22em] text-slate-300"
              >
                Notes for moderators
              </label>
              <textarea
                id={`${dialogId}-details`}
                ref={detailsInputRef}
                value={details}
                onChange={(event) => {
                  setDetails(event.target.value)
                }}
                maxLength={500}
                rows={4}
                placeholder="Add any context that will help moderation review."
                className="mt-3 w-full rounded-[1.35rem] border border-white/10 bg-slate-950/85 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/30"
              />
              <p className="mt-2 text-xs text-slate-500">
                Optional. Keep it factual and specific.
              </p>
            </div>

            {submissionState.status === 'error' && (
              <div className="mt-5 rounded-[1.25rem] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                {submissionState.message}
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeDialog}
                disabled={submissionState.status === 'submitting'}
                className="rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/8 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSubmit()
                }}
                disabled={submissionState.status === 'submitting'}
                className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
              >
                {submissionState.status === 'submitting'
                  ? 'Submitting report...'
                  : 'Submit report'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
