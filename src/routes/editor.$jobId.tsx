import { useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

import { ImageComparisonCard } from '@/components/image-comparison-card'
import { ImagePreviewCard, type ImageCardAction } from '@/components/image-preview-card'
import type { ApiErrorResponse, EditJobDetail, EditJobStatus } from '@/lib/types'

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

function getStatusSummary(job: EditJobDetail) {
  if (job.status === 'failed' && job.stage === 'dispatch_failed') {
    return {
      className: 'alert alert-error',
      title: 'Trigger dispatch failed',
      description:
        'The uploads and database write completed, but the background run was not dispatched. Check the error fields and event payload below for the exact failure.',
    }
  }

  if (job.status === 'failed') {
    return {
      className: 'alert alert-error',
      title: 'Job failed during processing',
      description:
        'The worker reported a real runtime failure. The app is preserving the failed state and diagnostics instead of fabricating a completed result.',
    }
  }

  if (job.status === 'succeeded') {
    return {
      className: 'alert',
      title: 'Job completed',
      description:
        'The provider returned an image, the result was uploaded to storage, and polling has stopped because the job is in a terminal state.',
    }
  }

  if (job.status === 'processing') {
    return {
      className: 'alert',
      title: 'Job is processing',
      description:
        'The worker has started. This page refreshes every 3 seconds until the job succeeds or fails.',
    }
  }

  return {
    className: 'alert',
    title: 'Job is queued',
    description:
      'The job is waiting for dispatch completion or worker pickup. This page refreshes every 3 seconds while the job remains active.',
  }
}

function getFailureDiagnostics(job: EditJobDetail) {
  if (job.status !== 'failed') {
    return null
  }

  const failureEvent = job.events.find((event) => event.type === 'job.failed') ?? job.events[0] ?? null

  if (!failureEvent?.payloadJson) {
    return null
  }

  return JSON.stringify(failureEvent.payloadJson, null, 2)
}

function getComparisonSummary(job: EditJobDetail) {
  if (job.resultImageUrl) {
    return 'Toggle source, split, and result views to inspect the edit before opening full-resolution assets.'
  }

  if (job.status === 'failed') {
    return 'No result image was uploaded, so the comparison panel falls back to the source image and failure context.'
  }

  return 'The source image stays visible here while the app waits for the worker to upload a result.'
}

function getComparisonEmptyState(job: EditJobDetail) {
  if (job.status === 'failed') {
    return {
      title: 'Result image unavailable',
      label:
        'This job failed before a result image was stored. Review the diagnostics and event log below to inspect the failure.',
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

function getResultEmptyLabel(job: EditJobDetail) {
  if (job.status === 'failed') {
    return 'No result image was uploaded because the job failed.'
  }

  if (job.status === 'processing') {
    return 'Result image is still rendering.'
  }

  return 'No result image is available yet.'
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
        <Link to="/">Back to queue</Link>
      </section>
    )
  }

  if (!job) {
    return (
      <section className="panel stack">
        <strong>Job not found</strong>
        <Link to="/">Back to queue</Link>
      </section>
    )
  }

  const latestEvent = job.events[0] ?? null
  const autoRefresh = shouldAutoRefresh(job)
  const statusSummary = getStatusSummary(job)
  const failureDiagnostics = getFailureDiagnostics(job)
  const comparisonEmptyState = getComparisonEmptyState(job)
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
      open: 'Open mask',
      download: 'Download mask',
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

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="hero-kicker">Editor Job</div>
            <h1 style={{ margin: '0.2rem 0 0.4rem' }}>{job.id}</h1>
          </div>
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <span className="status-pill">{job.status}</span>
            <button
              className="button"
              disabled={loading || isRefreshing}
              type="button"
              onClick={() => void loadJob({ background: Boolean(job) })}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh now'}
            </button>
          </div>
        </div>
        <p className="muted">
          {autoRefresh
            ? `Auto-refresh is on every ${autoRefreshIntervalMs / 1000} seconds while the job is queued or processing.`
            : 'Auto-refresh is off because the job is in a terminal state.'}
        </p>
        <div className={statusSummary.className}>
          <strong>{statusSummary.title}</strong>
          <div>{statusSummary.description}</div>
        </div>
        {error ? (
          <div className="alert alert-error">
            <strong>Refresh failed</strong>
            <div>{error}</div>
            <div className="muted">Showing the last persisted snapshot loaded successfully.</div>
          </div>
        ) : null}
        {failureDiagnostics ? (
          <div className="alert alert-error">
            <strong>Failure diagnostics</strong>
            <div className="muted">
              The latest worker failure payload is surfaced here so you do not have to scroll to the event log first.
            </div>
            <pre className="code">{failureDiagnostics}</pre>
          </div>
        ) : null}

        <div className="detail-grid">
          <div className="job-card">
            <strong>Stage</strong>
            <div>{job.stage ?? 'n/a'}</div>
          </div>
          <div className="job-card">
            <strong>Progress</strong>
            <div>{job.progress ?? 0}%</div>
          </div>
          <div className="job-card">
            <strong>Provider</strong>
            <div>{job.provider}</div>
          </div>
          <div className="job-card">
            <strong>Model</strong>
            <div>{job.model}</div>
          </div>
          <div className="job-card">
            <strong>Last loaded</strong>
            <div>{formatTimestamp(lastLoadedAt)}</div>
          </div>
        </div>
      </section>

      <section className="panel">
        <ImageComparisonCard
          emptyLabel={comparisonEmptyState.label}
          emptyTitle={comparisonEmptyState.title}
          resultAlt={`Result comparison image for job ${job.id}`}
          resultHref={job.resultImageUrl}
          resultSrc={job.resultImageUrl}
          resultActions={resultActions}
          sourceAlt={`Source comparison image for job ${job.id}`}
          sourceActions={sourceActions}
          sourceHref={job.sourceImageUrl}
          sourceSrc={job.sourceImageUrl}
          summary={getComparisonSummary(job)}
          title="Source vs result"
          emptyActions={sourceActions}
        />
      </section>

      <section className="panel detail-grid">
        <ImagePreviewCard
          alt={`Source image for job ${job.id}`}
          actions={sourceActions}
          href={job.sourceImageUrl}
          src={job.sourceImageUrl}
          summary={formatImageSummary([
            job.width && job.height ? `${job.width} x ${job.height}` : null,
            job.sourceMimeType,
            formatFileSize(job.fileSize),
          ])}
          title="Source image"
        />
        <ImagePreviewCard
          alt={`Mask image for job ${job.id}`}
          actions={maskActions}
          href={job.maskImageUrl}
          src={job.maskImageUrl}
          summary={formatImageSummary([
            job.width && job.height ? `${job.width} x ${job.height}` : null,
            'Uploaded mask',
          ])}
          title="Mask image"
        />
        <ImagePreviewCard
          alt={`Result image for job ${job.id}`}
          actions={resultActions}
          emptyLabel={getResultEmptyLabel(job)}
          href={job.resultImageUrl}
          src={job.resultImageUrl}
          summary={formatImageSummary([
            job.resultMimeType,
            job.status === 'succeeded' ? 'Completed output' : null,
          ])}
          title="Result image"
        />
      </section>

      <section className="panel detail-grid">
        <div>
          <strong>Prompt</strong>
          <div>{job.prompt ?? 'No prompt provided.'}</div>
        </div>
        <div>
          <strong>Error Code</strong>
          <div>{job.errorCode ?? 'None'}</div>
        </div>
        <div>
          <strong>Error Message</strong>
          <div>{job.errorMessage ?? 'None'}</div>
        </div>
        <div>
          <strong>Timing</strong>
          <div>
            Created {new Date(job.createdAt).toLocaleString()}
            {job.startedAt ? `, started ${new Date(job.startedAt).toLocaleString()}` : ''}
            {job.finishedAt ? `, finished ${new Date(job.finishedAt).toLocaleString()}` : ''}
          </div>
        </div>
        <div>
          <strong>Images</strong>
          <div>
            {job.width && job.height ? `${job.width} x ${job.height}` : 'Unknown dimensions'}
          </div>
        </div>
        <div>
          <strong>Processing Time</strong>
          <div>{formatProcessingTime(job.processingMs)}</div>
        </div>
        <div>
          <strong>Latest Event</strong>
          <div>{latestEvent ? `${latestEvent.type} at ${formatTimestamp(latestEvent.createdAt)}` : 'No events recorded.'}</div>
        </div>
      </section>

      <section className="panel">
        <h2>Event log</h2>
        <div className="event-list">
          {job.events.length === 0 ? (
            <div className="muted">No events recorded.</div>
          ) : (
            job.events.map((event) => (
              <article className="event-item" key={event.id}>
                <div className="actions" style={{ justifyContent: 'space-between' }}>
                  <strong>{event.type}</strong>
                  <span className="muted">{new Date(event.createdAt).toLocaleString()}</span>
                </div>
                {event.message ? <p>{event.message}</p> : null}
                {event.payloadJson ? (
                  <pre className="code">{JSON.stringify(event.payloadJson, null, 2)}</pre>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
