import type { ReactNode } from 'react'

export function EmptyState({ icon, title, children, actions }: { icon?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty" role="status">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="actions">{actions}</div>}
    </div>
  )
}

export function Skeleton() {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => (
        <div key={i} />
      ))}
    </div>
  )
}
