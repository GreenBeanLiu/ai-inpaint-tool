import { useEffect, useState, type FormEvent } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

import type {
  ApiErrorResponse,
  CreateEditJobInput,
  EditJobRecord,
} from '@/lib/types'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  const [form, setForm] = useState<CreateEditJobInput>({
    prompt: '',
    sourceImageUrl: '',
    maskImageUrl: '',
  })
  const [jobs, setJobs] = useState<EditJobRecord[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    void refreshJobs().catch((error) => {
      setLoadError(error instanceof Error ? error.message : 'Failed to load jobs')
    })
  }, [])

  async function refreshJobs() {
    const response = await fetch('/api/edit-jobs')

    if (!response.ok) {
      const payload = (await response.json()) as ApiErrorResponse
      throw new Error(payload.error.message)
    }

    const payload = (await response.json()) as { jobs: EditJobRecord[] }
    setJobs(payload.jobs)
    setLoadError(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setMessage(null)

    try {
      const formData = new FormData(event.currentTarget)
      const response = await fetch('/api/edit-jobs', {
        method: 'POST',
        body: formData,
      })

      const payload = (await response.json()) as
        | {
            job: EditJobRecord
            message?: string
            dispatch?: { attempted: boolean; code: string; message: string }
          }
        | ApiErrorResponse

      if (!response.ok || !('job' in payload)) {
        throw new Error('error' in payload ? payload.error.message : 'Failed to create job')
      }

      setMessage(
        [payload.message, payload.dispatch?.message].filter(Boolean).join(' '),
      )
      setForm({
        prompt: '',
        sourceImageUrl: '',
        maskImageUrl: '',
      })
      await refreshJobs()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unexpected error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="hero">
      <section className="hero-card">
        <div className="hero-kicker">Closed Loop Intake</div>
        <h1 className="hero-title">Create real local edit jobs before the model pipeline exists.</h1>
        <p className="muted">
          This MVP round validates intake, writes queued jobs to Prisma-backed storage,
          and exposes the unfinished seams for Gemini, R2, Trigger, and realtime delivery
          without faking generated results.
        </p>
      </section>

      <section className="hero-grid">
        <article className="panel">
          <div className="hero-kicker">Working Now</div>
          <h2>Local queue + inspection</h2>
          <p className="muted">
            `POST /api/edit-jobs` validates HTML form or JSON input and stores queued jobs
            with event history in SQLite through Prisma.
          </p>
        </article>
        <article className="panel">
          <div className="hero-kicker">Still Gated</div>
          <h2>No fake processing</h2>
          <p className="muted">
            Worker dispatch, Gemini edits, R2 uploads, Trigger orchestration, and WebSocket
            updates are intentionally not implemented yet and should report that clearly.
          </p>
        </article>
      </section>

      <div className="hero-grid">
        <section className="panel">
          <h2>Create edit job</h2>
          <p className="muted">
            Submit public source and mask URLs. The server will validate and persist the job,
            but it will not attempt model execution yet.
          </p>
          <form className="stack" onSubmit={handleSubmit}>
            <label className="field">
              <span>Source image URL</span>
              <input
                name="sourceImageUrl"
                required
                type="url"
                value={form.sourceImageUrl}
                onChange={(event) =>
                  setForm((current) => ({ ...current, sourceImageUrl: event.target.value }))
                }
              />
            </label>

            <label className="field">
              <span>Mask image URL</span>
              <input
                name="maskImageUrl"
                required
                type="url"
                value={form.maskImageUrl}
                onChange={(event) =>
                  setForm((current) => ({ ...current, maskImageUrl: event.target.value }))
                }
              />
            </label>

            <label className="field">
              <span>Prompt</span>
              <textarea
                name="prompt"
                value={form.prompt ?? ''}
                onChange={(event) =>
                  setForm((current) => ({ ...current, prompt: event.target.value }))
                }
                placeholder="Describe what should be filled or replaced."
              />
            </label>

            <div className="actions">
              <button className="button" disabled={isSubmitting} type="submit">
                {isSubmitting ? 'Submitting...' : 'Create queued job'}
              </button>
              {message ? <span className="muted">{message}</span> : null}
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="actions" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Recent jobs</h2>
            <button className="button" type="button" onClick={() => void refreshJobs()}>
              Refresh
            </button>
          </div>
          <p className="muted">
            Jobs remain queued after creation. Use the detail page to inspect lifecycle state
            and recorded events.
          </p>
          {loadError ? <div className="alert alert-error">{loadError}</div> : null}
          <div className="list">
            {jobs.length === 0 ? (
              <div className="job-card muted">No jobs loaded. Use Refresh or create one.</div>
            ) : (
              jobs.map((job) => (
                <article className="job-card" key={job.id}>
                  <div className="actions" style={{ justifyContent: 'space-between' }}>
                    <strong>{job.id}</strong>
                    <span className="status-pill">{job.status}</span>
                  </div>
                  <div className="job-meta muted">
                    <span>Stage: {job.stage ?? 'accepted'}</span>
                    <span>Created: {new Date(job.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="muted">{job.prompt || 'No prompt provided.'}</p>
                  <Link to="/editor/$jobId" params={{ jobId: job.id }}>
                    Open job details
                  </Link>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
