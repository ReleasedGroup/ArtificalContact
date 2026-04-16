import { useEffect, useId, useRef, type ReactNode } from 'react'

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('disabled'))
}

interface ModalDialogProps {
  children: ReactNode
  description?: string
  isOpen: boolean
  maxWidthClassName?: string
  onClose: () => void
  title: string
}

export function ModalDialog({
  children,
  description,
  isOpen,
  maxWidthClassName = 'max-w-3xl',
  onClose,
  title,
}: ModalDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement | null>(null)
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    previouslyFocusedElementRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    const focusDialog = window.setTimeout(() => {
      const dialog = dialogRef.current
      if (!dialog) {
        return
      }

      const focusableElements = getFocusableElements(dialog)
      ;(focusableElements[0] ?? dialog).focus()
    }, 0)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const dialog = dialogRef.current
      if (!dialog) {
        return
      }

      const focusableElements = getFocusableElements(dialog)
      if (focusableElements.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const activeElement = document.activeElement
      const currentIndex = focusableElements.findIndex(
        (element) => element === activeElement,
      )
      const nextIndex = event.shiftKey
        ? currentIndex <= 0
          ? focusableElements.length - 1
          : currentIndex - 1
        : currentIndex === -1 || currentIndex === focusableElements.length - 1
          ? 0
          : currentIndex + 1

      event.preventDefault()
      focusableElements[nextIndex]?.focus()
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      window.clearTimeout(focusDialog)
      document.removeEventListener('keydown', handleKeyDown)

      if (previouslyFocusedElementRef.current?.isConnected) {
        previouslyFocusedElementRef.current.focus()
      }
    }
  }, [isOpen, onClose])

  if (!isOpen) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/82 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`w-full overflow-y-auto rounded-[1.9rem] border border-white/10 bg-slate-950/96 p-6 shadow-2xl shadow-slate-950/50 ${maxWidthClassName}`}
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
              {title}
            </p>
            {description && (
              <p
                id={descriptionId}
                className="mt-3 max-w-2xl text-sm leading-7 text-slate-300"
              >
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="rounded-full border border-white/10 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/8"
          >
            Close
          </button>
        </div>

        <div className="mt-6">{children}</div>
      </section>
    </div>
  )
}
