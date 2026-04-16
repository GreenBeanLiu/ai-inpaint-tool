import { useEffect, useState, type FormEvent } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'

import { ImagePreviewCard } from '@/components/image-preview-card'
import { MaskPaintEditor } from '@/components/mask-paint-editor'
import { RuntimeStatusPanel } from '@/components/runtime-status-panel'
import type { ApiErrorResponse, EditJobRecord, RuntimeCheckReport } from '@/lib/types'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setUrl(null)
      return
    }

    const nextUrl = URL.createObjectURL(file)
    setUrl(nextUrl)

    return () => {
      URL.revokeObjectURL(nextUrl)
    }
  }, [file])

  return url
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const kb = bytes / 1024

  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`
  }

  return `${(kb / 1024).toFixed(1)} MB`
}

function getSelectedFileSummary(file: File | null) {
  if (!file) {
    return null
  }

  const type = file.type || 'Unknown type'
  return `${file.name} • ${type} • ${formatFileSize(file.size)}`
}

function getMaskPreviewSummary(file: File | null) {
  if (!file) {
    return null
  }

  return `${getSelectedFileSummary(file)} • Transparent areas are editable`
}

function stripExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, '')
}

function getMaskDownloadFilename(sourceFile: File | null) {
  const baseName = sourceFile ? stripExtension(sourceFile.name) : 'mask'
  const safeBaseName = baseName.trim() || 'mask'
  return `${safeBaseName}-mask.png`
}

function HomePage() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [maskFile, setMaskFile] = useState<File | null>(null)
  const [jobs, setJobs] = useState<EditJobRecord[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRefreshingRuntime, setIsRefreshingRuntime] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [runtimeReport, setRuntimeReport] = useState<RuntimeCheckReport | null>(null)
  const sourcePreviewUrl = useObjectUrl(sourceFile)
  const maskPreviewUrl = useObjectUrl(maskFile)

  useEffect(() => {
    void refreshRuntimeCheck().catch((error) => {
      setRuntimeError(error instanceof Error ? error.message : 'Failed to load runtime readiness')
    })
    void refreshJobs().catch((error) => {
      setLoadError(error instanceof Error ? error.message : 'Failed to load jobs')
    })
  }, [])

  async function refreshRuntimeCheck() {
    setIsRefreshingRuntime(true)

    try {
      const response = await fetch('/api/runtime-check')
      const payload = (await response.json()) as RuntimeCheckReport | ApiErrorResponse

      if (!response.ok || !('checkedAt' in payload)) {
        const errorMessage =
          'error' in payload ? payload.error.message : 'Failed to load runtime readiness'
        throw new Error(errorMessage)
      }

      setRuntimeReport(payload)
      setRuntimeError(null)
    } finally {
      setIsRefreshingRuntime(false)
    }
  }

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

  function getPersistedJobIdFromError(payload: ApiErrorResponse): string | null {
    const details = payload.error.details

    if (!details || typeof details !== 'object') {
      return null
    }

    const job = (details as Record<string, unknown>).job

    if (!job || typeof job !== 'object') {
      return null
    }

    return typeof (job as Record<string, unknown>).id === 'string'
      ? ((job as Record<string, unknown>).id as string)
      : null
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)

    if (!sourceFile) {
      setMessage('Choose a source image before submitting.')
      return
    }

    if (!maskFile) {
      setMessage('Paint a mask region before submitting.')
      return
    }

    setIsSubmitting(true)

    try {
      const formData = new FormData(event.currentTarget)
      formData.set('image', sourceFile, sourceFile.name)
      formData.set('mask', maskFile, maskFile.name)
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
        if ('error' in payload) {
          const persistedJobId = getPersistedJobIdFromError(payload)

          if (persistedJobId) {
            await navigate({
              to: '/editor/$jobId',
              params: { jobId: persistedJobId },
            })
            return
          }

          throw new Error(payload.error.message)
        }

        throw new Error('Failed to create job')
      }

      setPrompt('')
      setSourceFile(null)
      setMaskFile(null)
      event.currentTarget.reset()
      await navigate({
        to: '/editor/$jobId',
        params: { jobId: payload.job.id },
      })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unexpected error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const createJobBlockedReason = runtimeReport?.overall.canCreateJob
    ? null
    : runtimeReport?.overall.blockers[0] ?? null
  const listJobsBlockedReason = runtimeReport?.overall.canListJobs
    ? null
    : runtimeReport?.overall.blockers.find((blocker) =>
        blocker.toLowerCase().includes('database'),
      ) ??
      runtimeReport?.overall.blockers[0] ??
      null

  return (
    <div className="hero">
      <section className="hero-card">
        <div className="hero-kicker">Closed Loop Intake</div>
        <h1 className="hero-title">Create real local masked edit jobs with an OpenRouter worker path.</h1>
        <p className="muted">
          This MVP round validates intake, writes queued jobs to Prisma-backed storage,
          and runs a real OpenRouter image edit worker for supported masked inpainting jobs
          without faking generated results.
        </p>
      </section>

      <section className="hero-grid">
        <article className="panel">
          <div className="hero-kicker">Working Now</div>
          <h2>Real masked edit worker</h2>
          <p className="muted">
            `POST /api/edit-jobs` accepts multipart image uploads, stores the uploaded assets
            in R2, writes queued jobs to Prisma, dispatches a real Trigger.dev run, and
            executes OpenRouter image edits when the upload constraints are satisfied.
          </p>
        </article>
        <article className="panel">
          <div className="hero-kicker">Still Strict</div>
          <h2>Honest failures only</h2>
          <p className="muted">
            Unsupported providers, mismatched source and mask formats, missing env, and
            non-mask-capable paths fail explicitly. Realtime updates and advanced editor UX
            are still intentionally out of scope.
          </p>
        </article>
      </section>

      <RuntimeStatusPanel
        error={runtimeError}
        isLoading={isRefreshingRuntime}
        onRefresh={refreshRuntimeCheck}
        report={runtimeReport}
      />

      <div className="hero-grid">
        <section className="panel">
          <h2>Create edit job</h2>
          <p className="muted">
            Upload one source image, paint the editable area in the browser, and submit an
            optional prompt. The app exports the painted mask as a PNG, then the server uploads
            both files to R2 before creating the queued job record. The current default path is
            OpenRouter masked editing, which accepts PNG, JPEG, or WEBP sources and a PNG or
            WEBP mask. After submit, the app opens the job detail page so you can watch lifecycle
            updates there.
          </p>
          <form className="stack" onSubmit={handleSubmit}>
            <label className="field">
              <span>Source image</span>
              <input
                accept="image/png,image/jpeg,image/webp"
                name="image"
                onChange={(event) => setSourceFile(event.target.files?.[0] ?? null)}
                required
                type="file"
              />
            </label>

            <MaskPaintEditor
              sourceFile={sourceFile}
              sourceUrl={sourcePreviewUrl}
              onMaskChange={setMaskFile}
            />

            <div className="preview-grid">
              <ImagePreviewCard
                alt="Selected source preview"
                actions={
                  sourcePreviewUrl && sourceFile
                    ? [
                        {
                          href: sourcePreviewUrl,
                          label: 'Open source',
                          tone: 'secondary',
                        },
                        {
                          href: sourcePreviewUrl,
                          label: 'Download source',
                          download: sourceFile.name,
                        },
                      ]
                    : undefined
                }
                emptyLabel="Choose a source image to preview it before submission."
                src={sourcePreviewUrl}
                summary={getSelectedFileSummary(sourceFile)}
                title="Source preview"
              />
              <ImagePreviewCard
                alt="Generated mask preview"
                actions={
                  maskPreviewUrl
                    ? [
                        {
                          href: maskPreviewUrl,
                          label: 'Open mask',
                          tone: 'secondary',
                        },
                        {
                          href: maskPreviewUrl,
                          label: 'Download mask',
                          download: getMaskDownloadFilename(sourceFile),
                        },
                      ]
                    : undefined
                }
                emptyLabel="Paint the editable region to generate a mask preview."
                src={maskPreviewUrl}
                summary={getMaskPreviewSummary(maskFile)}
                title="Generated mask"
              />
            </div>

            <label className="field">
              <span>Prompt</span>
              <textarea
                name="prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe what should be filled or replaced."
              />
            </label>

            <div className="actions">
              <button
                className="button"
                disabled={
                  isSubmitting ||
                  Boolean(createJobBlockedReason) ||
                  !sourceFile ||
                  !maskFile
                }
                type="submit"
              >
                {isSubmitting
                  ? 'Submitting...'
                  : createJobBlockedReason
                    ? 'Creation blocked by runtime config'
                    : !sourceFile
                      ? 'Choose a source image'
                      : !maskFile
                        ? 'Paint a mask to continue'
                    : 'Create queued job'}
              </button>
              {createJobBlockedReason ? <span className="muted">{createJobBlockedReason}</span> : null}
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
            Use the detail page to inspect lifecycle state, provider/model selection, and
            recorded worker events.
          </p>
          {listJobsBlockedReason ? (
            <div className="alert alert-error">{listJobsBlockedReason}</div>
          ) : null}
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
