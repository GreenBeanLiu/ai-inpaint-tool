import { useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

import { ImageComparisonCard } from '@/components/image-comparison-card'
import { ImagePreviewCard, type ImageCardAction } from '@/components/image-preview-card'
import type { ApiErrorResponse, EditJobDetail, EditJobEventRecord, EditJobStatus } from '@/lib/types'

export const Route = createFileRoute('/editor/$jobId')({
  component: EditorJobPage,
})

const activeJobStatuses = new Set<EditJobStatus>(['queued', 'processing'])
const autoRefreshIntervalMs = 3000

async function fetchJobDetail(jobId: string): Promise<EditJobDetail> {
  const response = await fetch(`/api/edit-jobs/${jobId}`)
  const payload = (await response.json()) as
    | { job: EditJobDetail }
    | ApiErrorResponse

  if (!response.ok || !('job' in payload)) {
    throw new Error('error' in payload ? payload.error.message : 'Failed to fetch job')
  }

  return payload.job
}

function shouldAutoRefresh(job: EditJobDetail | null) {
  return job ? activeJobStatuses.has(job.status) : false
}

function formatTimestamp(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'n/a'
}

function formatProcessingTime(value: number | null) {
  return value == null ? 'n/a' : `${value} ms`
}

function formatFileSize(bytes: number | null) {
  if (bytes == null) {
    return null
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  const kb = bytes / 1024

  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`
  }

  return `${(kb / 1024).toFixed(1)} MB`
}

function formatImageSummary(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part)).join(' • ')
}

function formatStatusLabel(status: EditJobStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

type TimelineEventTone = 'queued' | 'active' | 'success' | 'failure'

interface TimelineEventPresentation {
  label: string
  badge: string
  description: string
  tone: TimelineEventTone
}

const timelineEventPresentation: Record<string, TimelineEventPresentation> = {
  'job.accepted': {
    label: 'Job accepted',
    badge: 'Accepted',
    description: 'Source image and edit region were uploaded successfully, and the job was created.',
    tone: 'queued',
  },
  'job.dispatched': {
    label: 'Background run queued',
    badge: 'Queued',
    description: 'The app handed the job to the background runner and is waiting for worker pickup.',
    tone: 'queued',
  },
  'job.processing': {
    label: 'Worker picked up the job',
    badge: 'Processing',
    description: 'A worker claimed the run and started the image-edit pipeline.',
    tone: 'active',
  },
  'job.provider_started': {
    label: 'Provider request started',
    badge: 'Generating',
    description: 'The edit request was sent to the configured image provider.',
    tone: 'active',
  },
  'job.result_uploading': {
    label: 'Uploading generated result',
    badge: 'Uploading',
    description: 'The provider returned an image, and the app is storing the output asset.',
    tone: 'active',
  },
  'job.succeeded': {
    label: 'Job completed',
    badge: 'Succeeded',
    description: 'The final image was stored successfully and the run reached a terminal success state.',
    tone: 'success',
  },
  'job.failed': {
    label: 'Worker run failed',
    badge: 'Failed',
    description: 'The worker hit a processing error before a final result image could be stored.',
    tone: 'failure',
  },
  'job.dispatch_failed': {
    label: 'Dispatch failed',
    badge: 'Dispatch failed',
    description: 'The job record was created, but the app could not start the background run.',
    tone: 'failure',
  },
}

function getStatusPillClass(status: EditJobStatus) {
  switch (status) {
    case 'succeeded':
      return 'status-pill-succeeded'
    case 'failed':
      return 'status-pill-failed'
    case 'processing':
      return 'status-pill-processing'
    default:
      return 'status-pill-queued'
  }
}

function getFilenameExtensionFromMimeType(mimeType: string | null | undefined) {
  switch (mimeType) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    default:
      return null
  }
}

function getFilenameExtensionFromUrl(url: string | null | undefined) {
  if (!url) {
    return null
  }

  try {
    const pathname = new URL(url).pathname
    const match = pathname.match(/\.([a-z0-9]+)$/i)
    return match?.[1]?.toLowerCase() ?? null
  } catch {
    return null
  }
}

function getAssetDownloadName(
  job: EditJobDetail,
  kind: 'source' | 'mask' | 'result',
  options?: {
    mimeType?: string | null
    url?: string | null
  },
) {
  const extension =
    getFilenameExtensionFromMimeType(options?.mimeType) ??
    getFilenameExtensionFromUrl(options?.url) ??
    'png'

  return `${job.id}-${kind}.${extension}`
}

function getAssetActions(
  href: string | null | undefined,
  labels: {
    open: string
    download: string
  },
  downloadName?: string,
): ImageCardAction[] {
  if (!href) {
    return []
  }

  return [
    {
      href,
      label: labels.open,
      tone: 'secondary',
    },
    {
      href,
      label: labels.download,
      download: downloadName ?? true,
    },
  ]
}

function sortPrimaryActions(actions: ImageCardAction[]) {
  return [...actions].sort((left, right) => Number(Boolean(right.download)) - Number(Boolean(left.download)))
}

function getHeroCopy(job: EditJobDetail) {
  if (job.status === 'succeeded') {
    return {
      kicker: 'Result Ready',
      title: 'Edited output ready for review.',
      description:
        'Compare the final image against the original, keep the selected region close for context, and export the delivered asset directly from this page.',
    }
  }

  if (job.status === 'failed') {
    return {
      kicker: 'Run Needs Attention',
      title: 'This edit stopped before producing a final output.',
      description:
        'The source image and edit region are preserved so the failed run stays inspectable, while the raw diagnostics stay tucked behind lightweight disclosures.',
    }
  }

  if (job.status === 'processing') {
    return {
      kicker: 'Rendering In Progress',
      title: 'The worker is still generating the final image.',
      description:
        'This page keeps the source visible while the result uploads, then it promotes the finished output into the review area automatically.',
    }
  }

  return {
    kicker: 'Queued For Processing',
    title: 'The edit is staged and waiting for worker pickup.',
    description:
      'Use the source and edit-region previews to verify the setup now. The result area will update in place once processing begins and the output is stored.',
  }
}

function getHeroSupportNote(job: EditJobDetail, autoRefresh: boolean) {
  if (job.status === 'failed' && job.stage === 'dispatch_failed') {
    return 'Uploads completed, but the background run did not dispatch. Expand the diagnostic payload if you need the exact handoff failure.'
  }

  if (job.status === 'failed') {
    return job.errorMessage ?? 'The worker reported a runtime failure before a result asset was stored.'
  }

  if (autoRefresh) {
    return `Auto-refresh is active every ${autoRefreshIntervalMs / 1000} seconds until this job reaches a terminal state.`
  }

  return 'This job is in a terminal state, so the page now behaves like a stable result snapshot.'
}

function getFailureDiagnosticEvent(job: EditJobDetail) {
  if (job.status !== 'failed') {
    return null
  }

  return job.events.find((event) => event.type === 'job.failed') ?? job.events[0] ?? null
}

function getComparisonSummary(job: EditJobDetail) {
  if (job.resultImageUrl) {
    return 'Toggle source, split, and result views to inspect the edit before opening the full-resolution asset.'
  }

  if (job.status === 'failed') {
    return 'No result image was uploaded, so the review canvas stays focused on the source while diagnostics remain available below.'
  }

  return 'The source image stays visible here while the app waits for the worker to upload a result.'
}

function getComparisonEmptyState(job: EditJobDetail) {
  if (job.status === 'failed') {
    return {
      title: 'Result image unavailable',
      label:
        'This job failed before a result image was stored. Review the diagnostic disclosure or event log below when you need the failure payload.',
    }
  }

  if (job.status === 'processing') {
    return {
      title: 'Result image processing',
      label:
        'The worker is still generating the edit. This panel refreshes into split view automatically once the result upload finishes.',
    }
  }

  return {
    title: 'Result image pending',
    label:
      'The job is still queued for processing. You can inspect the source now, and the comparison becomes interactive after the first result upload.',
  }
}

function getComparisonBadge(job: EditJobDetail) {
  if (job.status === 'succeeded') {
    return 'Ready'
  }

  if (job.status === 'failed') {
    return 'Source only'
  }

  if (job.resultImageUrl) {
    return 'Preview available'
  }

  return 'Pending'
}

function getComparisonHighlight(job: EditJobDetail) {
  if (job.status === 'succeeded') {
    return 'success' as const
  }

  if (job.status === 'failed') {
    return 'failed' as const
  }

  return 'active' as const
}

function getResultEmptyLabel(job: EditJobDetail) {
  if (job.status === 'failed') {
    return 'No result image was uploaded because the job failed.'
  }

  if (job.status === 'processing') {
    return 'Result image is still rendering.'
  }

  return 'No result image is available yet.'
}

function getResultCardBadge(job: EditJobDetail) {
  if (job.status === 'succeeded') {
    return 'Delivered'
  }

  if (job.resultImageUrl) {
    return 'Available'
  }

  if (job.status === 'failed') {
    return 'Unavailable'
  }

  return 'Pending'
}

function renderJson(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function formatFallbackEventLabel(type: string) {
  const normalized = type.startsWith('job.') ? type.slice(4) : type

  return normalized
    .split(/[._-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function getTimelineEventPresentation(event: EditJobEventRecord): TimelineEventPresentation {
  const mapped = timelineEventPresentation[event.type]

  if (mapped) {
    return mapped
  }

  return {
    label: formatFallbackEventLabel(event.type),
    badge: 'Event',
    description: event.message ?? 'Lifecycle event recorded.',
    tone: 'active',
  }
}

function JsonDisclosure({
  title,
  description,
  value,
  tone = 'default',
}: Readonly<{
  title: string
  description?: string
  value: unknown
  tone?: 'default' | 'danger'
}>) {
  return (
    <details className={`diagnostic-disclosure${tone === 'danger' ? ' diagnostic-disclosure-danger' : ''}`}>
      <summary className="diagnostic-summary">
        <div className="stack">
          <strong>{title}</strong>
          {description ? <span className="muted">{description}</span> : null}
        </div>
        <span className="diagnostic-summary-action">Expand</span>
      </summary>
      <pre className="code diagnostic-code">{renderJson(value)}</pre>
    </details>
  )
}

function EventPayloadDisclosure({ event }: Readonly<{ event: EditJobEventRecord }>) {
  if (!event.payloadJson) {
    return null
  }

  return (
    <JsonDisclosure
      description="Expand only when you need the raw event payload."
      title="Payload JSON"
      value={event.payloadJson}
    />
  )
}

function TimelineEventRow({ event }: Readonly<{ event: EditJobEventRecord }>) {
  const presentation = getTimelineEventPresentation(event)
  const secondaryMessage =
    event.message && event.message !== presentation.description ? event.message : null

  return (
    <article className={`event-item event-item-${presentation.tone}`}>
      <div className="event-item-rail" aria-hidden="true">
        <span className={`event-item-marker event-item-marker-${presentation.tone}`} />
      </div>

      <div className="event-item-card">
        <div className="event-item-header">
          <div className="event-item-heading">
            <div className="event-item-meta">
              <span className={`event-badge event-badge-${presentation.tone}`}>{presentation.badge}</span>
              <span className="muted">{formatTimestamp(event.createdAt)}</span>
            </div>
            <strong className="event-item-title">{presentation.label}</strong>
            <p className="event-item-description">{presentation.description}</p>
          </div>
          <code className="event-item-type code">{event.type}</code>
        </div>

        {secondaryMessage ? <p className="event-message">{secondaryMessage}</p> : null}
        <EventPayloadDisclosure event={event} />
      </div>
    </article>
  )
}

function EditorJobPage() {
  const { jobId } = Route.useParams()
  const [job, setJob] = useState<EditJobDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null)
  const [pollTick, setPollTick] = useState(0)

  async function loadJob(options?: { background?: boolean }) {
    const background = options?.background ?? false

    if (background) {
      setIsRefreshing(true)
    } else {
      setLoading(true)
      setError(null)
    }

    try {
      const nextJob = await fetchJobDetail(jobId)
      setJob(nextJob)
      setError(null)
      setLastLoadedAt(new Date().toISOString())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unexpected error')
    } finally {
      if (background) {
        setIsRefreshing(false)
      } else {
        setLoading(false)
      }

      setPollTick((current) => current + 1)
    }
  }

  useEffect(() => {
    setJob(null)
    setError(null)
    setLastLoadedAt(null)
    setLoading(true)
    void loadJob()
  }, [jobId])

  useEffect(() => {
    if (!shouldAutoRefresh(job)) {
      return
    }

    const timer = window.setTimeout(() => {
      void loadJob({ background: true })
    }, autoRefreshIntervalMs)

    return () => {
      window.clearTimeout(timer)
    }
  }, [jobId, job?.status, pollTick])

  if (loading && !job) {
    return <section className="panel">Loading job {jobId}...</section>
  }

  if (error && !job) {
    return (
      <section className="panel stack">
        <strong>Failed to load job</strong>
        <span className="muted">{error}</span>
        <Link className="inline-link" to="/">
          Back to queue
        </Link>
      </section>
    )
  }

  if (!job) {
    return (
      <section className="panel stack">
        <strong>Job not found</strong>
        <Link className="inline-link" to="/">
          Back to queue
        </Link>
      </section>
    )
  }

  const latestEvent = job.events[0] ?? null
  const timelineEvents = [...job.events].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  )
  const autoRefresh = shouldAutoRefresh(job)
  const comparisonEmptyState = getComparisonEmptyState(job)
  const failureDiagnosticEvent = getFailureDiagnosticEvent(job)
  const heroCopy = getHeroCopy(job)
  const sourceActions = getAssetActions(
    job.sourceImageUrl,
    {
      open: 'Open source',
      download: 'Download source',
    },
    getAssetDownloadName(job, 'source', {
      mimeType: job.sourceMimeType,
      url: job.sourceImageUrl,
    }),
  )
  const maskActions = getAssetActions(
    job.maskImageUrl,
    {
      open: 'Open region file',
      download: 'Download region file',
    },
    getAssetDownloadName(job, 'mask', {
      url: job.maskImageUrl,
    }),
  )
  const resultActions = getAssetActions(
    job.resultImageUrl,
    {
      open: 'Open result',
      download: 'Download result',
    },
    getAssetDownloadName(job, 'result', {
      mimeType: job.resultMimeType,
      url: job.resultImageUrl,
    }),
  )
  const heroActions = job.resultImageUrl ? sortPrimaryActions(resultActions) : sourceActions.slice(0, 1)

  return (
    <div className="job-detail-page">
      <section className={`job-hero job-hero-${job.status}`}>
        <div className="job-hero-top">
          <div className="job-hero-copy">
            <Link className="inline-link" to="/">
              Back to queue
            </Link>
            <div className="hero-kicker">{heroCopy.kicker}</div>
            <h1 className="job-hero-title">{heroCopy.title}</h1>
            <p className="job-hero-description muted">{heroCopy.description}</p>
            <div className="job-hero-note">
              <span className="job-id">{job.id}</span>
              <span className="muted">{getHeroSupportNote(job, autoRefresh)}</span>
            </div>
          </div>

          <div className="job-hero-toolbar">
            <div className="job-hero-statuses">
              <span className={`status-pill ${getStatusPillClass(job.status)}`}>
                {formatStatusLabel(job.status)}
              </span>
              <span className={`inline-status ${autoRefresh ? 'is-pending' : ''}`}>
                {autoRefresh ? `Auto-refresh ${autoRefreshIntervalMs / 1000}s` : 'Snapshot locked'}
              </span>
            </div>
            <div className="actions job-hero-actions">
              {heroActions.map((action) => (
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
              <button
                className={`button${heroActions.length > 0 ? ' button-secondary' : ''}`}
                disabled={loading || isRefreshing}
                type="button"
                onClick={() => void loadJob({ background: Boolean(job) })}
              >
                {isRefreshing ? 'Refreshing...' : 'Refresh now'}
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="job-refresh-alert">
            <strong>Refresh failed</strong>
            <span className="muted">{error}</span>
            <span className="muted">Showing the last successfully loaded snapshot.</span>
          </div>
        ) : null}

        {job.status === 'failed' && (job.errorCode || job.errorMessage) ? (
          <div className="job-inline-diagnostic">
            <strong>{job.errorCode ?? 'Worker failure'}</strong>
            <span className="muted">{job.errorMessage ?? 'No additional error message was recorded.'}</span>
          </div>
        ) : null}

        <div className="job-hero-metrics">
          <article className="job-hero-metric">
            <span className="stat-label">Stage</span>
            <strong>{job.stage ?? 'n/a'}</strong>
            <span className="muted">Current pipeline checkpoint</span>
          </article>
          <article className="job-hero-metric">
            <span className="stat-label">Progress</span>
            <strong>{job.progress ?? 0}%</strong>
            <span className="muted">
              {job.finishedAt ? `Finished ${formatTimestamp(job.finishedAt)}` : 'Live worker progress'}
            </span>
          </article>
          <article className="job-hero-metric">
            <span className="stat-label">Provider</span>
            <strong>{job.provider}</strong>
            <span className="muted">{job.model}</span>
          </article>
          <article className="job-hero-metric">
            <span className="stat-label">Canvas</span>
            <strong>{job.width && job.height ? `${job.width} x ${job.height}` : 'Unknown'}</strong>
            <span className="muted">{formatFileSize(job.fileSize) ?? 'Size unavailable'}</span>
          </article>
          <article className="job-hero-metric">
            <span className="stat-label">Processing</span>
            <strong>{formatProcessingTime(job.processingMs)}</strong>
            <span className="muted">Created {formatTimestamp(job.createdAt)}</span>
          </article>
          <article className="job-hero-metric">
            <span className="stat-label">Last Loaded</span>
            <strong>{formatTimestamp(lastLoadedAt)}</strong>
            <span className="muted">
              {latestEvent ? `${latestEvent.type} • ${formatTimestamp(latestEvent.createdAt)}` : 'No events yet'}
            </span>
          </article>
        </div>
      </section>

      <section className="panel stack">
        <div className="section-heading">
          <div className="section-heading-copy">
            <div className="section-eyebrow">Review</div>
            <h2 className="subsection-title">Inspect the edit before export</h2>
          </div>
          <span className="muted">Source and result stay in one workspace while the output is pending or ready.</span>
        </div>
        <ImageComparisonCard
          badge={getComparisonBadge(job)}
          emptyActions={sourceActions}
          emptyLabel={comparisonEmptyState.label}
          emptyTitle={comparisonEmptyState.title}
          eyebrow="Result Viewer"
          highlight={getComparisonHighlight(job)}
          resultActions={resultActions}
          resultAlt={`Result comparison image for job ${job.id}`}
          resultHref={job.resultImageUrl}
          resultSrc={job.resultImageUrl}
          sourceActions={sourceActions}
          sourceAlt={`Source comparison image for job ${job.id}`}
          sourceHref={job.sourceImageUrl}
          sourceSrc={job.sourceImageUrl}
          summary={getComparisonSummary(job)}
          title={job.status === 'succeeded' ? 'Final output review' : 'Source and result review'}
        />
      </section>

      <section className="panel stack">
        <div className="section-heading">
          <div className="section-heading-copy">
            <div className="section-eyebrow">Assets</div>
            <h2 className="subsection-title">Source, edit region, and delivered output</h2>
          </div>
          <span className="muted">The result stays primary while the original inputs remain close for reference.</span>
        </div>

        <div className="job-assets-layout">
          <div className="job-asset job-asset-result">
            <ImagePreviewCard
              actions={resultActions}
              alt={`Result image for job ${job.id}`}
              badge={getResultCardBadge(job)}
              emptyLabel={getResultEmptyLabel(job)}
              eyebrow="Primary Output"
              href={job.resultImageUrl}
              src={job.resultImageUrl}
              summary={formatImageSummary([
                job.resultMimeType,
                job.status === 'succeeded' ? 'Final render stored' : null,
                formatFileSize(job.fileSize),
              ])}
              title="Final result"
              variant="result"
            />
          </div>
          <div className="job-asset job-asset-source">
            <ImagePreviewCard
              actions={sourceActions}
              alt={`Source image for job ${job.id}`}
              badge="Original"
              eyebrow="Source"
              href={job.sourceImageUrl}
              src={job.sourceImageUrl}
              summary={formatImageSummary([
                job.width && job.height ? `${job.width} x ${job.height}` : null,
                job.sourceMimeType,
                formatFileSize(job.fileSize),
              ])}
              title="Source image"
              variant="supporting"
            />
          </div>
          <div className="job-asset job-asset-mask">
            <ImagePreviewCard
              actions={maskActions}
              alt={`Mask image for job ${job.id}`}
              badge="Edit region"
              eyebrow="Edit Region"
              href={job.maskImageUrl}
              src={job.maskImageUrl}
              summary={formatImageSummary([
                job.width && job.height ? `${job.width} x ${job.height}` : null,
                'Uploaded edit region',
              ])}
              title="Edit region image"
              variant="supporting"
            />
          </div>
        </div>
      </section>

      <section className="job-info-grid">
        <article className="panel stack prompt-panel">
          <div className="section-eyebrow">Prompt</div>
          <h2 className="subsection-title">Edit instruction</h2>
          <p className="job-prompt-copy">{job.prompt ?? 'No prompt was provided for this edit.'}</p>
          <div className="job-prompt-meta">
            <span className="inline-status">{job.provider}</span>
            <span className="inline-status">{job.model}</span>
            <span className="inline-status">{job.width && job.height ? `${job.width} x ${job.height}` : 'Unknown size'}</span>
          </div>
        </article>

        <article className="panel stack">
          <div className="section-eyebrow">Run Details</div>
          <h2 className="subsection-title">Execution snapshot</h2>
          <div className="job-detail-list">
            <div className="job-detail-row">
              <span className="job-detail-label">Job ID</span>
              <span className="job-id">{job.id}</span>
            </div>
            <div className="job-detail-row">
              <span className="job-detail-label">Created</span>
              <span>{formatTimestamp(job.createdAt)}</span>
            </div>
            <div className="job-detail-row">
              <span className="job-detail-label">Started</span>
              <span>{formatTimestamp(job.startedAt)}</span>
            </div>
            <div className="job-detail-row">
              <span className="job-detail-label">Finished</span>
              <span>{formatTimestamp(job.finishedAt)}</span>
            </div>
            <div className="job-detail-row">
              <span className="job-detail-label">Latest event</span>
              <span>{latestEvent ? `${latestEvent.type} at ${formatTimestamp(latestEvent.createdAt)}` : 'No events recorded.'}</span>
            </div>
            <div className="job-detail-row">
              <span className="job-detail-label">Error code</span>
              <span>{job.errorCode ?? 'None'}</span>
            </div>
            <div className="job-detail-row">
              <span className="job-detail-label">Error message</span>
              <span>{job.errorMessage ?? 'None'}</span>
            </div>
          </div>

          {failureDiagnosticEvent?.payloadJson ? (
            <JsonDisclosure
              description="Expanded worker diagnostics are available here without dominating the page."
              title="Failure diagnostics"
              tone="danger"
              value={failureDiagnosticEvent.payloadJson}
            />
          ) : null}
        </article>
      </section>

      <section className="panel stack">
        <div className="section-heading">
          <div className="section-heading-copy">
            <div className="section-eyebrow">Lifecycle</div>
            <h2 className="subsection-title">Readable event timeline</h2>
          </div>
          <span className="muted">Each stage stays readable in plain language, with raw types and payload JSON kept secondary.</span>
        </div>

        <div className="event-list">
          {timelineEvents.length === 0 ? (
            <div className="muted">No events recorded.</div>
          ) : (
            timelineEvents.map((event) => <TimelineEventRow event={event} key={event.id} />)
          )}
        </div>
      </section>
    </div>
  )
}
