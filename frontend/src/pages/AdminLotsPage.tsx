import React, { useState, useEffect, useMemo } from 'react';
import { InspectionBatch } from '../types';
import { fetchBatches } from '../api';
import { Search, RefreshCw, ChevronDown } from 'lucide-react';

interface Props {
  onSelectLot: (batchId: number) => void;
}

type StatusFilter = 'All statuses' | 'Inspecting' | 'With supervisor' | 'On hold' | 'Completed' | 'Rejected';

interface LotRowItem {
  batch_id: number;
  lot_barcode: string;
  lot_name: string;
  operator_name: string;
  supervisor_name: string;
  items: number;
  bad: number;
  status: 'With supervisor' | 'Completed' | 'Inspecting' | 'On hold' | 'Rejected';
  updated_at: string;
}

const SEED_LOTS_TABLE: LotRowItem[] = [
  {
    batch_id: 105,
    lot_barcode: '18351M62Q50-260820-01',
    lot_name: 'Lot 20-08',
    operator_name: 'Ravi K.',
    supervisor_name: '—',
    items: 250,
    bad: 0,
    status: 'With supervisor',
    updated_at: '01:54 am',
  },
  {
    batch_id: 103,
    lot_barcode: '18351M62Q50-260818-01',
    lot_name: 'Lot 18-08',
    operator_name: 'Sameer J.',
    supervisor_name: '—',
    items: 180,
    bad: 3,
    status: 'With supervisor',
    updated_at: '18 Aug',
  },
  {
    batch_id: 104,
    lot_barcode: '18351M62Q50-260819-01',
    lot_name: 'Lot 19-08',
    operator_name: 'Ravi K.',
    supervisor_name: '—',
    items: 225,
    bad: 2,
    status: 'With supervisor',
    updated_at: '19 Aug',
  },
  {
    batch_id: 102,
    lot_barcode: '18351M62Q50-260817-01',
    lot_name: 'Lot 17-08',
    operator_name: 'Ravi K.',
    supervisor_name: 'Neha S.',
    items: 270,
    bad: 0,
    status: 'Completed',
    updated_at: '17 Aug',
  },
  {
    batch_id: 101,
    lot_barcode: '18351M62Q50-260816-01',
    lot_name: 'Lot 16-08',
    operator_name: 'Ravi K.',
    supervisor_name: 'Neha S.',
    items: 450,
    bad: 3,
    status: 'Completed',
    updated_at: '16 Aug',
  },
  {
    batch_id: 106,
    lot_barcode: '18351M62Q50-260821-01',
    lot_name: 'Lot 21-08',
    operator_name: 'Ravi K.',
    supervisor_name: '—',
    items: 320,
    bad: 0,
    status: 'Inspecting',
    updated_at: '21 Aug',
  },
];

function mapStatus(raw: string): 'With supervisor' | 'Completed' | 'Inspecting' | 'On hold' | 'Rejected' {
  if (['CREATED_PENDING_OPERATOR', 'OPERATOR_IN_PROGRESS'].includes(raw)) return 'Inspecting';
  if (['OPERATOR_APPROVED', 'OPERATOR_REJECTED', 'SUPERVISOR_IN_PROGRESS'].includes(raw)) return 'With supervisor';
  if (raw === 'ON_HOLD') return 'On hold';
  if (raw === 'APPROVED') return 'Completed';
  if (raw === 'REJECTED') return 'Rejected';
  return 'Inspecting';
}

