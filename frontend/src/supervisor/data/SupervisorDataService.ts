import type { CheckResult, Disposition, OpenLotResult, ProtoStatus, SpotCheck, Workspace } from './types';

/**
 * Everything the supervisor screens read or write goes through this interface
 * (replaces the prototype's seed() / load() / save() / localStorage).
 * The live implementation is apiSupervisorService; another backend can be
 * plugged in by implementing this and changing data/index.ts.
 * Every write requires the lot to be locked to the current supervisor (openLot).
 */
export interface SupervisorDataService {
  /** Users, templates (SHEET / ITEMS / PARAMS) and lots. */
  getWorkspace(): Promise<Workspace>;
  /** Prototype ACT.svopen: lock a reviewable lot to me, or open a completed one read-only. */
  openLot(lotId: number): Promise<OpenLotResult>;
  /** Prototype ACT.svdec: decision for one bad item (column key). */
  setDisposition(lotId: number, columnKey: string, disposition: Disposition | null): Promise<void>;
  /** Prototype keypad: one dimension reading; null clears it. */
  setReading(lotId: number, paramId: string, sampleKey: string, value: number | null): Promise<void>;
  /** A supervisor-assigned check for one sample: Good (OK) / Bad (NG); null clears it. */
  setCheck(lotId: number, checkId: string, sampleKey: string, value: CheckResult | null): Promise<void>;
  /** Prototype ACT.oos: action taken for out-of-spec readings. */
  setOos(lotId: number, action: string | null): Promise<void>;
  /** Prototype ACT.svspot / svspotf / svspotdel: spot check of one good item (column key); null removes it. */
  setSpot(lotId: number, columnKey: string, spot: SpotCheck | null): Promise<void>;
  /** Prototype #svcomment: supervisor comments for the report. */
  setComment(lotId: number, comment: string): Promise<void>;
  /** Prototype svDownload: the lot report as a PDF file. */
  downloadReportPdf(lotId: number, code: string): Promise<void>;
  /** Prototype ACT.sign (Save): returns the lot's new status. */
  sign(lotId: number): Promise<{ status: ProtoStatus }>;
}
