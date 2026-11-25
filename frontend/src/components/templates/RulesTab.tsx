import React from 'react';
import { Lock } from 'lucide-react';
import { detectKind, kindLabel, sectionOf, type DraftItem } from './templateModel';

interface RulesTabProps {
  items: DraftItem[];
}

const WORKFLOW_RULES: { title: string; body: string }[] = [
  { title: 'Complete before submitting', body: 'An operator cannot submit a lot until every required check has a value.' },
  { title: 'Rejections name the failed items', body: 'When an operator rejects a lot, they must choose which items failed.' },
  { title: 'Submitted inspections are locked', body: 'Once an operator submits a round, the operator entries cannot be changed.' },
  { title: 'Supervisors enter only their own items', body: 'A supervisor records readings and checks assigned to the supervisor. Operator entries stay read-only.' },
  { title: 'Holds need a reason', body: 'A supervisor must give a reason category to put a lot on hold.' },
  { title: 'Spot checks', body: 'The supervisor spot-checks up to 3 items the operator marked good, or fewer if the lot has fewer good items.' },
  { title: 'Near-limit warning', body: 'A supervisor reading within 10% of the range from a limit is flagged as near limit.' },
];

const limitText = (item: DraftItem): string => {
  const kind = detectKind(item);
  const unit = item.unit ? ` ${item.unit}` : '';
  switch (kind) {
    case 'numeric': {
      const lo = item.min_val, hi = item.max_val;
      if (lo != null && hi != null) return `Reading must be from ${lo} to ${hi}${unit}. Outside that range is out of spec.`;
      if (lo != null) return `Reading must be at least ${lo}${unit}. Below that is out of spec.`;
      if (hi != null) return `Reading must be at most ${hi}${unit}. Above that is out of spec.`;
      return 'No limits set, so every reading is accepted.';
    }
    case 'yesno': return 'Ticked is OK. Unticked or a No result is out of spec.';
    case 'passfail': return 'Pass is OK. A Fail result is out of spec.';
    case 'text': return 'No limit. The entry is recorded as typed.';
    default: return 'Kept as saved.';
  }
};

export const RulesTab: React.FC<RulesTabProps> = ({ items }) => {
  const rows = items.filter((i) => i.control_item_name.trim());

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-[var(--ink)]">Rules</h3>
          <span className="pill neutral sm"><Lock className="w-3 h-3" />Read-only</span>
        </div>
        <p className="sub mt-0.5 max-w-2xl">
          These rules are built into the application and apply to every template. The limits below come from the checks you set up on the other tabs, so change them there.
        </p>
      </div>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-[var(--ink)]">Limits on each row</h4>
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--line2)] bg-[var(--surface)] p-6 text-center">
            <p className="text-sm font-semibold text-[var(--ink)]">No rows to show</p>
            <p className="sub mt-1">Add operator checks or supervisor dimensions and their limits will be listed here.</p>
          </div>
        ) : (
          <div className="sv-card flush overflow-x-auto">
            <table className="vt">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Applies to</th>
                  <th>Type</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const sec = sectionOf(item);
                  return (
                    <tr key={item._uid}>
                      <td className="font-semibold">{item.control_item_name}</td>
                      <td>
                        <span className={`pill sm ${sec === 'supervisor' ? 'info' : 'neutral'}`}>
                          {sec === 'supervisor' ? 'Supervisor' : sec === 'other' ? 'Admin' : 'Operator'}
                        </span>
                      </td>
                      <td className="text-[var(--muted)]">{kindLabel(detectKind(item))}</td>
                      <td className="text-[var(--muted)]">{limitText(item)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-[var(--ink)]">How pass / fail results are read</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--ok-bg)] p-3">
            <p className="text-xs font-semibold text-[var(--ok)] uppercase tracking-wide">Counted as OK</p>
            <p className="mono text-xs text-[var(--ink)] mt-1">Pass, OK, Yes, True, 1, Checked, Accepted</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--ng-bg)] p-3">
            <p className="text-xs font-semibold text-[var(--ng)] uppercase tracking-wide">Counted as failed</p>
            <p className="mono text-xs text-[var(--ink)] mt-1">Fail, NG, No, False, 0, Reject, Rejected, Not OK</p>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-[var(--ink)]">Workflow rules</h4>
        <ul className="sv-card !p-0 divide-y divide-[var(--line)] overflow-hidden">
          {WORKFLOW_RULES.map((r) => (
            <li key={r.title} className="px-4 py-3">
              <p className="text-sm font-semibold text-[var(--ink)]">{r.title}</p>
              <p className="text-sm text-[var(--muted)]">{r.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
