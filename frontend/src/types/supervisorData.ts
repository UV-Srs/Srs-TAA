export interface SupervisorDimension {
  id: string;
  name: string;
  group: 'child' | 'flare';
  groupLabel: string;
  spec: string;
  min: number;
  max: number;
}

export const SUPERVISOR_DIMENSIONS: SupervisorDimension[] = [
  {
    id: 'tube_od',
    name: 'Tube OD after coating',
    group: 'child',
    groupLabel: 'CHILD PART DIMENSIONS',
    spec: '7.97 – 8.17',
    min: 7.97,
    max: 8.17,
  },
  {
    id: 'wall_thick',
    name: 'Wall thickness after coating',
    group: 'child',
    groupLabel: 'CHILD PART DIMENSIONS',
    spec: '0.67 – 0.83',
    min: 0.67,
    max: 0.83,
  },
  {
    id: 'tube_pp',
    name: 'Tube OD with PP cover',
    group: 'child',
    groupLabel: 'CHILD PART DIMENSIONS',
    spec: 'Ø10 +0.4 / −0.2',
    min: 9.80,
    max: 10.40,
  },
  {
    id: 'bulge_dia',
    name: 'Bulge dia, start side',
    group: 'flare',
    groupLabel: 'FLARE DIMENSIONS',
    spec: '9.30 ± 0.30',
    min: 9.00,
    max: 9.60,
  },
  {
    id: 'sq_dia',
    name: 'SQ dia, end side',
    group: 'flare',
    groupLabel: 'FLARE DIMENSIONS',
    spec: '7.95 ± 0.05',
    min: 7.90,
    max: 8.00,
  },
  {
    id: 'quick_bead',
    name: 'Quick bead dia, end side',
    group: 'flare',
    groupLabel: 'FLARE DIMENSIONS',
    spec: '11.10 ± 0.30',
    min: 10.80,
    max: 11.40,
  },
];

export interface SupervisorCheckItem {
  no: number;
  group: 'Visual' | 'Functional';
  name: string;
  requirement: string;
  method: string;
}

export const SUPERVISOR_CHECKS: SupervisorCheckItem[] = [
  { no: 1, group: 'Visual', name: 'Hose sealing surface', requirement: 'Free from burr, scratch, rust, dent, flash, flaw and concave on the jointing and sealing surface, both sides.', method: 'Visual' },
  { no: 2, group: 'Visual', name: 'Fuel passage', requirement: 'Free from any foreign body inside the fuel passage.', method: 'Block testing or air blow' },
  { no: 3, group: 'Visual', name: 'Metal tube', requirement: 'Free from scratch, dent, burr, ditch-line, damage, crack, deformation, metal chip, bending roller marks and pinch.', method: 'Visual' },
  { no: 4, group: 'Visual', name: 'Bulge and quick spool area', requirement: 'Free from burrs.', method: 'Visual' },
  { no: 5, group: 'Visual', name: 'Clamp marking M1', requirement: '10±3 mm, yellow colour, covering half or more. As per drawing.', method: 'Visual' },
  { no: 6, group: 'Visual', name: 'Clamp marking M2', requirement: 'Same as M1', method: 'Visual' },
  { no: 7, group: 'Visual', name: 'Clamp marking M3', requirement: 'Same as M1', method: 'Visual' },
  { no: 8, group: 'Visual', name: 'Hose marking', requirement: '10±5 mm and 3±2 mm, 1 place, yellow colour. As per drawing.', method: 'Visual' },
  { no: 9, group: 'Visual', name: 'Leak test mark', requirement: 'QR code sticker should be available on the part.', method: 'Visual' },
  { no: 10, group: 'Visual', name: 'QR code sticker appearance', requirement: 'No damage, light print, half print or duplicate sticker. Must scan.', method: 'Visual' },
  { no: 11, group: 'Visual', name: 'Traceability (batch code)', requirement: 'J.O. or batch code number should be available on the part.', method: 'Visual' },
  { no: 12, group: 'Functional', name: 'Part profile', requirement: 'Shape matches the drawing.', method: 'Profile gauge' },
  { no: 13, group: 'Functional', name: 'Leak testing', requirement: 'No leakage at 490 kPa minimum. Leak rate below 150 Pa.', method: 'Leak test machine' },
];

export type ReadingStatus = 'ok' | 'near_limit' | 'out_of_spec';

export function evalReading(val: number, min: number, max: number): ReadingStatus {
  if (isNaN(val)) return 'ok';
  if (val < min || val > max) return 'out_of_spec';
  const band = (max - min) * 0.10;
  if ((val >= min && val <= min + band) || (val <= max && val >= max - band)) {
    return 'near_limit';
  }
  return 'ok';
}

