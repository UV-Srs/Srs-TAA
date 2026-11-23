import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  fetchProgressDashboard, createBatch, fetchSheets, getExportUrl,
  downloadBatchReport, handleReportDownloadClick
} from '../api';
import { SheetTemplate } from '../types';
import {
  Plus, ExternalLink, Printer, RefreshCw, AlertCircle, Search, Filter
} from 'lucide-react';
import { PrintLabelModal } from '../components/PrintLabelModal';

interface AdminDashboardProps {
  onSelectBatch: (batchId: number) => void;
  onFilterLots?: (statusFilter: string) => void;
}

type StatusFilter = 'all' | 'registered' | 'operator' | 'supervisor' | 'onhold' | 'completed';

interface LotItem {
  batch_id: number;
  lot_number: string;
  lot_name: string;
  sheet_id: string;
  part_no: string;
  part_name: string;
  lot_quantity: number;
  status: string;
  status_category: StatusFilter;
  operator_name: string;
  supervisor_name: string;
  ng_count: number | null;
  rev: number;
  updated_at?: string;
  updated_short: string;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onSelectBatch }) => {
  const [data, setData] = useState<any>(null);
  const [sheets, setSheets] = useState<SheetTemplate[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('all');

  const [isNewBatchOpen, setIsNewBatchOpen] = useState<boolean>(false);
  const [selectedSheetId, setSelectedSheetId] = useState<string>('');
  const [lotNumber, setLotNumber] = useState<string>('');
  const [lotQuantity, setLotQuantity] = useState<number>(450);
  const [inspectionMode, setInspectionMode] = useState<string>('IFM');
  const [isCreating, setIsCreating] = useState<boolean>(false);

  const [printSheetId, setPrintSheetId] = useState<string | null>(null);

  const tableRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      setIsLoading(true);
      setErrorMsg(null);
      const [prog, sList] = await Promise.all([
        fetchProgressDashboard().catch(() => null),
        fetchSheets().catch(() => []),
      ]);
      setData(prog);
      setSheets(sList);
      if (sList.length > 0 && !selectedSheetId) {
        setSelectedSheetId(sList[0].sheet_id);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load dashboard.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSheetId || !lotNumber) return;
    try {
      setIsCreating(true);
      const newBatch = await createBatch({
        sheet_id: selectedSheetId,
        lot_number: lotNumber,
        lot_quantity: Number(lotQuantity),
        inspection_mode: inspectionMode,
      });
      setIsNewBatchOpen(false);
      setLotNumber('');
      await loadDashboard();
      onSelectBatch(newBatch.batch_id);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create new batch.');
    } finally {
      setIsCreating(false);
    }
  };

  const allLots = useMemo<LotItem[]>(() => {
    const backendBatches = data?.batches || [];
    return backendBatches.map((b: any) => {
      let category: StatusFilter = 'registered';
      if (['APPROVED', 'REJECTED'].includes(b.status)) category = 'completed';
      else if (['ON_HOLD', 'hold'].includes(b.status)) category = 'onhold';
      else if (['OPERATOR_APPROVED', 'SUPERVISOR_IN_PROGRESS'].includes(b.status)) category = 'supervisor';
      else if (['OPERATOR_IN_PROGRESS', 'op_progress'].includes(b.status)) category = 'operator';

      const dateObj = b.updated_at ? new Date(b.updated_at) : (b.created_at ? new Date(b.created_at) : new Date());
      const shortDate = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

      return {
        batch_id: b.batch_id,
        lot_number: b.lot_number,
        lot_name: `Lot ${b.lot_number.slice(-9, -3) || b.batch_id}`,
        sheet_id: b.sheet_id,
        part_no: b.part_no || '—',
        part_name: b.part_name || '—',
        lot_quantity: b.lot_quantity || 0,
        status: b.status,
        status_category: category,
        operator_name: b.operator_name || '—',
        supervisor_name: b.supervisor_name || '—',
        ng_count: typeof b.ng_count === 'number' ? b.ng_count : null,
        rev: b.round || 1,
        updated_at: b.updated_at || b.created_at,
        updated_short: shortDate,
      };
    });
  }, [data]);

  // ── KPI Calculations (real data only, 0 when empty) ──────────────────────
  const lotsInspected = allLots.filter((l) => l.status_category !== 'registered').length;
  const itemsChecked = allLots
    .filter((l) => l.status_category !== 'registered')
    .reduce((sum, l) => sum + (l.lot_quantity || 0), 0);
  const badItemsFound = allLots.reduce(
    (sum, l) => sum + (typeof l.ng_count === 'number' ? l.ng_count : 0), 0
  );
  const badRate = itemsChecked > 0 ? ((badItemsFound / itemsChecked) * 100).toFixed(2) : '0.00';

  const lotsReviewed = allLots.filter((l) => ['completed', 'onhold'].includes(l.status_category)).length;
  const approvedDecisions = allLots.filter((l) => l.status === 'APPROVED').length;
  const rejectedDecisions = allLots.filter((l) => l.status === 'REJECTED').length;
  const onHoldDecisions = allLots.filter((l) => l.status_category === 'onhold').length;
  const totalDecisions = approvedDecisions + rejectedDecisions + onHoldDecisions;

  const beingInspectedCount = allLots.filter((l) => l.status_category === 'operator').length;
  const waitingSupervisorCount = allLots.filter((l) => l.status_category === 'supervisor').length;
  const onHoldCount = allLots.filter((l) => l.status_category === 'onhold').length;

  const displayedLots = useMemo<LotItem[]>(() => {
    return allLots.filter((lot) => {
      if (selectedStatus !== 'all' && lot.status_category !== selectedStatus) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matches =
          lot.lot_number.toLowerCase().includes(q) ||
          lot.lot_name.toLowerCase().includes(q) ||
          lot.operator_name.toLowerCase().includes(q) ||
          lot.supervisor_name.toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [allLots, selectedStatus, searchQuery]);

  const handleStatusAttentionClick = (status: StatusFilter) => {
    setSelectedStatus(status);
    if (tableRef.current) {
      tableRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleBarcodeSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const exactMatch = allLots.find(
        (l) => l.lot_number.toLowerCase() === searchQuery.trim().toLowerCase()
      );
      if (exactMatch) onSelectBatch(exactMatch.batch_id);
    }
  };

  if (isLoading) {
    return (
      <div className="py-24 text-center">
        <div className="w-7 h-7 border-2 border-[var(--line2)] border-t-[var(--primary)] rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-[var(--muted)]">Loading dashboard...</p>
      </div>
    );
  }

  const hasNoBatches = allLots.length === 0;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--line)]">
        <div>
          <h2>Dashboard</h2>
          <p className="sub mt-0.5">Shop-floor inspection metrics and real-time lot status</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={loadDashboard} className="btn sm" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setIsNewBatchOpen(true)} className="btn primary sm">
            <Plus className="w-4 h-4" />
            <span>New Batch</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="border border-[var(--ng)] bg-[var(--ng-bg)] text-[var(--ng)] p-3 rounded-xl text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ── Empty State ──────────────────────────────────────────────────── */}
      {hasNoBatches ? (
        <div className="sv-card flex flex-col items-center justify-center py-16 text-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[var(--surface2)] flex items-center justify-center">
            <Plus className="w-6 h-6 text-[var(--muted)]" />
          </div>
          <div>
            <p className="font-semibold text-[var(--ink)] text-sm">No batches yet</p>
            <p className="text-xs text-[var(--muted)] mt-1">
              Create a new batch or scan a barcode to get started.
            </p>
          </div>
          <button onClick={() => setIsNewBatchOpen(true)} className="btn primary sm mt-2">
            <Plus className="w-4 h-4" />
            <span>Create First Batch</span>
          </button>
        </div>
      ) : (
        <>
          {/* ── Inspection KPIs ─────────────────────────────────────────── */}
          <div>
            <div className="sv-label">INSPECTION, OPERATORS</div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 kpis big">
              <div className="sv-card">
                <div className="text-[30px] font-light leading-none text-[var(--ink)]">
                  {lotsInspected}
                </div>
                <div className="text-[12px] text-[var(--muted)] font-medium mt-1">Lots inspected</div>
              </div>
              <div className="sv-card">
                <div className="text-[30px] font-light leading-none text-[var(--ink)]">
                  {itemsChecked.toLocaleString('en-IN')}
                </div>
                <div className="text-[12px] text-[var(--muted)] font-medium mt-1">Items checked</div>
              </div>
              <div className="sv-card">
                <div className={`text-[30px] font-light leading-none ${badItemsFound > 0 ? 'text-[var(--ng)] font-normal' : 'text-[var(--ink)]'}`}>
                  {badItemsFound}
                </div>
                <div className="text-[12px] text-[var(--muted)] font-medium mt-1">Bad items found</div>
              </div>
              <div className="sv-card">
                <div className="text-[30px] font-light leading-none text-[var(--ink)]">
                  {badRate}%
                </div>
                <div className="text-[12px] text-[var(--muted)] font-medium mt-1">Bad rate</div>
              </div>
            </div>
          </div>

          {/* ── Supervisor KPIs + Decisions Chart ───────────────────────── */}
          <div>
            <div className="sv-label">REVIEW, SUPERVISORS</div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-stretch">
              <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-2.5 kpis big">
                <div className="sv-card">
                  <div className="text-[30px] font-light leading-none text-[var(--ink)]">
                    {lotsReviewed}
                  </div>
                  <div className="text-[12px] text-[var(--muted)] font-medium mt-1">Lots reviewed</div>
                </div>
                <div className="sv-card">
                  <div className="text-[30px] font-light leading-none text-[var(--ink)]">
                    {approvedDecisions}
                  </div>
                  <div className="text-[12px] text-[var(--muted)] font-medium mt-1">Approved</div>
                </div>
                <div className="sv-card">
                  <div className={`text-[30px] font-light leading-none ${rejectedDecisions > 0 ? 'text-[var(--ng)] font-normal' : 'text-[var(--ink)]'}`}>
                    {rejectedDecisions}
                  </div>
                  <div className="text-[12px] text-[var(--muted)] font-medium mt-1">Rejected</div>
                </div>
              </div>

              <div className="lg:col-span-5 sv-card flex flex-col justify-between">
                <div className="text-[14px] font-semibold text-[var(--ink)] mb-3">
                  Decisions on lots
                </div>
                {totalDecisions === 0 ? (
                  <div className="text-xs text-[var(--muted)] py-2">No decisions recorded yet.</div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="h-3.5 w-full bg-[var(--surface2)] rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-[var(--ok)]"
                        style={{ width: `${(approvedDecisions / totalDecisions) * 100}%` }}
                        title={`Approved: ${approvedDecisions}`}
                      />
                      <div
                        className="h-full bg-[var(--warn)]"
                        style={{ width: `${(onHoldDecisions / totalDecisions) * 100}%` }}
                        title={`On hold: ${onHoldDecisions}`}
                      />
                      <div
                        className="h-full bg-[var(--ng)]"
                        style={{ width: `${(rejectedDecisions / totalDecisions) * 100}%` }}
                        title={`Rejected: ${rejectedDecisions}`}
                      />
                    </div>
                    <div className="flex items-center gap-4 text-[12px] text-[var(--muted)] flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-[var(--ok)]" />
                        <span>Approved {approvedDecisions}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-[var(--warn)]" />
                        <span>On hold {onHoldDecisions}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-[var(--ng)]" />
                        <span>Rejected {rejectedDecisions}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Right Now tiles ──────────────────────────────────────────── */}
          <div>
            <div className="sv-label">RIGHT NOW</div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              <button
                type="button"
                onClick={() => handleStatusAttentionClick('operator')}
                className="sv-card att text-left"
              >
                <div className="text-[30px] font-light text-[var(--ink)]">{beingInspectedCount}</div>
                <div className="text-[14px] font-semibold text-[var(--ink)] mt-0.5">Being inspected</div>
                <div className="text-[12px] text-[var(--muted)] mt-0.5">By operators now</div>
              </button>

              <button
                type="button"
                onClick={() => handleStatusAttentionClick('supervisor')}
                className={`sv-card att text-left ${waitingSupervisorCount > 0 ? 'warn' : ''}`}
              >
                <div className={`text-[30px] font-light ${waitingSupervisorCount > 0 ? 'text-[var(--warn)] font-normal' : 'text-[var(--ink)]'}`}>
                  {waitingSupervisorCount}
                </div>
                <div className="text-[14px] font-semibold text-[var(--ink)] mt-0.5">With supervisor</div>
                <div className="text-[12px] text-[var(--muted)] mt-0.5">
                  {waitingSupervisorCount > 0 ? `${waitingSupervisorCount} awaiting review` : 'None waiting'}
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleStatusAttentionClick('onhold')}
                className={`sv-card att text-left ${onHoldCount > 0 ? 'warn' : ''}`}
              >
                <div className={`text-[30px] font-light ${onHoldCount > 0 ? 'text-[var(--warn)] font-normal' : 'text-[var(--ink)]'}`}>
                  {onHoldCount}
                </div>
                <div className="text-[14px] font-semibold text-[var(--ink)] mt-0.5">Lots on hold</div>
                <div className="text-[12px] text-[var(--muted)] mt-0.5">
                  {onHoldCount > 0 ? `${onHoldCount} held` : 'None on hold'}
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleStatusAttentionClick('registered')}
                className="sv-card att text-left"
              >
                <div className="text-[30px] font-light text-[var(--ink)]">
                  {allLots.filter((l) => l.status_category === 'registered').length}
                </div>
                <div className="text-[14px] font-semibold text-[var(--ink)] mt-0.5">Not yet scanned</div>
                <div className="text-[12px] text-[var(--muted)] mt-0.5">Registered, pending operator</div>
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Lots Table ───────────────────────────────────────────────────── */}
      <div ref={tableRef} className="sv-card flush mt-2">
        <div className="p-4 sm:p-5 border-b border-[var(--line)] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[20px] font-semibold text-[var(--ink)]">Lots</h2>
              <p className="sub text-xs mt-0.5">Tap a lot to open its checksheet.</p>
            </div>
            <span className="pill neutral sm font-semibold">
              {displayedLots.length} {displayedLots.length === 1 ? 'lot' : 'lots'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
            <div className="sm:col-span-8 relative">
              <Search className="w-4 h-4 text-[var(--muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleBarcodeSearchKeyDown}
                placeholder="Search or scan barcode"
                aria-label="Search lots by barcode"
                className="w-full min-h-[46px] pl-10 pr-4 rounded-[12px] border border-[var(--line2)] bg-[var(--surface)] text-[15px] text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] mono"
              />
            </div>
            <div className="sm:col-span-4 relative">
              <Filter className="w-4 h-4 text-[var(--muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value as StatusFilter)}
                aria-label="Filter by status"
                className="w-full min-h-[46px] pl-10 pr-4 rounded-[12px] border border-[var(--line2)] bg-[var(--surface)] text-[14px] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] font-medium appearance-none cursor-pointer"
              >
                <option value="all">All statuses</option>
                <option value="registered">Not scanned</option>
                <option value="operator">Inspecting</option>
                <option value="supervisor">With supervisor</option>
                <option value="onhold">On hold</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="vt">
            <thead>
              <tr>
                <th>Lot barcode</th>
                <th>Part / Sheet</th>
                <th>Operator</th>
                <th>Supervisor</th>
                <th className="n">Items</th>
                <th className="n">Bad</th>
                <th>Status</th>
                <th>Updated</th>
                <th className="text-center w-28">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedLots.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-sm text-[var(--muted)]">
                    {hasNoBatches
                      ? 'No batches yet. Create one to get started.'
                      : searchQuery.trim()
                      ? `No lot matches "${searchQuery}".`
                      : 'No lots with this status.'}
                  </td>
                </tr>
              ) : (
                displayedLots.map((lot) => {
                  const getStatusPill = (statusCat: StatusFilter) => {
                    switch (statusCat) {
                      case 'completed': return <span className="pill ok sm">Completed</span>;
                      case 'onhold': return <span className="pill warn sm">On hold</span>;
                      case 'supervisor': return <span className="pill warn sm">With supervisor</span>;
                      case 'operator': return <span className="pill info sm">Inspecting</span>;
                      default: return <span className="pill neutral sm">Not scanned</span>;
                    }
                  };

                  return (
                    <tr key={lot.batch_id} onClick={() => onSelectBatch(lot.batch_id)} className="click">
                      <td>
                        <div className="font-semibold text-[var(--ink)] mono text-xs">{lot.lot_number}</div>
                        <div className="text-[11px] text-[var(--muted)] mt-0.5">{lot.lot_name}</div>
                      </td>
                      <td>
                        <div className="font-medium text-[var(--ink)] text-xs">{lot.part_no}</div>
                        <div className="text-[11px] text-[var(--muted)] truncate max-w-[180px]">{lot.part_name}</div>
                      </td>
                      <td className="text-xs text-[var(--ink)]">{lot.operator_name}</td>
                      <td className="text-xs text-[var(--ink)]">{lot.supervisor_name}</td>
                      <td className="n font-semibold text-xs">{lot.lot_quantity}</td>
                      <td className="n font-medium text-xs">
                        {typeof lot.ng_count === 'number' ? (
                          lot.ng_count > 0 ? (
                            <span className="text-[var(--ng)] font-semibold">{lot.ng_count}</span>
                          ) : '0'
                        ) : '—'}
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {getStatusPill(lot.status_category)}
                          {lot.rev > 1 && <span className="pill neutral sm">Rev {lot.rev}</span>}
                        </div>
                      </td>
                      <td className="text-xs text-[var(--muted)] whitespace-nowrap">{lot.updated_short}</td>
                      <td className="text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => onSelectBatch(lot.batch_id)}
                            className="p-1.5 text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface2)] rounded-lg transition-colors cursor-pointer"
                            title="Open Checksheet"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setPrintSheetId(lot.sheet_id)}
                            className="p-1.5 text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface2)] rounded-lg transition-colors cursor-pointer"
                            title="Print Label"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                          <a
                            href={getExportUrl(lot.batch_id, 'pdf')}
                            download
                            onClick={(e) => handleReportDownloadClick(e, () => downloadBatchReport(lot.batch_id, 'pdf'))}
                            className="px-2 py-1 text-[11px] font-semibold text-[var(--ink)] bg-[var(--surface2)] hover:bg-[var(--line2)] rounded-md transition-colors"
                            title="Export PDF"
                          >
                            PDF
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="p-3.5 bg-[var(--surface2)] border-t border-[var(--line)] text-xs text-[var(--muted)] flex items-center justify-between flex-wrap gap-2">
          <span>Tap a row to open its checksheet.</span>
          {allLots.length > 0 && (
            <span>{allLots.length} total {allLots.length === 1 ? 'lot' : 'lots'}</span>
          )}
        </div>
      </div>

      {/* ── Create New Batch Modal ────────────────────────────────────────── */}
      {isNewBatchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="sv-card w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[18px] font-semibold text-[var(--ink)]">New Batch</h2>
              <button
                type="button"
                onClick={() => setIsNewBatchOpen(false)}
                className="p-1.5 hover:bg-[var(--surface2)] rounded-lg text-[var(--muted)] hover:text-[var(--ink)] transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {errorMsg && (
              <div className="border border-[var(--ng)] bg-[var(--ng-bg)] text-[var(--ng)] p-2.5 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleCreateBatch} className="space-y-3 text-xs">
              <div className="space-y-1.5">
                <label className="block font-semibold text-[var(--ink)]">Sheet / Template</label>
                {sheets.length === 0 ? (
                  <p className="text-[var(--muted)]">No sheets available. Create a sheet template first.</p>
                ) : (
                  <select
                    value={selectedSheetId}
                    onChange={(e) => setSelectedSheetId(e.target.value)}
                    required
                    className="w-full border border-[var(--line2)] rounded-xl px-3 py-2 bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] appearance-none cursor-pointer"
                  >
                    {sheets.map((s) => (
                      <option key={s.sheet_id} value={s.sheet_id}>{s.part_name || s.sheet_id}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="block font-semibold text-[var(--ink)]">Lot Number / Barcode</label>
                <input
                  type="text"
                  value={lotNumber}
                  onChange={(e) => setLotNumber(e.target.value)}
                  required
                  placeholder="e.g. 1234567890123"
                  className="w-full border border-[var(--line2)] rounded-xl px-3 py-2 bg-[var(--surface)] text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block font-semibold text-[var(--ink)]">Lot Quantity</label>
                <input
                  type="number"
                  min={1}
                  value={lotQuantity}
                  onChange={(e) => setLotQuantity(Number(e.target.value))}
                  required
                  className="w-full border border-[var(--line2)] rounded-xl px-3 py-2 bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block font-semibold text-[var(--ink)]">Inspection Mode</label>
                <select
                  value={inspectionMode}
                  onChange={(e) => setInspectionMode(e.target.value)}
                  className="w-full border border-[var(--line2)] rounded-xl px-3 py-2 bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] appearance-none cursor-pointer"
                >
                  <option value="IFM">IFM</option>
                  <option value="FULL">Full</option>
                  <option value="SAMPLE">Sample</option>
                </select>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsNewBatchOpen(false)}
                  className="btn flex-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || !selectedSheetId || !lotNumber}
                  className="btn primary flex-1 disabled:opacity-40"
                >
                  {isCreating ? 'Creating…' : 'Create Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {printSheetId && (
        <PrintLabelModal
          isOpen={!!printSheetId}
          sheetId={printSheetId}
          onClose={() => setPrintSheetId(null)}
        />
      )}
    </div>
  );
};
