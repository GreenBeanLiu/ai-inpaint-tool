import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'

import { ImagePreviewCard } from '@/components/image-preview-card'
import { MaskPaintEditor } from '@/components/mask-paint-editor'
import { ModalShell } from '@/components/modal-shell'
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

function getRuntimeCreateStatusLabel(report: RuntimeCheckReport | null) {
  if (!report) {
    return 'Checking runtime'
  }

  return report.overall.canCreateJob ? 'Ready to create jobs' : 'Runtime attention needed'
}

function getRuntimeCreateTone(report: RuntimeCheckReport | null) {
  if (!report) {
    return 'is-pending'
  }

  return report.overall.canCreateJob ? 'is-ready' : 'is-blocked'
}

function HomePage() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [maskFile, setMaskFile] = useState<File | null>(null)
  const [draftMaskFile, setDraftMaskFile] = useState<File | null>(null)
  const [jobs, setJobs] = useState<EditJobRecord[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isMaskEditorOpen, setIsMaskEditorOpen] = useState(false)
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

  const handleSourceFileChange = useCallback((file: File | null) => {
    setSourceFile(file)
    setMaskFile(null)
    setDraftMaskFile(null)
    setMessage(null)
    setIsMaskEditorOpen(Boolean(file))
  }, [])

  const handleDraftMaskChange = useCallback((file: File | null) => {
    setDraftMaskFile(file)
  }, [])

  function handleOpenMaskEditor() {
    if (!sourceFile) {
      setMessage('Choose a source image before opening the mask editor.')
      return
    }

    setDraftMaskFile(maskFile)
    setMessage(null)
    setIsMaskEditorOpen(true)
  }

  function handleCancelMaskEditor() {
    setDraftMaskFile(maskFile)
    setIsMaskEditorOpen(false)
  }

  function handleConfirmMaskEditor() {
    if (!draftMaskFile) {
      return
    }

    setMaskFile(draftMaskFile)
    setIsMaskEditorOpen(false)
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
      setDraftMaskFile(null)
      setIsMaskEditorOpen(false)
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
  const activeJobs = jobs.filter((job) => job.status === 'queued' || job.status === 'processing')

  return (
    <div className="home-page">
      <section className="panel intake-panel simplified-intake-panel" id="create-edit-job">
        <div className="simple-home-heading">
          <div className="section-heading">
            <div className="section-heading-copy">
              <div className="section-eyebrow">New edit</div>
              <h1 className="section-title">Upload, paint, submit.</h1>
              <p className="section-description muted">
                Choose a source image and the painter opens immediately. Confirm the mask, add an
                optional prompt, then submit through the same job pipeline.
              </p>
            </div>
            <span className={`hero-runtime-chip ${getRuntimeCreateTone(runtimeReport)}`}>
              {runtimeReport
                ? createJobBlockedReason ?? getRuntimeCreateStatusLabel(runtimeReport)
                : 'Checking runtime'}
            </span>
          </div>

          <div className="simple-home-stats">
            <span className={`inline-status ${sourceFile ? 'is-ready' : 'is-pending'}`}>
              {sourceFile ? `Source: ${sourceFile.name}` : 'Source image not selected'}
            </span>
            <span className={`inline-status ${maskFile ? 'is-ready' : 'is-pending'}`}>
              {maskFile ? 'Mask confirmed' : 'Mask required'}
            </span>
            <span className="inline-status is-pending">{activeJobs.length} active jobs</span>
          </div>
        </div>

        <form className="intake-form simplified-intake-form" onSubmit={handleSubmit}>
          <div className="simple-intake-grid">
            <label className="upload-card field">
              <div className="upload-card-header">
                <span className="step-badge">Step 1</span>
                <strong>Source image</strong>
              </div>
              <span className="muted">
                PNG, JPEG, and WEBP are supported. Picking a file opens the painter immediately.
              </span>
              <input
                accept="image/png,image/jpeg,image/webp"
                name="image"
                onChange={(event) => handleSourceFileChange(event.target.files?.[0] ?? null)}
                required
                type="file"
              />
              <span className="upload-summary">
                {getSelectedFileSummary(sourceFile) ?? 'No image selected yet.'}
              </span>
            </label>

            <section className="mask-launch-card simplified-mask-card">
              <div className="upload-card-header">
                <span className="step-badge">Step 2</span>
                <strong>Mask painter</strong>
              </div>
              <p className="muted">
                Reopen the painter any time. Cancel keeps the last confirmed mask. Confirm replaces
                the mask file that will be uploaded.
              </p>
              <div className="actions">
                <button
                  className="button"
                  disabled={!sourceFile}
                  type="button"
                  onClick={handleOpenMaskEditor}
                >
                  {maskFile ? 'Reopen painter' : 'Open painter'}
                </button>
                <span className={`inline-status ${maskFile ? 'is-ready' : 'is-pending'}`}>
                  {maskFile ? 'Mask confirmed' : 'Paint a mask'}
                </span>
              </div>
              <span className="upload-summary">
                {getMaskPreviewSummary(maskFile) ??
                  'No confirmed mask yet. Paint at least one editable region.'}
              </span>
            </section>
          </div>

          <section className="stack">
            <div className="section-heading">
              <div className="section-heading-copy">
                <div className="section-eyebrow">Preview</div>
                <h2 className="subsection-title">Source and mask</h2>
              </div>
              <button
                className="button button-secondary"
                disabled={!sourceFile}
                type="button"
                onClick={handleOpenMaskEditor}
              >
                {maskFile ? 'Refine mask' : 'Paint mask'}
              </button>
            </div>
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
                title="Confirmed mask"
              />
            </div>
          </section>

          <label className="field prompt-field">
            <div className="upload-card-header">
              <span className="step-badge">Step 3</span>
              <strong>Prompt</strong>
            </div>
            <span className="muted">Optional guidance for what should be filled or replaced.</span>
            <textarea
              name="prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the new content, cleanup, or replacement you want."
            />
          </label>

          <section className="submit-card">
            <div className="upload-card-header">
              <span className="step-badge">Step 4</span>
              <strong>Submit job</strong>
            </div>
            <p className="muted">
              This keeps the same source upload, mask export, and job creation flow.
            </p>
            <div className="actions">
              <button
                className="button button-cta"
                disabled={isSubmitting || Boolean(createJobBlockedReason) || !sourceFile || !maskFile}
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
              <span className="muted">
                Opens the job detail page immediately after the record is created.
              </span>
            </div>
            <div className="form-feedback">
              {createJobBlockedReason ? <div className="alert alert-error">{createJobBlockedReason}</div> : null}
              {message ? <div className="alert">{message}</div> : null}
            </div>
          </section>
        </form>
      </section>

      <div className="simple-home-secondary">
        <RuntimeStatusPanel
          error={runtimeError}
          isLoading={isRefreshingRuntime}
          onRefresh={refreshRuntimeCheck}
          report={runtimeReport}
        />

        <section className="panel recent-jobs-panel">
          <div className="section-heading">
            <div className="section-heading-copy">
              <div className="section-eyebrow">Recent jobs</div>
              <h2 className="section-title">Latest runs</h2>
              <p className="section-description muted">
                Use the detail page to inspect lifecycle state, provider selection, and worker events.
              </p>
            </div>
            <button className="button button-secondary" type="button" onClick={() => void refreshJobs()}>
              Refresh
            </button>
          </div>

          {listJobsBlockedReason ? <div className="alert alert-error">{listJobsBlockedReason}</div> : null}
          {loadError ? <div className="alert alert-error">{loadError}</div> : null}

          <div className="recent-job-list">
            {jobs.length === 0 ? (
              <div className="job-card muted">No jobs loaded yet. Submit a new edit or refresh.</div>
            ) : (
              jobs.map((job) => (
                <article className="recent-job-card" key={job.id}>
                  <div className="recent-job-header">
                    <div className="stack" style={{ gap: '0.35rem' }}>
                      <strong className="job-id">{job.id}</strong>
                      <span className="muted">
                        {job.provider} • {job.model}
                      </span>
                    </div>
                    <span className="status-pill">{job.status}</span>
                  </div>
                  <div className="recent-job-meta muted">
                    <span>Stage: {job.stage ?? 'accepted'}</span>
                    <span>Created: {new Date(job.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="muted">{job.prompt || 'No prompt provided.'}</p>
                  <Link className="inline-link" params={{ jobId: job.id }} to="/editor/$jobId">
                    Open job details
                  </Link>
                </article>
              ))
            )}
          </div>
        </section>
      </div>

      <ModalShell
        bodyClassName="canvas-editor-modal-body"
        className="canvas-editor-modal"
        headerActions={
          <div className="canvas-editor-header-actions">
            <span className={`status-pill ${draftMaskFile ? 'status-pill-ready' : ''}`}>
              {draftMaskFile ? 'Draft ready' : 'Mask required'}
            </span>
            <button className="button button-secondary" type="button" onClick={handleCancelMaskEditor}>
              Cancel
            </button>
            <button
              className="button"
              disabled={!draftMaskFile}
              type="button"
              onClick={handleConfirmMaskEditor}
            >
              Use mask
            </button>
          </div>
        }
        open={isMaskEditorOpen}
        showCloseButton={false}
        title="Mask painter"
        onClose={handleCancelMaskEditor}
      >
        <MaskPaintEditor
          initialMaskUrl={maskPreviewUrl}
          sourceFile={sourceFile}
          sourceUrl={sourcePreviewUrl}
          onMaskChange={handleDraftMaskChange}
        />
      </ModalShell>
    </div>
  )
}
