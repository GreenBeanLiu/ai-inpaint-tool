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

import { MaskPaintEditor } from '@/components/mask-paint-editor'
import { ModalShell } from '@/components/modal-shell'
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

  return `${getSelectedFileSummary(file, dimensions)} • Transparent areas mark the preserved image`
}

function stripExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, '')
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
  const [message, setMessage] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [runtimeReport, setRuntimeReport] = useState<RuntimeCheckReport | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [dragError, setDragError] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [selectedModel, setSelectedModel] = useState<string>('')
  const sourcePreviewUrl = useObjectUrl(sourceFile)
  const maskPreviewUrl = useObjectUrl(maskFile)
  const sourceDimensions = useImageDimensions(sourcePreviewUrl)
  const maskDimensions = useImageDimensions(maskPreviewUrl)

  useEffect(() => {
    void refreshRuntimeCheck()
    void refreshJobs().catch((error) => {
      setLoadError(error instanceof Error ? error.message : 'Failed to load jobs')
    })
  }, [])

  async function refreshRuntimeCheck() {
    try {
      const response = await fetch('/api/runtime-check')
      const payload = (await response.json()) as RuntimeCheckReport | ApiErrorResponse

      if (!response.ok || !('checkedAt' in payload)) {
        return
      }

      setRuntimeReport(payload)
    } catch {
      // runtime check is best-effort; blocked reason surfaces in form feedback
    }
  }

  useEffect(() => {
    const selectableProviders = runtimeReport?.selectableMaskedProviders ?? []

    if (selectableProviders.length < 2) {
      if (selectedProvider || selectedModel) {
        setSelectedProvider('')
        setSelectedModel('')
      }
      return
    }

    if (!selectedProvider) {
      return
    }

    const providerStillAvailable = selectableProviders.some((provider) => provider.id === selectedProvider)

    if (!providerStillAvailable) {
      setSelectedProvider('')
      setSelectedModel('')
    }
  }, [runtimeReport, selectedModel, selectedProvider])

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
    setDragError(null)
    setIsMaskEditorOpen(Boolean(file))
  }, [])

  const handleProviderChange = useCallback((providerId: string) => {
    setSelectedProvider(providerId)

    if (!providerId) {
      setSelectedModel('')
      return
    }

    const provider = runtimeReport?.selectableMaskedProviders.find((p) => p.id === providerId)

    if (provider) {
      setSelectedModel(provider.defaultModel)
      return
    }

    setSelectedModel('')
  }, [runtimeReport])

  const isValidImageType = useCallback((file: File) => {
    return (
      file.type === 'image/png' ||
      file.type === 'image/jpeg' ||
      file.type === 'image/webp'
    )
  }, [])

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(true)
    setDragError(null)
  }, [])

  const handleDragOver = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
    setDragError(null)
  }, [])

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setIsDragOver(false)

      const files = event.dataTransfer.files

      if (files.length === 0) {
        setDragError('No file was dropped.')
        return
      }

      if (files.length > 1) {
        setDragError('Only one image can be uploaded at a time.')
        return
      }

      const file = files[0]

      if (!isValidImageType(file)) {
        setDragError(
          `${file.type || 'This file type'} is not supported. Please drop a PNG, JPEG, or WEBP image.`,
        )
        return
      }

      setDragError(null)
      handleSourceFileChange(file)
    },
    [handleSourceFileChange, isValidImageType],
  )

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
    const form = event.currentTarget
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
      const formData = new FormData(form)
      const sourceFileForSubmission = await normalizeSourceFileForSubmission(sourceFile)
      formData.set('image', sourceFileForSubmission, sourceFileForSubmission.name)
      formData.set('mask', maskFile, maskFile.name)

      if (selectedProvider) {
        formData.set('provider', selectedProvider)
      }
      if (selectedModel) {
        formData.set('model', selectedModel)
      }

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
      setSelectedProvider('')
      setSelectedModel('')
      setIsMaskEditorOpen(false)
      form.reset()
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
  const sourceMaskDimensionMismatch = haveImageDimensionsMismatch(sourceDimensions, maskDimensions)
  const showProviderSelector = (runtimeReport?.selectableMaskedProviders.length ?? 0) >= 2
  const submitBlockedReason =
    createJobBlockedReason ??
    (sourceMaskDimensionMismatch
      ? 'Fix the source image and edit region dimensions before submitting.'
      : !sourceFile
        ? 'Choose a source image'
        : !maskFile
          ? 'Select an edit region to continue'
          : null)

  return (
    <div className="home-page">
      <section className="panel intake-panel" id="create-edit-job">
        <form className="intake-form" onSubmit={handleSubmit}>
          <div className="simple-intake-grid">
            <label
              className={`upload-card field drop-zone ${isDragOver ? 'drop-zone-active' : ''} ${dragError ? 'drop-zone-invalid' : ''}`}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <strong>Source image</strong>
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
              {dragError ? (
                <div className="inline-validation-note inline-validation-note-error">{dragError}</div>
              ) : null}
            </label>

            <section className="mask-launch-card simplified-mask-card">
              <strong>Edit region</strong>
              <div className="actions">
                <button
                  className="button"
                  disabled={!sourceFile}
                  type="button"
                  onClick={handleOpenMaskEditor}
                >
                  {maskFile ? 'Refine selection' : 'Select edit region'}
                </button>
              </div>
              <span className="upload-summary">
                {getMaskPreviewSummary(maskFile, maskDimensions) ?? 'No edit region confirmed yet.'}
              </span>
              {sourceMaskDimensionMismatch ? (
                <div className="inline-validation-note inline-validation-note-error">
                  Dimensions don&apos;t match the source image. Reopen the selector.
                </div>
              ) : null}
            </section>
          </div>

          <label className="field prompt-field">
            <strong>Prompt</strong>
            <textarea
              name="prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the new content, cleanup, or replacement you want inside the selected area."
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

          {showProviderSelector ? (
            <section className="stack">
              <strong>Provider and model</strong>
              <div className="provider-selector-grid">
                <label className="field">
                  <span className="mask-editor-control-label">Provider</span>
                  <select
                    name="provider"
                    value={selectedProvider}
                    onChange={(event) => handleProviderChange(event.target.value)}
                  >
                    <option value="">Default (OpenAI)</option>
                    {runtimeReport?.selectableMaskedProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="mask-editor-control-label">Model</span>
                  <input
                    name="model"
                    type="text"
                    value={selectedModel}
                    onChange={(event) => setSelectedModel(event.target.value)}
                    placeholder="Leave blank for provider default"
                  />
                </label>
              </div>
            </section>
          ) : null}

          <div className="submit-card">
            {isSubmitting ? (
              <div className="submit-progress">
                <div className="submit-progress-spinner" />
                <div className="submit-progress-text">
                  <span className="submit-progress-label">Uploading and creating job…</span>
                </div>
              </div>
            ) : (
              <button
                className="button button-cta"
                disabled={Boolean(submitBlockedReason)}
                type="submit"
              >
                Create job
              </button>
            )}
            <div className="form-feedback">
              {createJobBlockedReason ? <div className="alert alert-error">{createJobBlockedReason}</div> : null}
              {sourceMaskDimensionMismatch ? (
                <div className="alert alert-error">
                  Source and edit region dimensions must match.
                </div>
              ) : null}
              {message ? <div className="alert">{message}</div> : null}
            </div>
          </div>
        </form>
      </section>

      <section className="panel recent-jobs-panel">
          <div className="section-heading">
            <h2 className="section-title">Recent jobs</h2>
            <button className="button button-secondary" type="button" onClick={() => void refreshJobs()}>
              Refresh
            </button>
          </div>

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

      <ModalShell
        bodyClassName="canvas-editor-modal-body"
        className="canvas-editor-modal"
        headerActions={
          <div className="canvas-editor-header-actions">
            <span className={`status-pill ${draftMaskFile ? 'status-pill-ready' : ''}`}>
              {draftMaskFile ? 'Draft selection ready' : 'Edit region required'}
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
              Use selection
            </button>
          </div>
        }
        open={isMaskEditorOpen}
        showCloseButton={false}
        title="Edit region selector"
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
