import type { ReactNode } from 'react';

interface StatePanelProps {
  title: string;
  description?: string;
  visual?: ReactNode;
  action?: ReactNode;
  tone?: 'neutral' | 'danger';
  /** Use "alert" for errors so assistive tech announces them. */
  role?: 'status' | 'alert';
}

/** Shared layout for empty and error states. */
export function StatePanel({ title, description, visual, action, tone = 'neutral', role }: StatePanelProps) {
  return (
    <div className={tone === 'danger' ? 'state is-danger' : 'state'} role={role}>
      {visual}
      <h2 className="state-title">{title}</h2>
      {description ? <p className="state-text">{description}</p> : null}
      {action}
    </div>
  );
}

export function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="panel loading" role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      <div className="skeleton" style={{ width: '45%' }} />
      <div className="skeleton" style={{ width: '90%' }} />
      <div className="skeleton" style={{ width: '70%' }} />
      <div className="skeleton" style={{ width: '82%' }} />
    </div>
  );
}
