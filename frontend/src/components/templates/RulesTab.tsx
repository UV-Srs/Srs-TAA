import React, { useState } from 'react';
import { SAMPLE_MAX, SAMPLE_MIN, detectKind, resizeColumns, sectionOf, type DraftItem } from './templateModel';

interface RulesTabProps {
  items: DraftItem[];
  onItemChange: (uid: string, patch: Partial<DraftItem>) => void;
}

const box = 'w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2 text-sm font-normal normal-case tracking-normal text-[var(--ink)] focus:outline-none focus:border-[var(--primary)]';
const lab = 'flex flex-col gap-1.5 text-xs font-semibold text-[var(--muted)]';

export const RulesTab: React.FC<RulesTabProps> = ({ items, onItemChange }) => {
  // Samples per lot = number of reading columns on the supervisor's numeric dimensions (saved with the template).
  const dims = items.filter((i) => sectionOf(i) === 'supervisor' && detectKind(i) === 'numeric');
  const samples = dims.length ? dims[0].sample_columns.length : 10;
  const [spots, setSpots] = useState('3');
  const [freq, setFreq] = useState('Visual: 100% (IFM 200%). Dimensions: 5 per lot (IFM 10).');

  const setSamples = (v: string) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < SAMPLE_MIN || n > SAMPLE_MAX) return;
    dims.forEach((d) => onItemChange(d._uid, { sample_columns: resizeColumns(d.sample_columns, 'numeric', n) }));
  };

  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-[var(--ink)]">Rules</h3>
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 grid gap-4 md:grid-cols-[1fr_1fr_1.6fr]">
        <label className={lab}>Samples measured per lot
          <input key={samples} className={box} inputMode="numeric" defaultValue={samples} onBlur={(e) => setSamples(e.target.value)} />
        </label>
        <label className={lab}>Supervisor spot checks per lot
          <input className={box} inputMode="numeric" value={spots} onChange={(e) => setSpots(e.target.value)} />
        </label>
        <label className={lab}>Frequency
          <input className={box} value={freq} onChange={(e) => setFreq(e.target.value)} />
        </label>
      </div>
    </section>
  );
};