export interface SupervisorLotItem {
  batch_id: number;
  lot_barcode: string;
  lot_name: string;
  operator_name: string;
  items_qty: number;
  bad_count: number;
  bad_item_numbers: number[]; // e.g. [12, 45]
  status: 'With supervisor' | 'On hold' | 'Completed';
  is_new: boolean; // true = New, false = Pending
  reopened_reason?: string;
  locked_by?: string;
  submitted_at: string;
  saved_at?: string;
  spec_result?: 'In spec' | 'Near limit' | 'Out of spec';
  revision?: number;
  operator_clearance: string;
  // Visual decisions: itemNumber -> 'Approved' | 'On hold' | 'Rejected'
  visual_decisions: Record<number, 'Approved' | 'On hold' | 'Rejected'>;
  // Dimensions readings: sampleNum (1-10) -> dimId -> value string
  dimension_readings: Record<number, Record<string, string>>;
  oos_action?: 'Re-measured, confirmed' | 'Lot put on hold' | 'Process adjusted';
}

export const INITIAL_SUPERVISOR_LOTS: SupervisorLotItem[] = [
  {
    batch_id: 201,
    lot_barcode: '18351M62Q50-260820-01',
    lot_name: 'Lot 20-08',
    operator_name: 'Ravi K.',
    items_qty: 250,
    bad_count: 2,
    bad_item_numbers: [12, 45],
    status: 'With supervisor',
    is_new: true,
    submitted_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(), // 45 min ago
    operator_clearance: 'Cleared, NG items segregated',
    visual_decisions: {},
    dimension_readings: {
      1: { tube_od: '8.05', wall_thick: '0.74', tube_pp: '10.10', bulge_dia: '9.30', sq_dia: '7.95', quick_bead: '11.10' },
      2: { tube_od: '8.08', wall_thick: '0.76', tube_pp: '10.05', bulge_dia: '9.35', sq_dia: '7.94', quick_bead: '11.12' },
      3: { tube_od: '8.10', wall_thick: '0.75', tube_pp: '10.15', bulge_dia: '9.28', sq_dia: '7.96', quick_bead: '11.08' },
    },
  },
  {
    batch_id: 202,
    lot_barcode: '18351M62Q50-260819-01',
    lot_name: 'Lot 19-08',
    operator_name: 'Ravi K.',
    items_qty: 225,
    bad_count: 1,
    bad_item_numbers: [8],
    status: 'On hold',
    is_new: false,
    submitted_at: new Date(Date.now() - 140 * 60 * 1000).toISOString(),
    saved_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    operator_clearance: 'Cleared, NG items segregated',
    visual_decisions: { 8: 'On hold' },
    dimension_readings: {
      1: { tube_od: '8.02', wall_thick: '0.73', tube_pp: '10.12', bulge_dia: '9.31', sq_dia: '7.95', quick_bead: '11.15' },
      2: { tube_od: '8.05', wall_thick: '0.75', tube_pp: '10.08', bulge_dia: '9.33', sq_dia: '7.96', quick_bead: '11.09' },
    },
  },
  {
    batch_id: 203,
    lot_barcode: '18351M62Q50-260818-01',
    lot_name: 'Lot 18-08',
    operator_name: 'Sameer J.',
    items_qty: 180,
    bad_count: 3,
    bad_item_numbers: [5, 19, 74],
    status: 'With supervisor',
    is_new: false,
    reopened_reason: 'Check flare SQ dia on item 7 and confirm burr defect on item 19',
    submitted_at: new Date(Date.now() - 180 * 60 * 1000).toISOString(), // 3 hours ago
    operator_clearance: 'Cleared, NG items segregated',
    visual_decisions: { 5: 'Approved', 19: 'On hold' },
    dimension_readings: {
      1: { tube_od: '8.06', wall_thick: '0.78', tube_pp: '10.20', bulge_dia: '9.25', sq_dia: '7.88', quick_bead: '11.05' }, // sq_dia out of spec
      2: { tube_od: '8.05', wall_thick: '0.77', tube_pp: '10.18', bulge_dia: '9.30', sq_dia: '7.94', quick_bead: '11.10' },
    },
  },
  {
    batch_id: 204,
    lot_barcode: '18351M62Q50-260817-01',
    lot_name: 'Lot 17-08',
    operator_name: 'Ravi K.',
    items_qty: 270,
    bad_count: 0,
    bad_item_numbers: [],
    status: 'Completed',
    is_new: false,
    spec_result: 'In spec',
    revision: 1,
    submitted_at: '2026-08-17T10:00:00Z',
    saved_at: '2026-08-17T11:45:00Z',
    operator_clearance: 'Lot cleared',
    visual_decisions: {},
    dimension_readings: {
      1: { tube_od: '8.05', wall_thick: '0.74', tube_pp: '10.10', bulge_dia: '9.30', sq_dia: '7.95', quick_bead: '11.10' },
      2: { tube_od: '8.08', wall_thick: '0.76', tube_pp: '10.05', bulge_dia: '9.35', sq_dia: '7.94', quick_bead: '11.12' },
      3: { tube_od: '8.10', wall_thick: '0.75', tube_pp: '10.15', bulge_dia: '9.28', sq_dia: '7.96', quick_bead: '11.08' },
      4: { tube_od: '8.04', wall_thick: '0.74', tube_pp: '10.08', bulge_dia: '9.32', sq_dia: '7.95', quick_bead: '11.11' },
      5: { tube_od: '8.06', wall_thick: '0.75', tube_pp: '10.10', bulge_dia: '9.30', sq_dia: '7.96', quick_bead: '11.10' },
      6: { tube_od: '8.07', wall_thick: '0.77', tube_pp: '10.14', bulge_dia: '9.34', sq_dia: '7.94', quick_bead: '11.13' },
      7: { tube_od: '8.09', wall_thick: '0.76', tube_pp: '10.12', bulge_dia: '9.29', sq_dia: '7.95', quick_bead: '11.09' },
      8: { tube_od: '8.05', wall_thick: '0.73', tube_pp: '10.06', bulge_dia: '9.31', sq_dia: '7.97', quick_bead: '11.10' },
      9: { tube_od: '8.08', wall_thick: '0.75', tube_pp: '10.11', bulge_dia: '9.33', sq_dia: '7.94', quick_bead: '11.12' },
      10: { tube_od: '8.06', wall_thick: '0.74', tube_pp: '10.09', bulge_dia: '9.30', sq_dia: '7.95', quick_bead: '11.11' },
    },
  },
  {
    batch_id: 205,
    lot_barcode: '18351M62Q50-260816-01',
    lot_name: 'Lot 16-08',
    operator_name: 'Ravi K.',
    items_qty: 450,
    bad_count: 3,
    bad_item_numbers: [14, 88, 201],
    status: 'Completed',
    is_new: false,
    spec_result: 'Near limit',
    revision: 2,
    submitted_at: '2026-08-16T14:30:00Z',
    saved_at: '2026-08-16T16:00:00Z',
    operator_clearance: 'Cleared, NG items segregated',
    visual_decisions: { 14: 'Approved', 88: 'Rejected', 201: 'Approved' },
    dimension_readings: {
      1: { tube_od: '8.16', wall_thick: '0.75', tube_pp: '10.10', bulge_dia: '9.30', sq_dia: '7.95', quick_bead: '11.10' }, // tube_od near limit
      2: { tube_od: '8.08', wall_thick: '0.76', tube_pp: '10.05', bulge_dia: '9.35', sq_dia: '7.94', quick_bead: '11.12' },
      3: { tube_od: '8.10', wall_thick: '0.75', tube_pp: '10.15', bulge_dia: '9.28', sq_dia: '7.96', quick_bead: '11.08' },
      4: { tube_od: '8.04', wall_thick: '0.74', tube_pp: '10.08', bulge_dia: '9.32', sq_dia: '7.95', quick_bead: '11.11' },
      5: { tube_od: '8.06', wall_thick: '0.75', tube_pp: '10.10', bulge_dia: '9.30', sq_dia: '7.96', quick_bead: '11.10' },
      6: { tube_od: '8.07', wall_thick: '0.77', tube_pp: '10.14', bulge_dia: '9.34', sq_dia: '7.94', quick_bead: '11.13' },
      7: { tube_od: '8.09', wall_thick: '0.76', tube_pp: '10.12', bulge_dia: '9.29', sq_dia: '7.95', quick_bead: '11.09' },
      8: { tube_od: '8.05', wall_thick: '0.73', tube_pp: '10.06', bulge_dia: '9.31', sq_dia: '7.97', quick_bead: '11.10' },
      9: { tube_od: '8.08', wall_thick: '0.75', tube_pp: '10.11', bulge_dia: '9.33', sq_dia: '7.94', quick_bead: '11.12' },
      10: { tube_od: '8.06', wall_thick: '0.74', tube_pp: '10.09', bulge_dia: '9.30', sq_dia: '7.95', quick_bead: '11.11' },
    },
  },
];
