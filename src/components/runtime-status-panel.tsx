import type { RuntimeCheckReport, RuntimeSection } from '@/lib/types'

interface RuntimeStatusPanelProps {
  report: RuntimeCheckReport | null
  error: string | null
  isLoading: boolean
  onRefresh: () => void | Promise<void>
}

const runtimeSections: Array<{
  key: keyof Pick<
    RuntimeCheckReport,
    'app' | 'database' | 'storage' | 'triggerDispatch' | 'triggerWorker' | 'defaultProvider'
  >
  title: string
}> = [
  { key: 'app', title: 'App boot' },
  { key: 'database', title: 'Database' },
  { key: 'storage', title: 'Storage' },
  { key: 'triggerDispatch', title: 'Trigger dispatch' },
  { key: 'triggerWorker', title: 'Trigger worker' },
  { key: 'defaultProvider', title: 'Default provider' },
]

function getRuntimeSummary(report: RuntimeCheckReport | null) {
  if (!report) {
    return 'Checking whether the local runtime is ready to list jobs, create edits, and finish the default masked editing path.'
  }

  if (report.overall.canCompleteDefaultMaskedEditJob) {
    return 'This setup can list jobs, accept uploads, dispatch the worker, and finish the default masked edit path.'
  }

  return 'The app is reachable, but at least one required runtime dependency is still blocking full edit execution.'
}

function getCapabilityStatus(isReady: boolean) {
  return isReady ? 'Ready' : 'Blocked'
}

function getCapabilityClassName(isReady: boolean) {
  return isReady ? 'runtime-capability ready' : 'runtime-capability blocked'
}

function formatDetailValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.join(', ')
  }

  if (value === null || value === undefined || value === '') {
    return 'n/a'
  }

  return String(value)
}

function RuntimeSectionCard({
  title,
  section,
}: Readonly<{ title: string; section: RuntimeSection }>) {
  const entries = section.details ? Object.entries(section.details) : []

  return (
    <article className="runtime-section-card">
      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <strong>{title}</strong>
        <span className={`status-pill status-pill-${section.status}`}>{section.status}</span>
      </div>
      <p className="muted">{section.summary}</p>
      {entries.length > 0 ? (
        <dl className="runtime-detail-list">
          {entries.map(([key, value]) => (
            <div key={key} className="runtime-detail-row">
              <dt>{key}</dt>
              <dd>{formatDetailValue(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  )
}

export function RuntimeStatusPanel({
  report,
  error,
  isLoading,
  onRefresh,
}: Readonly<RuntimeStatusPanelProps>) {
  const checkedAt = report ? new Date(report.checkedAt).toLocaleString() : null
  const blockers = report?.overall.blockers ?? []

  return (
    <section className="panel stack runtime-panel">
      <div className="section-heading">
        <div className="section-heading-copy">
          <div className="section-eyebrow">Runtime</div>
          <h2 className="section-title">Runtime health</h2>
          <p className="section-description muted">{getRuntimeSummary(report)}</p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void onRefresh()}
          disabled={isLoading}
        >
          {isLoading ? 'Refreshing...' : 'Refresh runtime'}
        </button>
      </div>

      {checkedAt ? <div className="runtime-timestamp muted">Last checked: {checkedAt}</div> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      {report ? (
        <>
          <div className="runtime-capability-grid">
            <article className={getCapabilityClassName(report.overall.canListJobs)}>
              <strong>List jobs</strong>
              <span>{getCapabilityStatus(report.overall.canListJobs)}</span>
            </article>
            <article className={getCapabilityClassName(report.overall.canCreateJob)}>
              <strong>Create job</strong>
              <span>{getCapabilityStatus(report.overall.canCreateJob)}</span>
            </article>
            <article className={getCapabilityClassName(report.overall.canStartWorker)}>
              <strong>Start worker</strong>
              <span>{getCapabilityStatus(report.overall.canStartWorker)}</span>
            </article>
            <article className={getCapabilityClassName(report.overall.canCompleteDefaultMaskedEditJob)}>
              <strong>Finish default run</strong>
              <span>{getCapabilityStatus(report.overall.canCompleteDefaultMaskedEditJob)}</span>
            </article>
          </div>

          {blockers.length > 0 ? (
            <div className="alert alert-error">
              <strong>Current blockers</strong>
              <ul className="runtime-blocker-list">
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="runtime-section-grid">
            {runtimeSections.map(({ key, title }) => (
              <RuntimeSectionCard key={key} title={title} section={report[key]} />
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}
