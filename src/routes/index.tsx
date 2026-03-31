import { useEffect, useState, type FormEvent } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

import type { CreateEditJobInput, EditJobRecord } from '@/lib/types'

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

  useEffect(() => {
    void refreshJobs().catch((error) => {
      setMessage(error instanceof Error ? error.message : 'Failed to load jobs')
    })
  }, [])

  async function refreshJobs() {
    const response = await fetch('/api/edit-jobs')

    if (!response.ok) {
      throw new Error('Failed to load jobs')
    }

    const payload = (await response.json()) as { jobs: EditJobRecord[] }
    setJobs(payload.jobs)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setMessage(null)

    try {
      const response = await fetch('/api/edit-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      })

      const payload = (await response.json()) as
        | { job: EditJobRecord; message?: string }
        | { error: string }

      if (!response.ok || !('job' in payload)) {
        throw new Error('error' in payload ? payload.error : 'Failed to create job')
      }

      setMessage(payload.message ?? `Queued job ${payload.job.id}`)
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
        <div className="hero-kicker">MVP Intake</div>
        <h1 className="hero-title">Queue image inpainting jobs with typed server scaffolding.</h1>
        <p className="muted">
          This first pass accepts job metadata, persists it with Prisma, and exposes
          compile-oriented seams for storage, model execution, and notifications.
        </p>
      </section>

      <div className="hero-grid">
        <section className="panel">
          <h2>Create edit job</h2>
          <form className="stack" onSubmit={handleSubmit}>
            <label className="field">
              <span>Source image URL</span>
              <input
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
          <p className="muted">Job execution is intentionally not auto-triggered yet.</p>
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
