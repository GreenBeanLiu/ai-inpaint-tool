import { useEffect, useState } from 'react'

import type { ImageCardAction } from '@/components/image-preview-card'

type ComparisonViewMode = 'source' | 'split' | 'result'

interface ImageComparisonCardProps {
  title: string
  sourceSrc: string
  resultSrc?: string | null
  sourceAlt: string
  resultAlt: string
  sourceHref?: string | null
  resultHref?: string | null
  summary?: string | null
  emptyTitle?: string
  emptyLabel?: string
  sourceActions?: ImageCardAction[]
  resultActions?: ImageCardAction[]
  emptyActions?: ImageCardAction[]
}

export function ImageComparisonCard({
  title,
  sourceSrc,
  resultSrc,
  sourceAlt,
  resultAlt,
  sourceHref,
  resultHref,
  summary,
  emptyTitle = 'Comparison preview pending',
  emptyLabel = 'The source image is ready. This area updates when a result image becomes available.',
  sourceActions = [],
  resultActions = [],
  emptyActions = [],
}: Readonly<ImageComparisonCardProps>) {
  const [reveal, setReveal] = useState(50)
  const [viewMode, setViewMode] = useState<ComparisonViewMode>('split')
  const [sourceError, setSourceError] = useState(false)
  const [resultError, setResultError] = useState(false)

  useEffect(() => {
    setReveal(50)
    setViewMode(resultSrc ? 'split' : 'source')
    setSourceError(false)
    setResultError(false)
  }, [sourceSrc, resultSrc])

  const hasSourceImage = Boolean(sourceSrc) && !sourceError
  const hasResultImage = Boolean(resultSrc) && !resultError
  const hasSourceAsset = Boolean(sourceSrc || sourceHref)
  const hasResultAsset = Boolean(resultSrc || resultHref)
  const canCompare = hasSourceImage && hasResultImage
  const resolvedViewMode: ComparisonViewMode = canCompare
    ? viewMode
    : hasResultImage
      ? 'result'
      : 'source'
  const showSlider = canCompare && resolvedViewMode === 'split'
  const resolvedEmptyState = resultError
    ? {
        title: 'Result preview unavailable',
        label:
          'The result asset exists, but inline rendering failed. Open or download the file directly to inspect it.',
      }
    : sourceError && !hasSourceImage
      ? {
          title: 'Source preview unavailable',
          label:
            'The source asset could not be rendered inline. Use the source actions below to inspect the original file directly.',
        }
      : {
          title: emptyTitle,
          label: emptyLabel,
        }

  return (
    <article className="comparison-card">
      <div className="image-preview-heading">
        <strong>{title}</strong>
        {summary ? <span className="muted">{summary}</span> : null}
      </div>

      <div className="comparison-toolbar">
        <div className="segmented-controls" role="group" aria-label="Comparison view">
          <button
            aria-pressed={resolvedViewMode === 'source'}
            className="button button-secondary"
            disabled={!hasSourceImage}
            type="button"
            onClick={() => setViewMode('source')}
          >
            Source
          </button>
          <button
            aria-pressed={resolvedViewMode === 'split'}
            className="button button-secondary"
            disabled={!canCompare}
            type="button"
            onClick={() => setViewMode('split')}
          >
            Split
          </button>
          <button
            aria-pressed={resolvedViewMode === 'result'}
            className="button button-secondary"
            disabled={!hasResultImage}
            type="button"
            onClick={() => setViewMode('result')}
          >
            Result
          </button>
        </div>
        {!canCompare ? (
          <span className="muted">
            {hasResultAsset
              ? 'Split view unlocks when both previews load.'
              : 'Result actions unlock when the worker uploads the edited image.'}
          </span>
        ) : null}
      </div>

      <div className="comparison-frame">
        {resolvedViewMode !== 'result' && hasSourceImage ? (
          <img
            alt={sourceAlt}
            className="comparison-image"
            loading="lazy"
            src={sourceSrc}
            onError={() => setSourceError(true)}
          />
        ) : null}
        {resolvedViewMode === 'result' && hasResultImage ? (
          <img
            alt={resultAlt}
            className="comparison-image"
            loading="lazy"
            src={resultSrc ?? undefined}
            onError={() => setResultError(true)}
          />
        ) : null}
        {showSlider ? (
          <>
            <div className="comparison-result" style={{ clipPath: `inset(0 ${100 - reveal}% 0 0)` }}>
              <img
                alt={resultAlt}
                className="comparison-image"
                loading="lazy"
                src={resultSrc ?? undefined}
                onError={() => setResultError(true)}
              />
            </div>
            <div className="comparison-divider" style={{ left: `${reveal}%` }} />
            <span className="comparison-label comparison-label-source">Source</span>
            <span className="comparison-label comparison-label-result">Result</span>
          </>
        ) : null}
        {resolvedViewMode === 'source' && hasSourceImage ? (
          <span className="comparison-label comparison-label-source">Source</span>
        ) : null}
        {resolvedViewMode === 'result' && hasResultImage ? (
          <span className="comparison-label comparison-label-result">Result</span>
        ) : null}
        {!canCompare ? (
          <div className="comparison-empty-state">
            <strong>{resolvedEmptyState.title}</strong>
            <span className="muted">{resolvedEmptyState.label}</span>
            {emptyActions.length > 0 ? (
              <div className="actions comparison-empty-actions">
                {emptyActions.map((action) => (
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
          </div>
        ) : null}
      </div>

      {showSlider ? (
        <label className="field">
          <span>Comparison split: {reveal}% result</span>
          <input
            aria-label="Comparison split"
            max={100}
            min={0}
            type="range"
            value={reveal}
            onChange={(event) => setReveal(Number(event.target.value))}
          />
        </label>
      ) : null}

      <div className="comparison-asset-grid">
        <div className="job-card stack">
          <strong>Source asset</strong>
          <span className="muted">
            {hasSourceAsset
              ? 'Open the original upload or save a local copy.'
              : 'No source asset actions are available.'}
          </span>
          {sourceActions.length > 0 ? (
            <div className="actions">
              {sourceActions.map((action) => (
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
        </div>
        <div className="job-card stack">
          <strong>Result asset</strong>
          <span className="muted">
            {hasResultAsset
              ? 'Open or download the returned edit without leaving the compare view.'
              : 'The result asset is not available yet. Keep this page open or refresh when processing finishes.'}
          </span>
          {resultActions.length > 0 ? (
            <div className="actions">
              {resultActions.map((action) => (
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
        </div>
      </div>
    </article>
  )
}
