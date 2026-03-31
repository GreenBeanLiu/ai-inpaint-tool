import { useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

import type { ApiErrorResponse, EditJobDetail } from '@/lib/types'

export const Route = createFileRoute('/editor/$jobId')({
  component: EditorJobPage,
})

function EditorJobPage() {
  const { jobId } = Route.useParams()
  const [job, setJob] = useState<EditJobDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/edit-jobs/${jobId}`)
        const payload = (await response.json()) as
          | { job: EditJobDetail }
          | ApiErrorResponse

        if (!response.ok || !('job' in payload)) {
          throw new Error('error' in payload ? payload.error.message : 'Failed to fetch job')
        }

        if (!cancelled) {
          setJob(payload.job)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unexpected error')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [jobId])

  if (loading) {
    return <section className="panel">Loading job {jobId}...</section>
  }

  if (error) {
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

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="hero-kicker">Editor Job</div>
            <h1 style={{ margin: '0.2rem 0 0.4rem' }}>{job.id}</h1>
          </div>
          <span className="status-pill">{job.status}</span>
        </div>
        <p className="muted">
          This page shows the persisted record only. Realtime delivery and background worker
          execution are not wired, so refresh the page to observe later backend changes.
        </p>
        <div className="alert">
          <strong>Current MVP boundary:</strong> source and mask uploads, job persistence, and
          Trigger dispatch are real. The Gemini edit call and realtime push delivery still fail
          or remain absent intentionally until those integrations are finished.
        </div>

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
        </div>
      </section>

      <section className="panel detail-grid">
        <div>
          <strong>Source Image</strong>
          <div><a href={job.sourceImageUrl}>{job.sourceImageUrl}</a></div>
        </div>
        <div>
          <strong>Mask Image</strong>
          <div><a href={job.maskImageUrl}>{job.maskImageUrl}</a></div>
        </div>
        <div>
          <strong>Result Image</strong>
          <div>{job.resultImageUrl ? <a href={job.resultImageUrl}>{job.resultImageUrl}</a> : 'Pending'}</div>
        </div>
        <div>
          <strong>Error</strong>
          <div>{job.errorMessage ?? 'None'}</div>
        </div>
        <div>
          <strong>Timing</strong>
          <div>
            Created {new Date(job.createdAt).toLocaleString()}
            {job.finishedAt ? `, finished ${new Date(job.finishedAt).toLocaleString()}` : ''}
          </div>
        </div>
        <div>
          <strong>Images</strong>
          <div>
            {job.width && job.height ? `${job.width} x ${job.height}` : 'Unknown dimensions'}
          </div>
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
