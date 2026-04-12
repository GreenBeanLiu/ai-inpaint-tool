import { useEffect, useState } from 'react'

interface ImagePreviewCardProps {
  title: string
  src?: string | null
  alt: string
  href?: string | null
  summary?: string | null
  emptyLabel?: string
}

export function ImagePreviewCard({
  title,
  src,
  alt,
  href,
  summary,
  emptyLabel = 'No image available yet.',
}: Readonly<ImagePreviewCardProps>) {
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    setHasError(false)
  }, [src])

  const showImage = Boolean(src) && !hasError

  return (
    <article className="image-preview-card">
      <div className="image-preview-heading">
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
      {href ? (
        <a href={href} rel="noreferrer" target="_blank">
          Open full image
        </a>
      ) : null}
    </article>
  )
}
