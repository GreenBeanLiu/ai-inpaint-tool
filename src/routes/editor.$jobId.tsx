import { useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

import { ImagePreviewCard } from '@/components/image-preview-card'
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

      <section className="panel detail-grid">
        <ImagePreviewCard
          alt={`Source image for job ${job.id}`}
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
          emptyLabel="No result image is available yet."
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
