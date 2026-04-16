import { useEffect, useState } from 'react'

export interface ImageCardAction {
  href: string
  label: string
  download?: string | true
  tone?: 'primary' | 'secondary'
}

interface ImagePreviewCardProps {
  title: string
  src?: string | null
  alt: string
  href?: string | null
  summary?: string | null
  emptyLabel?: string
  actions?: ImageCardAction[]
  eyebrow?: string | null
  badge?: string | null
  variant?: 'default' | 'supporting' | 'result'
}

export function ImagePreviewCard({
  title,
  src,
  alt,
  href,
  summary,
  emptyLabel = 'No image available yet.',
  actions = [],
  eyebrow,
  badge,
  variant = 'default',
}: Readonly<ImagePreviewCardProps>) {
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    setHasError(false)
  }, [src])

  const showImage = Boolean(src) && !hasError
  const resolvedActions =
    actions.length > 0
      ? actions
      : href
        ? [{ href, label: 'Open full image', tone: 'secondary' as const }]
        : []

  return (
    <article className={`image-preview-card image-preview-card-${variant}`}>
      <div className="image-preview-heading">
        {eyebrow || badge ? (
          <div className="image-preview-meta">
            {eyebrow ? <span className="image-preview-eyebrow">{eyebrow}</span> : null}
            {badge ? <span className="image-preview-badge">{badge}</span> : null}
          </div>
        ) : null}
        <strong>{title}</strong>
        {summary ? <span className="muted">{summary}</span> : null}
      </div>
      <div className="image-preview-frame">
        {showImage ? (
          <img
            alt={alt}
            className="image-preview-image"
            loading="lazy"
            src={src ?? undefined}
            onError={() => setHasError(true)}
          />
        ) : (
          <div className="image-preview-empty muted">
            {hasError ? 'Preview unavailable for this image.' : emptyLabel}
          </div>
        )}
      </div>
      {resolvedActions.length > 0 ? (
        <div className="actions">
          {resolvedActions.map((action) => (
            <a
              className={`button${action.tone === 'secondary' ? ' button-secondary' : ''}`}
              download={action.download}
              href={action.href}
              key={`${action.label}-${action.href}`}
              rel="noreferrer"
              target="_blank"
            >
              {action.label}
            </a>
          ))}
        </div>
      ) : null}
    </article>
  )
}
