import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'

interface ImageDimensions {
  width: number
  height: number
}

const PROMPT_EXAMPLES = [
  'Remove the person in the background and rebuild the wall behind them.',
  'Replace the masked area with a clean wooden table that matches the scene lighting.',
  'Fill the masked region with blue sky and soft clouds that blend naturally.',
] as const

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

function useImageDimensions(url: string | null) {
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null)

  useEffect(() => {
    if (!url) {
      setDimensions(null)
      return
    }

    let cancelled = false
    const image = new Image()

    image.onload = () => {
      if (cancelled) {
        return
      }

      setDimensions({
        width: image.naturalWidth,
        height: image.naturalHeight,
      })
    }

    image.onerror = () => {
      if (!cancelled) {
        setDimensions(null)
      }
    }

    image.src = url

    return () => {
      cancelled = true
    }
  }, [url])

  return dimensions
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

function formatImageDimensions(dimensions: ImageDimensions | null) {
  if (!dimensions) {
    return null
  }

  return `${dimensions.width} × ${dimensions.height}px`
}

function getSelectedFileSummary(file: File | null, dimensions?: ImageDimensions | null) {
  if (!file) {
    return null
  }

  const type = file.type || 'Unknown type'
  const summaryParts = [
    file.name,
    formatImageDimensions(dimensions ?? null),
    type,
    formatFileSize(file.size),
  ]

  return summaryParts.filter((value): value is string => Boolean(value)).join(' • ')
}

function getMaskPreviewSummary(file: File | null, dimensions?: ImageDimensions | null) {
  if (!file) {
    return null
  }

  return `${getSelectedFileSummary(file, dimensions)} • Transparent areas are editable`
}

function stripExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, '')
}

function getMaskDownloadFilename(sourceFile: File | null) {
  const baseName = sourceFile ? stripExtension(sourceFile.name) : 'mask'
  const safeBaseName = baseName.trim() || 'mask'
  return `${safeBaseName}-mask.png`
}

function getPngFilename(filename: string) {
  const baseName = stripExtension(filename).trim() || 'source'
  return `${baseName}.png`
}

function sourceFileNeedsPngNormalization(file: File | null) {
  return file?.type === 'image/jpeg' || file?.type === 'image/webp'
}

