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

function getLatestJobSummary(job: EditJobRecord | null) {
  if (!job) {
    return 'No jobs created yet'
  }

  return `${job.status} • ${new Date(job.createdAt).toLocaleString()}`
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
  const draftMaskPreviewUrl = useObjectUrl(draftMaskFile)

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
  const latestJob = jobs[0] ?? null
  const maskModalHeaderActions = (
    <>
      <span className="status-pill status-pill-ready">Workspace</span>
      <span className={`inline-status ${draftMaskFile ? 'is-ready' : 'is-pending'}`}>
        {draftMaskFile ? 'Draft mask ready' : 'Draft mask pending'}
      </span>
    </>
  )

  return (
    <div className="home-page">
      <section className="hero-banner">
        <div className="hero-banner-copy">
          <div className="hero-kicker">AI Inpaint Studio</div>
          <h1 className="hero-title">Local masked image edits with a cleaner creator workflow.</h1>
          <p className="hero-description muted">
            Keep the same source upload, modal mask editor, prompt, submit flow, and recent job
            tracking, but present it like a focused editing product instead of a runtime console.
          </p>
          <div className="hero-actions">
            <a className="button" href="#create-edit-job">
              Start a new edit
            </a>
            <span className={`hero-runtime-chip ${getRuntimeCreateTone(runtimeReport)}`}>
              {getRuntimeCreateStatusLabel(runtimeReport)}
            </span>
          </div>
          <div className="hero-stat-grid">
            <article className="stat-card">
              <span className="stat-label">Create jobs</span>
              <strong className="stat-value">
                {runtimeReport ? (runtimeReport.overall.canCreateJob ? 'Ready' : 'Blocked') : '...'}
              </strong>
              <span className="muted">Live runtime gate for submissions</span>
            </article>
            <article className="stat-card">
              <span className="stat-label">Active jobs</span>
              <strong className="stat-value">{activeJobs.length}</strong>
              <span className="muted">Queued or processing right now</span>
            </article>
            <article className="stat-card">
              <span className="stat-label">Latest activity</span>
              <strong className="stat-value stat-value-compact">
                {latestJob ? latestJob.id.slice(0, 8) : 'None'}
              </strong>
              <span className="muted">{getLatestJobSummary(latestJob)}</span>
            </article>
          </div>
        </div>

        <aside className="workflow-card">
          <div className="section-eyebrow">Workflow</div>
          <h2 className="section-title">Four steps, same pipeline</h2>
          <div className="workflow-list">
            <div className="workflow-step">
              <span className="workflow-step-number">1</span>
              <div>
                <strong>Upload the source image</strong>
                <p className="muted">PNG, JPEG, and WEBP uploads stay supported.</p>
              </div>
            </div>
            <div className="workflow-step">
              <span className="workflow-step-number">2</span>
              <div>
                <strong>Paint the editable mask</strong>
                <p className="muted">The modal editor still exports a PNG mask for submit.</p>
              </div>
            </div>
            <div className="workflow-step">
              <span className="workflow-step-number">3</span>
              <div>
                <strong>Describe the edit</strong>
                <p className="muted">Prompts remain optional for quick cleanup passes.</p>
              </div>
            </div>
            <div className="workflow-step">
              <span className="workflow-step-number">4</span>
              <div>
                <strong>Submit and monitor jobs</strong>
                <p className="muted">Recent runs and the job detail view stay one click away.</p>
              </div>
            </div>
          </div>
          <div className="alert">
            Uses the existing runtime and job pipeline. Runtime health stays explicit in the panel
            below, but the intake surface is optimized for creative flow first.
          </div>
        </aside>
      </section>

      <div className="home-layout">
        <section className="panel intake-panel" id="create-edit-job">
          <div className="section-heading">
            <div className="section-heading-copy">
              <div className="section-eyebrow">New edit</div>
              <h2 className="section-title">Create a masked edit job</h2>
              <p className="section-description muted">
                Upload a source, refine the editable region in the modal mask editor, add optional
                guidance, and jump straight into the job detail page after submit.
              </p>
            </div>
            <div className={`hero-runtime-chip ${getRuntimeCreateTone(runtimeReport)}`}>
              {runtimeReport
                ? (createJobBlockedReason ?? 'Submission path is clear')
                : 'Checking runtime'}
            </div>
          </div>

          <form className="intake-form" onSubmit={handleSubmit}>
            <div className="upload-grid">
              <label className="upload-card field">
                <div className="upload-card-header">
                  <span className="step-badge">Step 1</span>
                  <strong>Source image</strong>
                </div>
                <span className="muted">
                  Upload one source frame to edit. Selecting a file opens the mask workspace
                  immediately. Supported formats: PNG, JPEG, WEBP.
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

              <section className="mask-launch-card">
                <div className="upload-card-header">
                  <span className="step-badge">Step 2</span>
                  <strong>Mask editor</strong>
                </div>
                <p className="muted">
                  The workspace opens as soon as a source is selected. Use this button to reopen
                  it, while Cancel preserves the last confirmed mask and Confirm replaces the file
                  used for submit.
                </p>
                <div className="actions">
                  <button
                    className="button"
                    disabled={!sourceFile}
                    type="button"
                    onClick={handleOpenMaskEditor}
                  >
                    {maskFile ? 'Refine mask' : 'Open mask editor'}
                  </button>
                  <span className={`inline-status ${maskFile ? 'is-ready' : 'is-pending'}`}>
                    {maskFile ? 'Mask confirmed' : 'Mask required before submit'}
                  </span>
                </div>
                <span className="upload-summary">
                  {getMaskPreviewSummary(maskFile) ??
                    'No confirmed mask yet. Paint a region to unlock submission.'}
                </span>
              </section>
            </div>

            <section className="stack">
              <div className="section-heading-copy">
                <div className="section-eyebrow">Preview</div>
                <h3 className="subsection-title">Check source and generated mask</h3>
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
                  title="Generated mask"
                />
              </div>
            </section>

            <label className="field prompt-field">
              <div className="upload-card-header">
                <span className="step-badge">Step 3</span>
                <strong>Prompt</strong>
              </div>
              <span className="muted">
                Optional guidance for what should be filled, replaced, or extended.
              </span>
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
                <strong>Submit the edit job</strong>
              </div>
              <p className="muted">
                Submitting uploads the source and mask, creates the queued job record, and opens
                the job detail page so you can follow the lifecycle from there.
              </p>
              <div className="actions">
                <button
                  className="button button-cta"
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
                <span className="muted">
                  Default provider path stays unchanged. Unsupported runtime states still fail
                  explicitly.
                </span>
              </div>
              <div className="form-feedback">
                {createJobBlockedReason ? (
                  <div className="alert alert-error">{createJobBlockedReason}</div>
                ) : null}
                {message ? <div className="alert">{message}</div> : null}
              </div>
            </section>
          </form>
        </section>

        <aside className="sidebar">
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
                <h2 className="section-title">Track the latest runs</h2>
                <p className="section-description muted">
                  Use the detail page to inspect lifecycle state, provider selection, and worker
                  events for each submitted edit.
                </p>
              </div>
              <button className="button button-secondary" type="button" onClick={() => void refreshJobs()}>
                Refresh
              </button>
            </div>

            {listJobsBlockedReason ? (
              <div className="alert alert-error">{listJobsBlockedReason}</div>
            ) : null}
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
        </aside>
      </div>

      <ModalShell
        bodyClassName="editor-modal-body"
        className="editor-modal-shell-frame"
        description="Paint or refine the editable region in one workspace. The right rail keeps the source and live draft visible while Confirm replaces the mask used for submit."
        eyebrow="Mask Workspace"
        footer={
          <>
            <div className="editor-workspace-footer-copy">
              <strong>{draftMaskFile ? 'Draft mask ready to confirm.' : 'Paint at least one editable region.'}</strong>
              <span className="muted">
                {draftMaskFile
                  ? 'Confirm replaces the current mask preview and the file used for submit.'
                  : 'The workspace stays live while you paint. Cancel keeps the last confirmed mask.'}
              </span>
            </div>
            <div className="actions">
              <button className="button button-secondary" type="button" onClick={handleCancelMaskEditor}>
                Cancel
              </button>
              <button
                className="button"
                disabled={!draftMaskFile}
                type="button"
                onClick={handleConfirmMaskEditor}
              >
                Confirm mask
              </button>
            </div>
          </>
        }
        headerActions={maskModalHeaderActions}
        open={isMaskEditorOpen}
        title="Mask editor"
        onClose={handleCancelMaskEditor}
      >
        <div className="editor-workspace-shell">
          <div className="editor-workspace-main">
            <MaskPaintEditor
              initialMaskUrl={maskPreviewUrl}
              sourceFile={sourceFile}
              sourceUrl={sourcePreviewUrl}
              onMaskChange={handleDraftMaskChange}
            />
          </div>

          <aside className="editor-workspace-sidebar">
            <section className="editor-workspace-summary">
              <div className="section-heading-copy">
                <div className="section-eyebrow">Workspace status</div>
                <h3 className="subsection-title">Keep the full image in view while you paint</h3>
                <p className="muted" style={{ marginBottom: 0 }}>
                  Overlay, Source, and Mask views stay in the same editor. The previews here update
                  live so you can confirm the overall composition without leaving the workspace.
                </p>
              </div>
              <div className="editor-workspace-checklist muted">
                <span>{sourceFile ? `Source loaded: ${sourceFile.name}` : 'Source image pending'}</span>
                <span>{draftMaskFile ? 'Draft mask updates live in the rail.' : 'Draft preview appears after the first stroke.'}</span>
                <span>Confirm replaces the mask preview used for submit.</span>
              </div>
            </section>

            <ImagePreviewCard
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
              alt="Source workspace preview"
              badge="Source"
              emptyLabel="Choose a source image to begin editing."
              src={sourcePreviewUrl}
              summary={getSelectedFileSummary(sourceFile)}
              title="Source reference"
              variant="supporting"
            />

            <ImagePreviewCard
              actions={
                draftMaskPreviewUrl
                  ? [
                      {
                        href: draftMaskPreviewUrl,
                        label: 'Open draft mask',
                        tone: 'secondary',
                      },
                      {
                        href: draftMaskPreviewUrl,
                        label: 'Download draft mask',
                        download: getMaskDownloadFilename(sourceFile),
                      },
                    ]
                  : undefined
              }
              alt="Draft mask workspace preview"
              badge="Draft"
              emptyLabel="Paint at least one editable region to generate the live draft preview."
              src={draftMaskPreviewUrl}
              summary={getMaskPreviewSummary(draftMaskFile)}
              title="Live draft mask"
              variant="supporting"
            />
          </aside>
        </div>
      </ModalShell>
    </div>
  )
}
