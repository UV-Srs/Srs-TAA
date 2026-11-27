import React from 'react';
import { resolveQR } from '../api';
import { ScanScreen } from '../supervisor/screens/ScanScreen';
import '../supervisor/supervisor.css';
import '../supervisor/supervisor-additions.css';

interface AdminScanPageProps {
  /** A registered lot was scanned: open its checksheet. */
  onBatchResolved: (batchId: number) => void;
  /** A template QR / barcode was scanned. */
  onTemplateResolved: (sheetId: string) => void;
  /** The code isn't registered yet: offer to create a batch for it. */
  onUnregistered: (code: string) => void;
}

const isNotRegistered = (msg: string) =>
  msg.includes('NOT_REGISTERED') || msg.includes("isn't registered") || msg.includes('404');

/**
 * Admin Scan tab: the supervisor's Scan screen (scan card, type-in box, camera and photo scan,
 * hardware scanner), with the admin's scan actions (same as the old search/scan bar under the header).
 */
export const AdminScanPage: React.FC<AdminScanPageProps> = ({ onBatchResolved, onTemplateResolved, onUnregistered }) => {
  const onScan = async (raw: string): Promise<{ error: string }> => {
    const code = raw.trim();
    if (!code) return { error: 'Scan a barcode or type its number.' };
    try {
      const res = await resolveQR(code);
      if (res.batch_id) {
        onBatchResolved(res.batch_id);
        return { error: '' };
      }
      if (res.sheet_id) {
        onTemplateResolved(res.sheet_id);
        return { error: '' };
      }
      return { error: `Nothing found for “${code}”.` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isNotRegistered(msg)) {
        onUnregistered(code);
        return { error: '' };
      }
      return { error: msg || 'Could not find a checksheet for this code.' };
    }
  };

  return (
    <div className="sv-root admin-scan" style={{ background: 'transparent' }}>
      <ScanScreen onScan={onScan} />
    </div>
  );
};