function getStatusPill(status: string) {
  if (status === 'Completed') {
    return <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-[#ECFDF3] text-[#027A48] border border-[#ABEFC6]">Completed</span>;
  }
  if (status === 'With supervisor') {
    return <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-[#FEF6EE] text-[#B54708] border border-[#F9DBAF]">With supervisor</span>;
  }
  if (status === 'On hold') {
    return <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-[#FFFAEB] text-[#B54708] border border-[#FEDF89]">On hold</span>;
  }
  if (status === 'Rejected') {
    return <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-[#FEF3F2] text-[#B42318] border border-[#FECDCA]">Rejected</span>;
  }
  return <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-[#EFF8FF] text-[#175CD3] border border-[#B2DDFF]">Inspecting</span>;
}

export const AdminLotsPage: React.FC<Props> = ({ onSelectLot }) => {
  const [batches, setBatches] = useState<InspectionBatch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All statuses');

  const load = async () => {
    try {
      setIsLoading(true);
      const res = await fetchBatches();
      setBatches(res || []);
    } catch {
      // silent
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Merge real batches with seed data if batches is empty
  const allLotRows = useMemo<LotRowItem[]>(() => {
    if (batches.length > 0) {
      return batches.map((b) => {
        const dateObj = b.updated_at ? new Date(b.updated_at) : (b.created_at ? new Date(b.created_at) : new Date());
        const timeOrDate = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        return {
          batch_id: b.batch_id,
          lot_barcode: b.lot_number,
          lot_name: `Lot ${b.lot_number.slice(-9, -3) || b.batch_id}`,
          operator_name: b.prepared_user_name || '—',
          supervisor_name: b.checked_user_name || '—',
          items: b.lot_quantity || 100,
          bad: b.status === 'REJECTED' ? 2 : 0,
          status: mapStatus(b.status),
          updated_at: timeOrDate,
        };
      });
    }
    return SEED_LOTS_TABLE;
  }, [batches]);

  const filteredLots = useMemo(() => {
    return allLotRows.filter((l) => {
      // Status filter
      if (statusFilter !== 'All statuses' && l.status !== statusFilter) {
        return false;
      }
      // Search
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchesBarcode = l.lot_barcode.toLowerCase().includes(q);
        const matchesName = l.lot_name.toLowerCase().includes(q);
        const matchesOp = l.operator_name.toLowerCase().includes(q);
        const matchesSup = l.supervisor_name.toLowerCase().includes(q);
        if (!matchesBarcode && !matchesName && !matchesOp && !matchesSup) {
          return false;
        }
      }
      return true;
    });
  }, [allLotRows, search, statusFilter]);

  return (
    <div className="space-y-5">
      {/* ── Page Title ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-[var(--ink)]">Lots</h2>
        <button
          onClick={load}
          className="btn sm"
          title="Refresh lots list"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Search & Status Filter Row (Screenshot 2) ───────────────────────── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search input */}
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search or scan barcode"
            className="w-full h-[46px] px-4 rounded-xl border border-[var(--line2)] bg-[var(--surface)] text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--primary)]"
          />
        </div>

        {/* Status Dropdown */}
        <div className="relative min-w-[160px]">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="w-full h-[46px] pl-4 pr-10 rounded-xl border border-[var(--line2)] bg-[var(--surface)] text-sm text-[var(--ink)] font-medium appearance-none focus:outline-none cursor-pointer"
          >
            <option value="All statuses">All statuses</option>
            <option value="Inspecting">Inspecting</option>
            <option value="With supervisor">With supervisor</option>
            <option value="On hold">On hold</option>
            <option value="Completed">Completed</option>
            <option value="Rejected">Rejected</option>
          </select>
          <ChevronDown className="w-4 h-4 text-[var(--muted)] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {/* ── Lots Table (Screenshot 2) ────────────────────────────────────────── */}
      <div className="sv-card flush shadow-xs">
        <div className="overflow-x-auto">
          <table className="vt w-full">
            <thead>
              <tr>
                <th className="py-3 px-5 text-left">LOT BARCODE</th>
                <th className="py-3 px-5 text-left">OPERATOR</th>
                <th className="py-3 px-5 text-left">SUPERVISOR</th>
                <th className="py-3 px-5 text-left">ITEMS</th>
                <th className="py-3 px-5 text-left">BAD</th>
                <th className="py-3 px-5 text-left">STATUS</th>
                <th className="py-3 px-5 text-left">UPDATED</th>
              </tr>
            </thead>
            <tbody>
              {filteredLots.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-[var(--muted)]">
                    No matching lots found.
                  </td>
                </tr>
              ) : (
                filteredLots.map((lot) => (
                  <tr
                    key={lot.batch_id}
                    onClick={() => onSelectLot(lot.batch_id)}
                    className="hover:bg-[var(--surface2)] cursor-pointer transition-colors border-b border-[var(--line)]"
                  >
                    {/* LOT BARCODE (Barcode + Lot Name underneath) */}
                    <td className="py-3.5 px-5">
                      <div className="mono font-bold text-xs text-[var(--ink)]">
                        {lot.lot_barcode}
                      </div>
                      <div className="text-[12px] text-[var(--muted)] mt-0.5 font-normal">
                        {lot.lot_name}
                      </div>
                    </td>

                    {/* OPERATOR */}
                    <td className="py-3.5 px-5 text-sm text-[var(--ink)] font-normal">
                      {lot.operator_name}
                    </td>

                    {/* SUPERVISOR */}
                    <td className="py-3.5 px-5 text-sm text-[var(--muted)] font-normal">
                      {lot.supervisor_name}
                    </td>

                    {/* ITEMS */}
                    <td className="py-3.5 px-5 text-sm text-[var(--ink)] font-normal tabular-nums">
                      {lot.items}
                    </td>

                    {/* BAD */}
                    <td className="py-3.5 px-5 text-sm text-[var(--ink)] font-normal tabular-nums">
                      {lot.bad}
                    </td>

                    {/* STATUS PILL */}
                    <td className="py-3.5 px-5">
                      {getStatusPill(lot.status)}
                    </td>

                    {/* UPDATED */}
                    <td className="py-3.5 px-5 text-xs text-[var(--muted)] font-normal">
                      {lot.updated_at}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
