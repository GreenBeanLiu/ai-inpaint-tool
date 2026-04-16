import { useEffect, useId, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ModalShellProps {
  open: boolean
  title: string
  description?: string
  footer?: ReactNode
  onClose: () => void
  children: ReactNode
}

export function ModalShell({
  open,
  title,
  description,
  footer,
  onClose,
  children,
}: Readonly<ModalShellProps>) {
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') {
    return null
  }

  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={handleBackdropMouseDown}>
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal-shell modal-shell-large"
        role="dialog"
      >
        <div className="modal-header">
          <div className="stack" style={{ gap: '0.45rem' }}>
            <h2 id={titleId} style={{ margin: 0 }}>
              {title}
            </h2>
            {description ? (
              <p className="muted" id={descriptionId} style={{ margin: 0 }}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            aria-label="Close dialog"
            className="button button-secondary"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="modal-body">{children}</div>

        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
