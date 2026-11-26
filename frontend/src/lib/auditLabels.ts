/** Plain-language names for the audit action codes the server records. */

export type Tone = 'ok' | 'warn' | 'ng' | 'info' | 'neutral';

const LABELS: Record<string, [string, Tone]> = {
  USER_LOGIN: ['Signed in', 'neutral'],
  USER_LOGOUT: ['Signed out', 'neutral'],
  LOGIN_FAILED: ['Failed sign-in', 'ng'],
  USER_CREATED: ['User created', 'info'],
  USER_ACTIVATED: ['User re-activated', 'info'],
  USER_DEACTIVATED: ['User deactivated', 'warn'],
  USER_DELETED: ['User deleted', 'ng'],
  SHEET_TEMPLATE_CREATED: ['Template created', 'info'],
  SHEET_TEMPLATE_UPDATED: ['Template updated', 'info'],
  BATCH_CREATED: ['Lot created', 'info'],
  BATCH_QUICK_REGISTERED: ['Lot registered by scan', 'info'],
  OPERATOR_STARTED_INSPECTION: ['Operator started inspection', 'neutral'],
  OPERATOR_SUBMIT_APPROVE: ['Operator submitted: all good', 'ok'],
  OPERATOR_SUBMIT_REJECT: ['Operator submitted: not good items', 'warn'],
  SUPERVISOR_OPENED_REVIEW: ['Supervisor opened review', 'neutral'],
  SUPERVISOR_FIELD_REVIEW: ['Supervisor reviewed a field', 'neutral'],
  SUPERVISOR_SAVED_REVIEW: ['Supervisor saved review', 'ok'],
  HOLD_OVERDUE_ESCALATION: ['Hold overdue', 'ng'],
  ATTACHMENT_UPLOADED: ['Attachment uploaded', 'neutral'],
  REPORT_EXPORTED: ['Lot report exported', 'neutral'],
  CSV_EXPORTED: ['All records exported', 'neutral'],
  AUDIT_LOG_EXPORTED: ['Audit trail exported', 'neutral'],
};

const title = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** { label, tone } for an action code, with sensible fallbacks for codes that carry a suffix. */
export function describeAction(code: string): { label: string; tone: Tone } {
  const known = LABELS[code];
  if (known) return { label: known[0], tone: known[1] };
  if (code.startsWith('SUPERVISOR_DECISION_')) {
    const d = code.slice('SUPERVISOR_DECISION_'.length);
    return { label: `Supervisor decision: ${title(d)}`, tone: /REJECT/.test(d) ? 'ng' : /HOLD/.test(d) ? 'warn' : 'ok' };
  }
  if (code.startsWith('HOLD_RELEASED_')) {
    return { label: `Hold released: ${title(code.slice('HOLD_RELEASED_'.length))}`, tone: 'info' };
  }
  return { label: title(code), tone: 'neutral' };
}

/** Notification kinds, for labels and filter chips. */
export const NOTIFICATION_KINDS: { id: string; label: string }[] = [
  { id: 'batch', label: 'Lots' },
  { id: 'review', label: 'Reviews' },
  { id: 'hold', label: 'Holds' },
  { id: 'user', label: 'Users' },
  { id: 'security', label: 'Security' },
  { id: 'info', label: 'Other' },
];
