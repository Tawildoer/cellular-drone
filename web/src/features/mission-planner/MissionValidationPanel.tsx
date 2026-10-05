import { CheckCircle2, XCircle } from 'lucide-react'
import { validateMission, type Mission } from '../../domain'

export function MissionValidationPanel({ mission }: { mission: Mission }) {
  const result = validateMission(mission)

  return (
    <div className="glass-panel flex max-w-xs flex-col gap-1.5 px-2.5 py-1.5">
      <div className="flex items-center gap-1.5">
        {result.valid ? (
          <CheckCircle2 size={12} style={{ color: 'var(--status-good)' }} aria-hidden />
        ) : (
          <XCircle size={12} style={{ color: 'var(--status-critical)' }} aria-hidden />
        )}
        <span className="hud-label" style={{ color: result.valid ? 'var(--status-good)' : 'var(--status-critical)' }}>
          {result.valid ? 'Mission valid' : `${result.issues.length} issue${result.issues.length === 1 ? '' : 's'}`}
        </span>
      </div>
      {!result.valid && (
        <ul className="flex flex-col gap-1">
          {result.issues.map((issue, i) => (
            <li key={i} className="text-xs" style={{ color: 'var(--status-critical)' }}>
              {issue.itemIndex !== null ? `Item ${issue.itemIndex + 1}: ` : ''}
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
