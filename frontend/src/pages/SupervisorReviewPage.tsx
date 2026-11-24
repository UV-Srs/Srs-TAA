import React, { useState, useEffect, useMemo, useRef } from 'react';
import { User } from '../types';
import {
  SupervisorLotItem,
  SUPERVISOR_DIMENSIONS,
  SUPERVISOR_CHECKS,
  evalReading,
  SupervisorDimension,
} from '../types/supervisorData';
import {
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Pause,
  AlertTriangle,
  Download,
  Barcode,
  Layers,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
} from 'lucide-react';

interface SupervisorReviewPageProps {
  lot: SupervisorLotItem;
  currentUser: User;
  initialMode?: 'review' | 'preview' | 'saved';
  prevLotBannerMessage?: string | null;
  onBackToLots: () => void;
  onSaveLot: (updatedLot: SupervisorLotItem, nextLotId?: number) => void;
  nextWaitingLot?: SupervisorLotItem | null;
  appSidebarOpen?: boolean;
  onToggleAppSidebar?: () => void;
}

export const SupervisorReviewPage: React.FC<SupervisorReviewPageProps> = ({
  lot,
  currentUser,
  initialMode = 'review',
  prevLotBannerMessage,
  onBackToLots,
  onSaveLot,
  nextWaitingLot,
  appSidebarOpen,
  onToggleAppSidebar,
}) => {
  const [pageMode, setPageMode] = useState<'review' | 'preview' | 'saved'>(initialMode);
  // Default Review Progress sidebar to CLOSED for bigger view
  const [showReviewProgress, setShowReviewProgress] = useState<boolean>(false);

  // Working copy of lot data
  const [decisions, setDecisions] = useState<Record<number, 'Approved' | 'On hold' | 'Rejected'>>(
    lot.visual_decisions || {}
  );
  const [readings, setReadings] = useState<Record<number, Record<string, string>>>(
    lot.dimension_readings || {}
  );
  const [oosAction, setOosAction] = useState<
    'Re-measured, confirmed' | 'Lot put on hold' | 'Process adjusted' | undefined
  >(lot.oos_action);

  // Current item being inspected/measured (1 .. lot.items_qty)
  const badItemsList = useMemo(() => lot.bad_item_numbers || [], [lot]);
  const initialItem = useMemo(() => {
    // If there's an undecided bad item, default to it; otherwise default to item 1
    const undecided = badItemsList.find((num) => !decisions[num] || decisions[num] === 'On hold');
    return undecided || 1;
  }, [badItemsList, decisions]);

  const [currentItem, setCurrentItem] = useState<number>(initialItem);
  const [activeDimId, setActiveDimId] = useState<string>(SUPERVISOR_DIMENSIONS[0].id);

  // Auto-scroll ref for item list
  const activeItemRowRef = useRef<HTMLButtonElement | null>(null);

  // Scroll active item in list into view
  useEffect(() => {
    if (activeItemRowRef.current) {
      activeItemRowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentItem]);

  // --- Metrics ---
  const badItemsCount = badItemsList.length;
  const decidedCount = useMemo(() => {
    return badItemsList.filter((num) => Boolean(decisions[num])).length;
  }, [badItemsList, decisions]);

  // Samples measured (how many of items 1..10 have all 6 dimensions)
  const sampleMeasurementCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (let i = 1; i <= 10; i++) {
      const sMap = readings[i] || {};
      let filled = 0;
      SUPERVISOR_DIMENSIONS.forEach((d) => {
        if (sMap[d.id] && sMap[d.id].trim() !== '') filled++;
      });
      counts[i] = filled;
    }
    return counts;
  }, [readings]);

  const fullyMeasuredSamplesCount = useMemo(() => {
    let c = 0;
    for (let i = 1; i <= 10; i++) {
      if (sampleMeasurementCounts[i] === 6) c++;
    }
    return c;
  }, [sampleMeasurementCounts]);

  const totalReadingsEntered = useMemo(() => {
    let c = 0;
    for (let i = 1; i <= 10; i++) {
      c += sampleMeasurementCounts[i] || 0;
    }
    return c;
  }, [sampleMeasurementCounts]);

  const totalTasks = badItemsCount + 10;
  const doneTasks = decidedCount + fullyMeasuredSamplesCount;
  const allReviewDone = badItemsCount === decidedCount && fullyMeasuredSamplesCount === 10;

  // Identify out-of-spec readings
  const outOfSpecReadings = useMemo(() => {
    const list: { sampleNum: number; dim: SupervisorDimension; val: number }[] = [];
    for (let s = 1; s <= 10; s++) {
      const sMap = readings[s] || {};
      for (const d of SUPERVISOR_DIMENSIONS) {
        const valStr = sMap[d.id];
        if (valStr) {
          const num = parseFloat(valStr);
          if (!isNaN(num) && evalReading(num, d.min, d.max) === 'out_of_spec') {
            list.push({ sampleNum: s, dim: d, val: num });
          }
        }
      }
    }
    return list;
  }, [readings]);

  const hasOutOfSpec = outOfSpecReadings.length > 0;
  const itemsOnHoldCount = useMemo(() => {
    return Object.values(decisions).filter((v) => v === 'On hold').length;
  }, [decisions]);

  // --- Handlers for Visual Decision ---
  const handleDecision = (choice: 'Approved' | 'On hold' | 'Rejected') => {
    const nextDec = { ...decisions, [currentItem]: choice };
    setDecisions(nextDec);
  };


  // --- Handlers for Keypad & Dimension Input ---
  const handleKeypadPress = (key: string) => {
    const sMap = readings[currentItem] || {};
    const currVal = sMap[activeDimId] || '';

    if (key === 'bksp') {
      const newVal = currVal.slice(0, -1);
      setReadings((prev) => ({
        ...prev,
        [currentItem]: {
          ...(prev[currentItem] || {}),
          [activeDimId]: newVal,
        },
      }));
      return;
    }

    if (currVal.length >= 6) return;

    let newVal = currVal;
    if (key === '.') {
      if (currVal.includes('.')) return;
      newVal = currVal === '' ? '0.' : currVal + '.';
    } else {
      newVal = currVal + key;
    }

    const updated = {
      ...readings,
      [currentItem]: {
        ...(readings[currentItem] || {}),
        [activeDimId]: newVal,
      },
    };
    setReadings(updated);

    // Auto-advance rule: when value has exactly two decimals (e.g. "8.05")
    if (/^\d+\.\d{2}$/.test(newVal)) {
      // Find next empty dimension in current item
      const currDimIdx = SUPERVISOR_DIMENSIONS.findIndex((d) => d.id === activeDimId);
      for (let i = 0; i < SUPERVISOR_DIMENSIONS.length; i++) {
        const nextIdx = (currDimIdx + 1 + i) % SUPERVISOR_DIMENSIONS.length;
        const nextDim = SUPERVISOR_DIMENSIONS[nextIdx];
        const val = updated[currentItem]?.[nextDim.id];
        if (!val || val.trim() === '') {
          setActiveDimId(nextDim.id);
          break;
        }
      }
    }
  };

  // Physical keyboard listener
  useEffect(() => {
    if (pageMode !== 'review') return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handleKeypadPress(e.key);
      } else if (e.key === '.') {
        e.preventDefault();
        handleKeypadPress('.');
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleKeypadPress('bksp');
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const currDimIdx = SUPERVISOR_DIMENSIONS.findIndex((d) => d.id === activeDimId);
        if (currDimIdx < SUPERVISOR_DIMENSIONS.length - 1) {
          setActiveDimId(SUPERVISOR_DIMENSIONS[currDimIdx + 1].id);
        } else if (currentItem < lot.items_qty) {
          setCurrentItem((s) => s + 1);
          setActiveDimId(SUPERVISOR_DIMENSIONS[0].id);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pageMode, activeDimId, currentItem, readings, lot.items_qty]);


  // Save handling
  const handleSave = () => {
    if (hasOutOfSpec && !oosAction) return;

    const newStatus: 'On hold' | 'Completed' = itemsOnHoldCount > 0 ? 'On hold' : 'Completed';
    const nowIso = new Date().toISOString();

    let calculatedSpecResult: 'In spec' | 'Near limit' | 'Out of spec' = 'In spec';
    if (hasOutOfSpec) {
      calculatedSpecResult = 'Out of spec';
    } else {
      let hasNearLimit = false;
      for (let s = 1; s <= 10; s++) {
        const sMap = readings[s] || {};
        for (const d of SUPERVISOR_DIMENSIONS) {
          const val = parseFloat(sMap[d.id] || '0');
          if (evalReading(val, d.min, d.max) === 'near_limit') {
            hasNearLimit = true;
            break;
          }
        }
        if (hasNearLimit) break;
      }
      if (hasNearLimit) calculatedSpecResult = 'Near limit';
    }

    const updated: SupervisorLotItem = {
      ...lot,
      status: newStatus,
      is_new: false,
      saved_at: nowIso,
      reopened_reason: undefined,
      locked_by: undefined,
      revision: newStatus === 'Completed' ? (lot.revision || 0) + 1 : lot.revision,
      spec_result: calculatedSpecResult,
      visual_decisions: decisions,
      dimension_readings: readings,
      oos_action: oosAction,
    };

    onSaveLot(updated, nextWaitingLot ? nextWaitingLot.batch_id : undefined);
  };

  const handleDownload = () => {
    window.print();
  };

  // Current item helpers
  const isCurrentBad = badItemsList.includes(currentItem);
  const currentDecision = decisions[currentItem];
  const isSampleItem = currentItem <= 10;

  // Next undecided bad item helper
  const nextUndecidedBad = useMemo(() => {
    return badItemsList.find((n) => n !== currentItem && !decisions[n]);
  }, [badItemsList, currentItem, decisions]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#F3F5F8] text-[#1B2533]">
      {/* ── Lot Bar (Sticky Top) ─────────────────────────────────── */}
      <div className="bg-white border-b border-[#E2E6EC] px-4 md:px-8 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0 z-30 shadow-sm">
        <div className="flex items-center flex-wrap gap-2.5">
          <button
            type="button"
            onClick={onBackToLots}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E2E6EC] bg-white text-[#2D5B8C] font-semibold text-xs hover:bg-[#E7EFF8] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Lots
          </button>

          {/* Side Navbar toggle button */}
          {onToggleAppSidebar && (
            <button
              type="button"
              onClick={onToggleAppSidebar}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                appSidebarOpen
                  ? 'bg-[#E7EFF8] text-[#2D5B8C] border-[#2D5B8C]'
                  : 'bg-white text-[#677386] border-[#E2E6EC] hover:bg-[#FAFBFD]'
              }`}
              title={appSidebarOpen ? 'Close navigation sidebar' : 'Expand navigation sidebar'}
            >
              <Menu className="w-3.5 h-3.5" />
              <span>{appSidebarOpen ? 'Close Menu' : 'Menu'}</span>
            </button>
          )}

          {/* Review Progress Toggle Button */}
          {pageMode === 'review' && (
            <button
              type="button"
              onClick={() => setShowReviewProgress((prev) => !prev)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all shadow-xs ${
                showReviewProgress
                  ? 'bg-[#E7EFF8] text-[#2D5B8C] border-[#2D5B8C]'
                  : 'bg-white text-[#1B2533] border-[#E2E6EC] hover:bg-[#FAFBFD]'
              }`}
              title={showReviewProgress ? 'Close Review Progress panel' : 'Expand Review Progress panel'}
            >
              {showReviewProgress ? (
                <PanelLeftClose className="w-3.5 h-3.5 text-[#2D5B8C]" />
              ) : (
                <PanelLeftOpen className="w-3.5 h-3.5 text-[#677386]" />
              )}
              <span>Review Progress</span>
              <span
                className={`px-1.5 py-0.2 rounded-full font-mono text-[10px] font-bold ${
                  allReviewDone ? 'bg-[#E4F3EB] text-[#23855A]' : 'bg-[#EEF1F6] text-[#677386]'
                }`}
              >
                {doneTasks}/{totalTasks}
              </span>
            </button>
          )}

          {/* Quick item switcher when Review Progress panel is closed */}
          {pageMode === 'review' && !showReviewProgress && (
            <div className="flex items-center gap-1 bg-[#FAFBFD] border border-[#E2E6EC] rounded-lg px-2 py-1">
              <button
                type="button"
                disabled={currentItem <= 1}
                onClick={() => setCurrentItem((i) => Math.max(1, i - 1))}
                className="p-0.5 text-[#677386] hover:text-[#1B2533] disabled:opacity-30 disabled:pointer-events-none rounded"
                title="Previous item"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-bold text-[#1B2533] px-1 whitespace-nowrap">
                Item {currentItem} / {lot.items_qty}
              </span>
              <button
                type="button"
                disabled={currentItem >= lot.items_qty}
                onClick={() => setCurrentItem((i) => Math.min(lot.items_qty, i + 1))}
                className="p-0.5 text-[#677386] hover:text-[#1B2533] disabled:opacity-30 disabled:pointer-events-none rounded"
                title="Next item"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="h-5 w-px bg-[#E2E6EC] hidden sm:block" />

          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#E7EFF8] text-[#2D5B8C] flex items-center justify-center shrink-0">
              <Barcode className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-[#677386] tracking-wider leading-none">
                Lot Barcode
              </div>
              <div className="font-bold text-xs md:text-sm text-[#1B2533] leading-tight">
                {lot.lot_barcode}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 md:gap-6 text-xs sm:text-sm">
          <div>
            <span className="text-[#677386] mr-1.5 text-xs uppercase font-semibold">Operator:</span>
            <span className="font-semibold text-[#1B2533]">{lot.operator_name}</span>
          </div>
          <div>
            <span className="text-[#677386] mr-1.5 text-xs uppercase font-semibold">Items:</span>
            <span className="font-semibold text-[#1B2533]">{lot.items_qty}</span>
          </div>
          <div className="hidden lg:block max-w-xs truncate">
            <span className="text-[#677386] mr-1.5 text-xs uppercase font-semibold">Clearance:</span>
            <span className="font-medium text-[#1B2533] bg-[#FAFBFD] px-2 py-0.5 rounded border border-[#E2E6EC]">
              {lot.operator_clearance}
            </span>
          </div>
          <div>
            <span className="text-[#677386] mr-1.5 text-xs uppercase font-semibold">Status:</span>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                lot.status === 'Completed'
                  ? 'bg-[#E4F3EB] text-[#23855A]'
                  : lot.status === 'On hold'
                  ? 'bg-[#FCF1DC] text-[#A46A0E]'
                  : 'bg-[#E7EFF8] text-[#2D5B8C]'
              }`}
            >
              {lot.status}
            </span>
          </div>
        </div>
      </div>

      {/* ── Banners ─────────────────────────────────────────────── */}
      {prevLotBannerMessage && (
        <div className="bg-[#E4F3EB] border-b border-[#23855A]/30 px-6 py-2.5 text-sm font-semibold text-[#23855A] flex items-center gap-2 shrink-0">
          <Check className="w-4 h-4 shrink-0" />
          <span>{prevLotBannerMessage} Next lot opened.</span>
        </div>
      )}

      {lot.reopened_reason && (
        <div className="bg-[#FCF1DC] border-b border-[#A46A0E]/30 px-6 py-3 text-sm font-semibold text-[#A46A0E] flex items-center gap-2.5 shrink-0">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <span className="font-bold">Reopened by admin:</span> {lot.reopened_reason}
          </div>
        </div>
      )}

      {/* ── Mode 1: Review Mode (Unified Screen with independent scroll bars) ── */}
      {pageMode === 'review' && (
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
          {/* ── Left Column: Review Progress (Dedicated Scrollbar, Expandable / Collapsible) ── */}
          {showReviewProgress && (
            <div className="w-full md:w-80 bg-white border-r border-[#E2E6EC] flex flex-col h-full shrink-0 overflow-hidden shadow-sm">
              {/* Top Progress Stats */}
              <div className="p-4 border-b border-[#E2E6EC] shrink-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs font-bold text-[#677386] uppercase tracking-wider">
                    Review progress
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowReviewProgress(false)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-[#677386] hover:text-[#C8463E] hover:bg-[#FCEAE8] px-2 py-0.5 rounded transition-colors"
                    title="Close review progress"
                  >
                    <PanelLeftClose className="w-3.5 h-3.5" />
                    <span>Close</span>
                  </button>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-light text-[#1B2533] leading-none">{doneTasks}</span>
                  <span className="text-xl text-[#677386] font-light">/ {totalTasks}</span>
                </div>

                {/* Progress bar */}
                <div className="w-full h-2 rounded-full bg-[#EEF1F6] mt-2.5 overflow-hidden">
                  <div
                    className="h-full bg-[#2D5B8C] transition-all duration-300"
                    style={{ width: `${Math.min(100, (doneTasks / Math.max(1, totalTasks)) * 100)}%` }}
                  />
                </div>

                {/* Status pills */}
                <div className="flex items-center gap-2 mt-3">
                  <span
                    className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                      badItemsCount === 0 || decidedCount === badItemsCount
                        ? 'bg-[#E4F3EB] text-[#23855A]'
                        : 'bg-[#FCEAE8] text-[#C8463E]'
                    }`}
                  >
                    {decidedCount}/{badItemsCount} decided
                  </span>
                  <span
                    className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                      fullyMeasuredSamplesCount === 10
                        ? 'bg-[#E4F3EB] text-[#23855A]'
                        : 'bg-[#EEF1F6] text-[#677386]'
                    }`}
                  >
                    {fullyMeasuredSamplesCount}/10 measured
                  </span>
                </div>

                <div className="text-[11px] text-[#677386] mt-2 flex items-center gap-1.5">
                  <span className="font-mono text-xs">▤</span> = sample parts (1–10)
                </div>
              </div>

              {/* Scrollable Items List (Dedicated Scrollbar) */}
              <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-[#E2E6EC]/60">
                {Array.from({ length: lot.items_qty }, (_, i) => i + 1).map((itemNum) => {
                  const isBad = badItemsList.includes(itemNum);
                  const decision = decisions[itemNum];
                  const sampleCount = sampleMeasurementCounts[itemNum] || 0;
                  const isCurrent = currentItem === itemNum;

                  return (
                    <button
                      key={itemNum}
                      type="button"
                      ref={isCurrent ? activeItemRowRef : null}
                      onClick={() => setCurrentItem(itemNum)}
                      className={`w-full px-4 py-3 text-left flex items-center justify-between text-xs transition-colors ${
                        isCurrent
                          ? 'bg-[#E7EFF8] font-bold text-[#2D5B8C] border-l-4 border-[#2D5B8C]'
                          : isBad
                          ? 'bg-[#FCEAE8]/50 hover:bg-[#FCEAE8] text-[#1B2533]'
                          : 'hover:bg-[#FAFBFD] text-[#1B2533]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">Item {itemNum}</span>
                        {sampleCount > 0 && (
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                              sampleCount === 6
                                ? 'bg-[#E4F3EB] text-[#23855A]'
                                : 'bg-[#EEF1F6] text-[#677386]'
                            }`}
                          >
                            ▤ {sampleCount}/6
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isBad ? (
                          decision ? (
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                decision === 'Approved'
                                  ? 'bg-[#E4F3EB] text-[#23855A]'
                                  : decision === 'On hold'
                                  ? 'bg-[#FCF1DC] text-[#A46A0E]'
                                  : 'bg-[#FCEAE8] text-[#C8463E]'
                              }`}
                            >
                              {decision}
                            </span>
                          ) : (
                            <span className="text-[#C8463E] font-bold text-[11px] flex items-center gap-0.5">
                              <X className="w-3 h-3" /> Decide
                            </span>
                          )
                        ) : (
                          <span className="text-[#23855A] font-bold">✓</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Right Column: Unified Item View (Dedicated Scrollbar, Full Width) ── */}
          <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden bg-[#F3F5F8]">
            {/* Scrollable Main Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 lg:p-8 space-y-6">
              <div className="max-w-6xl mx-auto space-y-6">
                {/* Unified Item Header */}
                <div className="bg-white border border-[#E2E6EC] rounded-2xl p-5 shadow-sm flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl md:text-3xl font-extrabold text-[#1B2533]">
                      Item {currentItem}{' '}
                      <span className="text-sm font-normal text-[#677386]">of {lot.items_qty}</span>
                    </h2>

                    {isCurrentBad ? (
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#FCEAE8] text-[#C8463E] border border-[#C8463E]/30">
                        Marked bad by {lot.operator_name}
                      </span>
                    ) : (
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#E4F3EB] text-[#23855A] border border-[#23855A]/30">
                        ✓ Marked good by {lot.operator_name}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-xs" />
                </div>

                {/* ── 1. Operator's Work (Visual & Functional Checks Sheet Table) ── */}
                <div className="bg-white border border-[#E2E6EC] rounded-xl overflow-hidden shadow-xs space-y-0">
                  <div className="px-4 py-2.5 bg-[#FAFBFD] border-b border-[#E2E6EC] flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-[#1B2533]">
                        1. Operator Inspection Sheet
                      </span>
                      <span className="text-xs text-[#677386]">· Recorded by {lot.operator_name}</span>
                    </div>

                    <span
                      className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                        isCurrentBad
                          ? 'bg-[#FCEAE8] text-[#C8463E]'
                          : 'bg-[#E4F3EB] text-[#23855A]'
                      }`}
                    >
                      {isCurrentBad ? 'Defects Reported by Operator' : 'All Checks Passed (✓)'}
                    </span>
                  </div>

                  {/* Supervisor Decision bar for items with defects */}
                  {isCurrentBad && (
                    <div className="px-4 py-2.5 bg-[#FEF9ED] border-b border-[#E2E6EC] flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-[#A46A0E] shrink-0" />
                        <span className="text-xs font-bold text-[#1B2533]">
                          Supervisor Decision for Item {currentItem}:
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDecision('Approved')}
                          className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all border ${
                            currentDecision === 'Approved'
                              ? 'bg-[#23855A] text-white border-[#23855A] shadow-xs'
                              : 'bg-white text-[#23855A] border-[#23855A] hover:bg-[#E4F3EB]'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                          Approve
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDecision('On hold')}
                          className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all border ${
                            currentDecision === 'On hold'
                              ? 'bg-[#A46A0E] text-white border-[#A46A0E] shadow-xs'
                              : 'bg-white text-[#A46A0E] border-[#A46A0E] hover:bg-[#FCF1DC]'
                          }`}
                        >
                          <Pause className="w-3.5 h-3.5 stroke-[3]" />
                          On hold
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDecision('Rejected')}
                          className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all border ${
                            currentDecision === 'Rejected'
                              ? 'bg-[#C8463E] text-white border-[#C8463E] shadow-xs'
                              : 'bg-white text-[#C8463E] border-[#C8463E] hover:bg-[#FCEAE8]'
                          }`}
                        >
                          <X className="w-3.5 h-3.5 stroke-[3]" />
                          Reject
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Compact Checks Sheet Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#F8FAFC] border-b border-[#E2E6EC] text-[#677386] uppercase font-semibold text-[11px]">
                          <th className="py-2 px-3 text-center w-10">#</th>
                          <th className="py-2 px-3 min-w-[160px]">Inspection Item</th>
                          <th className="py-2 px-3">Specification / Requirement</th>
                          <th className="py-2 px-3 min-w-[110px]">Method</th>
                          <th className="py-2 px-3 text-center w-28">Result</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E6EC]">
                        {SUPERVISOR_CHECKS.map((chk) => {
                          const isFail = isCurrentBad && (chk.no === 1 || chk.no === 3);
                          const isPass = !isFail;

                          return (
                            <tr
                              key={chk.no}
                              className={`transition-colors ${
                                isFail
                                  ? 'bg-[#FCEAE8]/50 hover:bg-[#FCEAE8]'
                                  : 'hover:bg-[#FAFBFD]'
                              }`}
                            >
                              <td className="py-2 px-3 text-center font-mono font-bold text-[#677386]">
                                {chk.no}
                              </td>
                              <td className="py-2 px-3 font-semibold text-[#1B2533]">
                                {chk.name}
                              </td>
                              <td className="py-2 px-3 text-[#677386] leading-relaxed">
                                {chk.requirement}
                              </td>
                              <td className="py-2 px-3 text-[#677386]">
                                {chk.method}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <div className="inline-flex items-center gap-1.5 select-none">
                                  {/* Tick Box */}
                                  <div
                                    className={`w-7 h-7 rounded-md border flex items-center justify-center transition-all ${
                                      isPass
                                        ? 'border-[#23855A] bg-[#23855A] text-white shadow-xs'
                                        : 'border-[#E2E6EC] bg-white text-[#CDD4DE]'
                                    }`}
                                    title="Marked Right (Pass)"
                                  >
                                    <Check className="w-4 h-4 stroke-[3]" />
                                  </div>

                                  {/* Cross Box */}
                                  <div
                                    className={`w-7 h-7 rounded-md border flex items-center justify-center transition-all ${
                                      isFail
                                        ? 'border-[#C8463E] bg-[#C8463E] text-white shadow-xs'
                                        : 'border-[#E2E6EC] bg-white text-[#CDD4DE]'
                                    }`}
                                    title="Marked Wrong (Defect)"
                                  >
                                    <X className="w-4 h-4 stroke-[3]" />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── 2. Supervisor Dimension Readings Sheet Table ── */}
                <div className="bg-white border border-[#E2E6EC] rounded-xl overflow-hidden shadow-xs space-y-0">
                  <div className="px-4 py-2.5 bg-[#FAFBFD] border-b border-[#E2E6EC] flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-[#2D5B8C]">
                        2. Supervisor Dimension Readings
                      </span>
                      <span className="text-xs text-[#677386]">· Item {currentItem} (Vernier caliper & micrometer)</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#E7EFF8] text-[#2D5B8C]">
                        {sampleMeasurementCounts[currentItem] || 0}/6 recorded
                      </span>
                    </div>
                  </div>

                  {/* Full-width Dimension Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#F8FAFC] border-b border-[#E2E6EC] text-[#677386] uppercase font-semibold text-[11px]">
                          <th className="py-2 px-3 text-center w-10">#</th>
                          <th className="py-2 px-3 min-w-[200px]">Dimension</th>
                          <th className="py-2 px-3 w-32">Group</th>
                          <th className="py-2 px-3 w-36 font-mono">Specification</th>
                          <th className="py-2 px-3 w-40 text-center">Reading (mm)</th>
                          <th className="py-2 px-3 w-32 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E6EC]">
                        {SUPERVISOR_DIMENSIONS.map((dim, idx) => {
                          const valStr = readings[currentItem]?.[dim.id] || '';
                          const valNum = parseFloat(valStr);
                          const hasVal = !isNaN(valNum) && valStr.trim() !== '';
                          const status = hasVal ? evalReading(valNum, dim.min, dim.max) : 'ok';
                          const isActive = activeDimId === dim.id;

                          return (
                            <tr
                              key={dim.id}
                              onClick={() => setActiveDimId(dim.id)}
                              className={`cursor-pointer transition-colors ${
                                isActive ? 'bg-[#E7EFF8]/60 font-semibold' : 'hover:bg-[#FAFBFD]'
                              }`}
                            >
                              <td className="py-2.5 px-3 text-center font-mono text-[#677386]">
                                {idx + 1}
                              </td>
                              <td className="py-2.5 px-3 font-medium text-[#1B2533]">
                                {dim.name}
                              </td>
                              <td className="py-2.5 px-3">
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                    dim.group === 'child'
                                      ? 'bg-[#FAFBFD] text-[#677386] border border-[#E2E6EC]'
                                      : 'bg-[#E7EFF8] text-[#2D5B8C]'
                                  }`}
                                >
                                  {dim.group === 'child' ? 'Child Part' : 'Flare'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-mono text-xs text-[#677386]">
                                {dim.spec}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <div className="flex items-center justify-center">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    id={`dim-input-${dim.id}`}
                                    value={valStr}
                                    placeholder="—"
                                    onFocus={() => setActiveDimId(dim.id)}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      if (v.length <= 6) {
                                        setReadings((prev) => ({
                                          ...prev,
                                          [currentItem]: {
                                            ...(prev[currentItem] || {}),
                                            [dim.id]: v,
                                          },
                                        }));
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === 'Tab') {
                                        const currIdx = SUPERVISOR_DIMENSIONS.findIndex((d) => d.id === dim.id);
                                        if (currIdx < SUPERVISOR_DIMENSIONS.length - 1) {
                                          e.preventDefault();
                                          const nextId = SUPERVISOR_DIMENSIONS[currIdx + 1].id;
                                          setActiveDimId(nextId);
                                          const nextEl = document.getElementById(`dim-input-${nextId}`);
                                          if (nextEl) (nextEl as HTMLInputElement).focus();
                                        }
                                      }
                                    }}
                                    className={`w-28 h-8 px-2 text-center font-mono font-bold text-sm rounded-lg border transition-all ${
                                      isActive
                                        ? 'border-[#2D5B8C] ring-2 ring-[#2D5B8C]/20 bg-white'
                                        : 'border-[#E2E6EC] bg-[#FAFBFD]'
                                    }`}
                                  />
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                {hasVal ? (
                                  <span
                                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                      status === 'out_of_spec'
                                        ? 'bg-[#FCEAE8] text-[#C8463E]'
                                        : status === 'near_limit'
                                        ? 'bg-[#FCF1DC] text-[#A46A0E]'
                                        : 'bg-[#E4F3EB] text-[#23855A]'
                                    }`}
                                  >
                                    {status === 'out_of_spec'
                                      ? 'Out of spec'
                                      : status === 'near_limit'
                                      ? 'Near limit'
                                      : 'OK'}
                                  </span>
                                ) : (
                                  <span className="text-xs text-[#677386]">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Sticky Bottom Action Bar ──────────────────────── */}
            <div className="bg-white border-t border-[#E2E6EC] px-6 py-4 flex flex-wrap items-center justify-between gap-4 shrink-0 shadow-lg z-20">
              <div className="text-sm">
                {decidedCount === badItemsCount ? (
                  <span className="font-bold text-[#23855A]">
                    ✓ All {badItemsCount} bad items decided · {totalReadingsEntered} dimension readings recorded.
                  </span>
                ) : (
                  <span className="text-[#677386]">
                    <strong className="text-[#C8463E]">{badItemsCount - decidedCount}</strong> bad item(s) need decision ·{' '}
                    <strong className="text-[#1B2533]">{totalReadingsEntered}</strong> readings recorded.
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={currentItem <= 1}
                  onClick={() => setCurrentItem((i) => Math.max(1, i - 1))}
                  className="px-4 py-2.5 rounded-xl border border-[#E2E6EC] bg-white text-[#1B2533] font-semibold text-sm hover:bg-[#FAFBFD] disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  ‹ Previous item
                </button>

                <button
                  type="button"
                  disabled={currentItem >= lot.items_qty}
                  onClick={() => setCurrentItem((i) => Math.min(lot.items_qty, i + 1))}
                  className="px-4 py-2.5 rounded-xl border border-[#E2E6EC] bg-white text-[#1B2533] font-semibold text-sm hover:bg-[#FAFBFD] disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  Next item ›
                </button>

                {nextUndecidedBad && (
                  <button
                    type="button"
                    onClick={() => setCurrentItem(nextUndecidedBad)}
                    className="px-4 py-2.5 rounded-xl bg-[#2D5B8C] text-white font-semibold text-sm hover:bg-[#23476E] transition-colors"
                  >
                    Jump to bad item #{nextUndecidedBad} ›
                  </button>
                )}

                <button
                  type="button"
                  disabled={decidedCount < badItemsCount}
                  onClick={() => setPageMode('preview')}
                  className="px-6 py-2.5 rounded-xl bg-[#23855A] text-white font-bold text-sm hover:bg-[#1C6D49] disabled:opacity-40 disabled:pointer-events-none transition-colors shadow-md"
                >
                  Preview report ›
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Mode 2 & 3: Preview and Saved Report Modes ───────────── */}
      {(pageMode === 'preview' || pageMode === 'saved') && (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-8 space-y-6 max-w-6xl mx-auto w-full">
          {/* Header Title + Stats */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E2E6EC] pb-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-[#1B2533]">
                {pageMode === 'preview' ? 'Preview the lot report' : 'Lot report'}
              </h1>
              <p className="text-sm text-[#677386] mt-1">
                {pageMode === 'preview'
                  ? 'Visual results with your decisions, and the sample dimensions. Read it through, then save.'
                  : `Saved by ${currentUser.full_name || 'Supervisor'}, ${new Date().toLocaleDateString('en-GB')}.`}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="bg-white border border-[#E2E6EC] rounded-xl px-4 py-2 text-center shadow-sm">
                <div className="text-[10px] uppercase font-bold text-[#677386]">Items</div>
                <div className="text-lg font-bold text-[#1B2533]">{lot.items_qty}</div>
              </div>
              <div className="bg-white border border-[#E2E6EC] rounded-xl px-4 py-2 text-center shadow-sm">
                <div className="text-[10px] uppercase font-bold text-[#677386]">Good</div>
                <div className="text-lg font-bold text-[#23855A]">
                  {lot.items_qty - badItemsCount}
                </div>
              </div>
              <div className="bg-white border border-[#E2E6EC] rounded-xl px-4 py-2 text-center shadow-sm">
                <div className="text-[10px] uppercase font-bold text-[#677386]">Bad</div>
                <div className={`text-lg font-bold ${badItemsCount > 0 ? 'text-[#C8463E]' : 'text-[#1B2533]'}`}>
                  {badItemsCount}
                </div>
              </div>
              <div className="bg-white border border-[#E2E6EC] rounded-xl px-4 py-2 text-center shadow-sm">
                <div className="text-[10px] uppercase font-bold text-[#677386]">Readings</div>
                <div className="text-lg font-bold text-[#2D5B8C]">{totalReadingsEntered}/60</div>
              </div>
            </div>
          </div>

          {/* Out of Spec Action Card (Section 7.1) */}
          {hasOutOfSpec && (
            <div className="bg-[#FCEAE8] border-2 border-[#C8463E] rounded-2xl p-6 shadow-sm space-y-4">
              <div className="flex items-center gap-2 text-[#C8463E] font-bold text-base">
                <AlertTriangle className="w-5 h-5" />
                <span>{outOfSpecReadings.length} reading(s) out of spec</span>
              </div>
              <div className="text-xs text-[#1B2533] space-y-1">
                {outOfSpecReadings.map((oos, idx) => (
                  <div key={idx}>
                    • <strong>{oos.dim.name}</strong> was recorded as <strong>{oos.val}</strong> on Item {oos.sampleNum} (Spec: {oos.dim.spec})
                  </div>
                ))}
              </div>

              {pageMode === 'preview' ? (
                <div className="pt-2">
                  <div className="text-xs font-bold text-[#677386] uppercase tracking-wider mb-2">
                    What was done?
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {[
                      'Re-measured, confirmed',
                      'Lot put on hold',
                      'Process adjusted',
                    ].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setOosAction(opt as any)}
                        className={`h-11 px-5 rounded-full font-semibold text-xs transition-all border ${
                          oosAction === opt
                            ? 'bg-[#2D5B8C] text-white border-[#2D5B8C] shadow-md'
                            : 'bg-white text-[#1B2533] border-[#E2E6EC] hover:bg-[#FAFBFD]'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-[#1B2533] font-semibold pt-1">
                  Action recorded: <span className="text-[#2D5B8C]">{oosAction || 'None'}</span>
                </div>
              )}
            </div>
          )}

          {/* Details Card (4 x 2 tiles) */}
          <div className="bg-white border border-[#E2E6EC] rounded-2xl p-6 shadow-sm">
            <h3 className="text-sm font-bold text-[#677386] uppercase tracking-wider mb-4">
              Lot & Inspection Details
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div className="bg-[#FAFBFD] p-3 rounded-xl border border-[#E2E6EC]">
                <div className="text-[#677386] text-[11px] mb-0.5">Part No.</div>
                <div className="font-bold text-[#1B2533]">#18351M62Q50</div>
              </div>
              <div className="bg-[#FAFBFD] p-3 rounded-xl border border-[#E2E6EC]">
                <div className="text-[#677386] text-[11px] mb-0.5">Part Name</div>
                <div className="font-bold text-[#1B2533]">Pipe, purge line (RH)</div>
              </div>
              <div className="bg-[#FAFBFD] p-3 rounded-xl border border-[#E2E6EC]">
                <div className="text-[#677386] text-[11px] mb-0.5">Lot Barcode</div>
                <div className="font-bold text-[#1B2533]">{lot.lot_barcode}</div>
              </div>
              <div className="bg-[#FAFBFD] p-3 rounded-xl border border-[#E2E6EC]">
                <div className="text-[#677386] text-[11px] mb-0.5">Lot</div>
                <div className="font-bold text-[#1B2533]">
                  {lot.lot_name}, {new Date().toLocaleDateString('en-GB')}
                </div>
              </div>
              <div className="bg-[#FAFBFD] p-3 rounded-xl border border-[#E2E6EC]">
                <div className="text-[#677386] text-[11px] mb-0.5">Inspected by</div>
                <div className="font-bold text-[#1B2533]">{lot.operator_name}</div>
              </div>
              <div className="bg-[#FAFBFD] p-3 rounded-xl border border-[#E2E6EC]">
                <div className="text-[#677386] text-[11px] mb-0.5">Operator clearance</div>
                <div className="font-bold text-[#1B2533] truncate">{lot.operator_clearance}</div>
              </div>
              <div className="bg-[#FAFBFD] p-3 rounded-xl border border-[#E2E6EC]">
                <div className="text-[#677386] text-[11px] mb-0.5">Bad item decisions</div>
                <div className="font-bold text-[#1B2533]">
                  {Object.values(decisions).filter((d) => d === 'Approved').length} approved,{' '}
                  {itemsOnHoldCount} on hold,{' '}
                  {Object.values(decisions).filter((d) => d === 'Rejected').length} rejected
                </div>
              </div>
              <div className="bg-[#FAFBFD] p-3 rounded-xl border border-[#E2E6EC]">
                <div className="text-[#677386] text-[11px] mb-0.5">Reviewed by</div>
                <div className="font-bold text-[#2D5B8C]">{currentUser.full_name || 'Supervisor'}</div>
              </div>
            </div>
          </div>

          {/* Dimension Check Card (Section 9) */}
          <div className="bg-white border border-[#E2E6EC] rounded-2xl p-6 shadow-sm overflow-x-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[#677386] uppercase tracking-wider">
                Dimension check, samples (items 1 – 10)
              </h3>
              <span className="text-xs text-[#677386]">Vernier caliper / micrometer</span>
            </div>

            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-[#FAFBFD] border-b border-[#E2E6EC]">
                  <th className="py-2.5 px-3 font-semibold text-[#1B2533]">Dimension</th>
                  <th className="py-2.5 px-3 font-semibold text-[#677386]">Spec</th>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((s) => (
                    <th key={s} className="py-2.5 px-2 text-center font-semibold text-[#1B2533]">
                      #{s}
                    </th>
                  ))}
                  <th className="py-2.5 px-3 text-center font-semibold text-[#1B2533]">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E6EC]">
                {SUPERVISOR_DIMENSIONS.map((dim) => {
                  let hasOos = false;
                  let hasNear = false;
                  let count = 0;

                  for (let s = 1; s <= 10; s++) {
                    const val = parseFloat(readings[s]?.[dim.id] || '');
                    if (!isNaN(val)) {
                      count++;
                      const st = evalReading(val, dim.min, dim.max);
                      if (st === 'out_of_spec') hasOos = true;
                      if (st === 'near_limit') hasNear = true;
                    }
                  }

                  const resultLabel =
                    count < 10
                      ? `${count}/10`
                      : hasOos
                      ? 'Out of spec'
                      : hasNear
                      ? 'Near limit'
                      : '✓';

                  const resultClass =
                    count < 10
                      ? 'bg-[#EEF1F6] text-[#677386]'
                      : hasOos
                      ? 'bg-[#FCEAE8] text-[#C8463E]'
                      : hasNear
                      ? 'bg-[#FCF1DC] text-[#A46A0E]'
                      : 'bg-[#E4F3EB] text-[#23855A]';

                  return (
                    <tr key={dim.id} className="hover:bg-[#FAFBFD]">
                      <td className="py-2.5 px-3 font-semibold text-[#1B2533]">{dim.name}</td>
                      <td className="py-2.5 px-3 text-[#677386] font-mono">{dim.spec}</td>
                      {Array.from({ length: 10 }, (_, i) => i + 1).map((s) => {
                        const val = readings[s]?.[dim.id] || '—';
                        const valNum = parseFloat(val);
                        const st = !isNaN(valNum) ? evalReading(valNum, dim.min, dim.max) : 'ok';

                        return (
                          <td
                            key={s}
                            className={`py-2 px-2 text-center font-mono font-medium ${
                              st === 'out_of_spec'
                                ? 'bg-[#FCEAE8] text-[#C8463E] font-bold'
                                : st === 'near_limit'
                                ? 'bg-[#FCF1DC] text-[#A46A0E] font-bold'
                                : 'text-[#1B2533]'
                            }`}
                          >
                            {val}
                          </td>
                        );
                      })}
                      <td className="py-2 px-3 text-center">
                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${resultClass}`}>
                          {resultLabel}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Item-by-item grid (chunks of 30 items) */}
          <div className="bg-white border border-[#E2E6EC] rounded-2xl p-6 shadow-sm overflow-x-auto space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#677386] uppercase tracking-wider">
                Inspection Item-by-Item Grid (Items 1 – {Math.min(30, lot.items_qty)})
              </h3>
              <span className="text-xs text-[#677386]">Page 1 of {Math.ceil(lot.items_qty / 30)}</span>
            </div>

            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-[#FAFBFD] border-b border-[#E2E6EC]">
                  <th className="py-2 px-2 text-center font-semibold text-[#677386] w-10">#</th>
                  <th className="py-2 px-3 font-semibold text-[#1B2533]">Control Check Item</th>
                  <th className="py-2 px-3 font-semibold text-[#677386]">Method</th>
                  {Array.from({ length: Math.min(30, lot.items_qty) }, (_, i) => i + 1).map((itemNum) => (
                    <th key={itemNum} className="py-2 px-1 text-center font-semibold text-[#1B2533] w-7">
                      {itemNum}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E6EC]">
                {SUPERVISOR_CHECKS.map((chk) => (
                  <tr key={chk.no} className="hover:bg-[#FAFBFD]">
                    <td className="py-1.5 px-2 text-center text-[#677386] font-mono">{chk.no}</td>
                    <td className="py-1.5 px-3 font-medium text-[#1B2533]">{chk.name}</td>
                    <td className="py-1.5 px-3 text-[#677386]">{chk.method}</td>
                    {Array.from({ length: Math.min(30, lot.items_qty) }, (_, i) => i + 1).map((itemNum) => {
                      const isBad = badItemsList.includes(itemNum);
                      const isFailedCheck = isBad && (chk.no === 1 || chk.no === 3);
                      return (
                        <td
                          key={itemNum}
                          className={`py-1.5 px-1 text-center font-bold ${
                            isFailedCheck ? 'text-[#C8463E] bg-[#FCEAE8]' : 'text-[#23855A]'
                          }`}
                        >
                          {isFailedCheck ? '✕' : '✓'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {/* Operator Result Row */}
                <tr className="bg-[#FAFBFD] border-t-2 border-[#E2E6EC] font-bold">
                  <td colSpan={3} className="py-2 px-3 text-[#1B2533]">
                    Operator Result
                  </td>
                  {Array.from({ length: Math.min(30, lot.items_qty) }, (_, i) => i + 1).map((itemNum) => {
                    const isBad = badItemsList.includes(itemNum);
                    return (
                      <td
                        key={itemNum}
                        className={`py-2 px-1 text-center ${
                          isBad ? 'text-[#C8463E] bg-[#FCEAE8]' : 'text-[#23855A]'
                        }`}
                      >
                        {isBad ? '✕' : '✓'}
                      </td>
                    );
                  })}
                </tr>
                {/* Supervisor Decision Row */}
                <tr className="bg-[#FAFBFD] border-t border-[#E2E6EC] font-bold">
                  <td colSpan={3} className="py-2 px-3 text-[#2D5B8C]">
                    Supervisor Decision
                  </td>
                  {Array.from({ length: Math.min(30, lot.items_qty) }, (_, i) => i + 1).map((itemNum) => {
                    const isBad = badItemsList.includes(itemNum);
                    if (!isBad) return <td key={itemNum} className="py-2 px-1 text-center text-[#677386]">—</td>;

                    const dec = decisions[itemNum];
                    const letter = dec === 'Approved' ? 'A' : dec === 'On hold' ? 'H' : dec === 'Rejected' ? 'R' : '—';
                    const color =
                      letter === 'A'
                        ? 'text-[#23855A]'
                        : letter === 'H'
                        ? 'text-[#A46A0E]'
                        : letter === 'R'
                        ? 'text-[#C8463E]'
                        : 'text-[#677386]';

                    return (
                      <td key={itemNum} className={`py-2 px-1 text-center ${color}`}>
                        {letter}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Sticky Bottom Save / Action Bar */}
          <div className="bg-white border border-[#E2E6EC] rounded-2xl p-4 shadow-lg flex flex-wrap items-center justify-between gap-4 sticky bottom-4 z-20">
            <div>
              {pageMode === 'preview' ? (
                hasOutOfSpec && !oosAction ? (
                  <span className="text-sm font-semibold text-[#C8463E]">
                    Say what was done about the out-of-spec readings.
                  </span>
                ) : itemsOnHoldCount > 0 ? (
                  <span className="text-sm font-semibold text-[#A46A0E]">
                    {itemsOnHoldCount} item(s) on hold. The lot stays on hold until you approve or reject them.
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-[#23855A]">
                    Report correct? Save completes the lot.
                  </span>
                )
              ) : (
                <span className="text-sm font-semibold text-[#677386]">Read-only. Completed.</span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {pageMode === 'preview' && (
                <button
                  type="button"
                  onClick={() => setPageMode('review')}
                  className="px-4 py-2.5 rounded-xl border border-[#E2E6EC] bg-white text-[#1B2533] font-semibold text-sm hover:bg-[#FAFBFD] transition-colors"
                >
                  ‹ Back to review
                </button>
              )}

              <button
                type="button"
                onClick={handleDownload}
                className="px-4 py-2.5 rounded-xl border border-[#E2E6EC] bg-white text-[#2D5B8C] font-semibold text-sm hover:bg-[#E7EFF8] transition-colors flex items-center gap-1.5"
              >
                <Download className="w-4 h-4" />
                Download
              </button>

              {pageMode === 'preview' ? (
                <button
                  type="button"
                  disabled={hasOutOfSpec && !oosAction}
                  onClick={handleSave}
                  className={`px-6 py-2.5 rounded-xl font-bold text-sm text-white shadow-md transition-all ${
                    itemsOnHoldCount > 0
                      ? 'bg-[#A46A0E] hover:bg-[#86560B]'
                      : 'bg-[#23855A] hover:bg-[#1C6D49]'
                  } disabled:opacity-40 disabled:pointer-events-none`}
                >
                  {itemsOnHoldCount > 0 ? 'Save, keep on hold' : 'Save'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onBackToLots}
                  className="px-6 py-2.5 rounded-xl bg-[#2D5B8C] text-white font-bold text-sm hover:bg-[#23476E] shadow-md transition-all"
                >
                  ‹ Back to lots
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