async function normalizeSourceFileForSubmission(file: File): Promise<File> {
  if (!sourceFileNeedsPngNormalization(file)) {
    return file
  }

  const objectUrl = URL.createObjectURL(file)

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image()
      nextImage.onload = () => resolve(nextImage)
      nextImage.onerror = () => reject(new Error('Failed to decode the selected source image for PNG normalization.'))
      nextImage.src = objectUrl
    })

    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight

    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error('Failed to prepare a browser canvas for PNG normalization.')
    }

    context.drawImage(image, 0, 0)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) {
          resolve(value)
          return
        }

        reject(new Error('Failed to encode the selected source image as PNG.'))
      }, 'image/png')
    })

    return new File([blob], getPngFilename(file.name), {
      type: 'image/png',
      lastModified: file.lastModified,
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
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

function haveImageDimensionsMismatch(
  sourceDimensions: ImageDimensions | null,
  maskDimensions: ImageDimensions | null,
) {
  if (!sourceDimensions || !maskDimensions) {
    return false
  }

  return (
    sourceDimensions.width !== maskDimensions.width ||
    sourceDimensions.height !== maskDimensions.height
  )
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
  const sourceDimensions = useImageDimensions(sourcePreviewUrl)
  const maskDimensions = useImageDimensions(maskPreviewUrl)

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
      const sourceFileForSubmission = await normalizeSourceFileForSubmission(sourceFile)
      formData.set('image', sourceFileForSubmission, sourceFileForSubmission.name)
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
  const sourceMaskDimensionMismatch = haveImageDimensionsMismatch(sourceDimensions, maskDimensions)
  const submitValidationItems = [
    {
      label: sourceFile ? 'Source image selected' : 'Choose a source image',
      ready: Boolean(sourceFile),
    },
    {
      label: maskFile ? 'Mask confirmed' : 'Paint and confirm a mask',
      ready: Boolean(maskFile),
    },
    {
      label: sourceMaskDimensionMismatch
        ? 'Source and mask dimensions do not match'
        : 'Source and mask dimensions match',
      ready: !sourceMaskDimensionMismatch,
      pending: Boolean(sourceFile && maskFile && (!sourceDimensions || !maskDimensions)),
    },
    {
      label: createJobBlockedReason ?? 'Runtime ready to create jobs',
      ready: !createJobBlockedReason,
      pending: !runtimeReport,
    },
  ]
  const submitBlockedReason =
    createJobBlockedReason ??
    (sourceMaskDimensionMismatch
      ? 'Fix the source and mask dimensions before submitting.'
      : !sourceFile
        ? 'Choose a source image'
        : !maskFile
          ? 'Paint a mask to continue'
          : null)

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
                PNG, JPEG, and WEBP are supported. JPEG and WEBP are converted to PNG in the
                browser before submission so the default OpenAI mask upload stays compatible.
              </span>
              <input
                accept="image/png,image/jpeg,image/webp"
                name="image"
                onChange={(event) => handleSourceFileChange(event.target.files?.[0] ?? null)}
                required
                type="file"
              />
              <span className="upload-summary">
                {getSelectedFileSummary(sourceFile, sourceDimensions) ?? 'No image selected yet.'}
              </span>
              {sourceFile && sourceFileNeedsPngNormalization(sourceFile) ? (
                <div className="inline-validation-note">
                  This source will be uploaded as {getPngFilename(sourceFile.name)} so it matches
                  the painter&apos;s PNG mask for the default OpenAI submission path.
                </div>
              ) : null}
              {!sourceFile ? (
                <div className="inline-validation-note">A source image is required before you can paint or submit.</div>
              ) : null}
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
                {getMaskPreviewSummary(maskFile, maskDimensions) ??
                  'No confirmed mask yet. Paint at least one editable region.'}
              </span>
              {sourceFile && !maskFile ? (
                <div className="inline-validation-note">
                  Open the painter and confirm a mask before creating the job.
                </div>
              ) : null}
              {sourceMaskDimensionMismatch ? (
                <div className="inline-validation-note inline-validation-note-error">
                  The current mask dimensions do not match the source image. Reopen the painter and
                  regenerate the mask from this source.
                </div>
              ) : null}
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
                summary={getSelectedFileSummary(sourceFile, sourceDimensions)}
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
                summary={getMaskPreviewSummary(maskFile, maskDimensions)}
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
              placeholder="Describe the new content, cleanup, or replacement you want inside the mask."
            />
            <div className="prompt-example-block">
              <div className="prompt-example-header">
                <span className="mask-editor-control-label">Quick examples</span>
                <span className="muted">Tap one to seed the prompt, then tweak it.</span>
              </div>
              <div className="prompt-example-list">
                {PROMPT_EXAMPLES.map((example) => {
                  const isSelected = prompt === example

                  return (
                    <button
                      aria-pressed={isSelected}
                      className={`button button-secondary prompt-example-chip${isSelected ? ' is-active' : ''}`}
                      key={example}
                      type="button"
                      onClick={() => setPrompt(example)}
                    >
                      {example}
                    </button>
                  )
                })}
                {prompt ? (
                  <button
                    className="button button-secondary prompt-example-clear"
                    type="button"
                    onClick={() => setPrompt('')}
                  >
                    Clear prompt
                  </button>
                ) : null}
              </div>
            </div>
          </label>

          <section className="submit-card">
            <div className="upload-card-header">
              <span className="step-badge">Step 4</span>
              <strong>Submit job</strong>
            </div>
            <p className="muted">
              This submits the default direct OpenAI masked edit path. OpenRouter remains available
              as an optional provider on the API path, and Gemini still rejects masked jobs.
            </p>
            <div className="submit-validation-list">
              {submitValidationItems.map((item) => (
                <div className="submit-validation-row" key={item.label}>
                  <span
                    className={`inline-status ${
                      item.pending ? 'is-pending' : item.ready ? 'is-ready' : 'is-blocked'
                    }`}
                  >
                    {item.pending ? 'Checking' : item.ready ? 'Ready' : 'Fix'}
                  </span>
                  <span className="submit-validation-copy">{item.label}</span>
                </div>
              ))}
            </div>
            <div className="actions">
              <button
                className="button button-cta"
                disabled={isSubmitting || Boolean(submitBlockedReason)}
                type="submit"
              >
                {isSubmitting
                  ? 'Submitting...'
                  : createJobBlockedReason
                    ? 'Creation blocked by runtime config'
                    : sourceMaskDimensionMismatch
                      ? 'Fix source and mask dimensions'
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
              {sourceMaskDimensionMismatch ? (
                <div className="alert alert-error">
                  Source image and mask must have identical dimensions before submission.
                </div>
              ) : null}
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
