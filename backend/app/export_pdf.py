import io
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm

# ── Palette ────────────────────────────────────────────────────────────────
_GREY_HEAD = colors.HexColor("#F4F4F5")
_BLUE_HEAD = colors.HexColor("#D6E4F0")
_OK_GREEN  = colors.HexColor("#027A48")
_NG_RED    = colors.HexColor("#B42318")
_OK_BG     = colors.HexColor("#ECFDF3")
_NG_BG     = colors.HexColor("#FEF3F2")
_SUP_BG    = colors.HexColor("#EEF4FB")   # light blue tint for supervisor rows
_BLACK     = colors.black
_WHITE     = colors.white


def _sty(parent, **kw):
    return ParagraphStyle("_", parent=parent, **kw)


def generate_pdf_report(batch, template, cell_responses, decisions, attachments, upload_dir) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=12 * mm, rightMargin=12 * mm,
        topMargin=10 * mm,  bottomMargin=10 * mm,
    )

    base = getSampleStyleSheet()["Normal"]
    T    = _sty(base, fontName="Helvetica-Bold", fontSize=11, leading=14, alignment=1)
    S    = _sty(base, fontName="Helvetica-Bold", fontSize=8,  leading=10, alignment=1)
    B    = _sty(base, fontName="Helvetica-Bold", fontSize=7,  leading=9)
    R    = _sty(base, fontName="Helvetica",      fontSize=7,  leading=9)
    C    = _sty(base, fontName="Helvetica",      fontSize=7,  leading=9,  alignment=1)
    CB   = _sty(base, fontName="Helvetica-Bold", fontSize=7,  leading=9,  alignment=1)
    OK_S = _sty(base, fontName="Helvetica-Bold", fontSize=7,  leading=9,  alignment=1,
                textColor=_OK_GREEN)
    NG_S = _sty(base, fontName="Helvetica-Bold", fontSize=7,  leading=9,  alignment=1,
                textColor=_NG_RED)
    ATT  = _sty(base, fontName="Helvetica",      fontSize=8,  leading=12)   # attribution line

    PAGE_W = 267 * mm

    # ── Helpers ────────────────────────────────────────────────────────────
    def _fmt_date(dt):
        try:    return dt.strftime("%d-%b-%Y")
        except: return "—"

    def _fmt_dt(dt):
        try:    return dt.strftime("%d-%b-%Y %H:%M")
        except: return "—"

    def _user_name(rel):
        if rel is None: return "—"
        return getattr(rel, "full_name", None) or getattr(rel, "username", "?")

    def _tbl(rows, col_w, repeat=1, extra=None):
        t = Table(rows, colWidths=col_w, repeatRows=repeat)
        s = [
            ("BOX",           (0, 0), (-1, -1), 1,   _BLACK),
            ("INNERGRID",     (0, 0), (-1, -1), 0.5, _BLACK),
            ("TOPPADDING",    (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("LEFTPADDING",   (0, 0), (-1, -1), 3),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 3),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]
        if extra:
            s.extend(extra)
        t.setStyle(TableStyle(s))
        return t

    # ── Build cell lookup ──────────────────────────────────────────────────
    # For supervisor numeric items: supervisor may enter readings as piece numbers
    # (1, 2, 3…) or as sample labels (S1, S2, S3…).
    # We store both: direct lookup by piece num, and S-label mapped to position.
    cell_map = {}
    for r in cell_responses:
        cell_map[(r.item_id, str(r.column_key))] = r

    def _get_cell(item_id, piece_num):
        """Return cell response for a given item + piece number.
        Falls back to Sn label (S1→1, S2→2, …) for supervisor numeric rows."""
        direct = cell_map.get((item_id, str(piece_num)))
        if direct:
            return direct
        # S-label fallback
        return cell_map.get((item_id, f"S{piece_num}"))

    story = []

    # ══════════════════════════════════════════════════════════════════════
    # 1. TITLE
    # ══════════════════════════════════════════════════════════════════════
    doc_title = (template.document_title
                 or "DAILY INITIAL FLOW MANAGEMENT CONTROL ITEMS MONITORING CHECKSHEET")
    story.append(Paragraph(f"<b>{doc_title}</b>", T))
    story.append(Paragraph("<b>(PRODUCT PARAMETER)</b>", S))
    story.append(Spacer(1, 3 * mm))

    # ══════════════════════════════════════════════════════════════════════
    # 2. METADATA GRID
    # ══════════════════════════════════════════════════════════════════════
    lot_qty      = batch.lot_quantity or 0
    status_label = (batch.status or "").replace("_", " ")
    meta_rows = [
        [
            Paragraph(f"<b>SHEET ID:</b> {template.sheet_id or '—'}", R),
            Paragraph(f"<b>PART NO.:</b> {template.part_no or '—'}", R),
            Paragraph(f"<b>PART NAME:</b> {template.part_name or '—'}", R),
            Paragraph(f"<b>CATEGORY:</b> {template.part_category or 'MAIN PART'}", R),
        ],
        [
            Paragraph(f"<b>MODEL:</b> {template.model_name or '—'}", R),
            Paragraph(f"<b>VENDOR:</b> {template.vendor_name or '—'}", R),
            Paragraph(f"<b>CUSTOMER:</b> {template.customer_name or '—'}", R),
            Paragraph(f"<b>DATE:</b> {_fmt_date(batch.created_at)}", R),
        ],
        [
            Paragraph(f"<b>LOT NO.:</b> {batch.lot_number}", R),
            Paragraph(f"<b>LOT QTY:</b> {lot_qty}", R),
            Paragraph(f"<b>MODE:</b> {batch.inspection_mode or 'NORMAL'}", R),
            Paragraph(f"<b>STATUS:</b> {status_label}", B),
        ],
    ]
    story.append(_tbl(meta_rows, [66*mm, 66*mm, 75*mm, 60*mm],
                      extra=[("BACKGROUND", (0, 0), (-1, -1), _WHITE)]))
    story.append(Spacer(1, 4 * mm))

    # ══════════════════════════════════════════════════════════════════════
    # 3. UNIFIED PER-PIECE INSPECTION RECORD
    #    Columns = piece numbers  1 … lot_qty   (25 per chunk)
    #    Rows:
    #      • SERIAL_TICKBOX  items  (operator visual checks)  — ✓ / ✕ / ·
    #      • NUMERIC_SAMPLE  items  (supervisor dimensions)   — numeric value or —
    #      • Piece Result  row  (overall pass/fail per piece)
    # ══════════════════════════════════════════════════════════════════════
    all_items  = template.control_items or []
    tick_items = [it for it in all_items if it.row_mode == "SERIAL_TICKBOX"]
    num_items  = [it for it in all_items if it.row_mode == "NUMERIC_SAMPLE"]
    # Other item types (STANDARD_INPUT, remarks) are excluded from the grid

    if (tick_items or num_items) and lot_qty > 0:
        story.append(Paragraph(
            f"<b>PER-PIECE VISUAL INSPECTION RECORD — {lot_qty} pcs</b>", S))
        story.append(Spacer(1, 2 * mm))

        MAX_PC = 25
        ITEM_W = 55 * mm
        pc_w   = max(5 * mm, (PAGE_W - ITEM_W) / MAX_PC)

        chunks = []
        for start in range(1, lot_qty + 1, MAX_PC):
            end = min(start + MAX_PC - 1, lot_qty)
            chunks.append(list(range(start, end + 1)))

        for chunk in chunks:
            # ── header ──────────────────────────────────────────
            hdr = [Paragraph("<b>Control Item</b>", CB)] + [
                Paragraph(f"<b>{p}</b>", CB) for p in chunk
            ]
            rows   = [hdr]
            extras = [("BACKGROUND", (0, 0), (-1, 0), _BLUE_HEAD)]

            # ── operator visual rows ─────────────────────────────
            for it in tick_items:
                row = [Paragraph(it.control_item_name or "—", B)]
                for p in chunk:
                    resp = _get_cell(it.item_id, p)
                    val  = str(resp.cell_value).strip().lower() if (resp and resp.cell_value) else ""
                    if val in ("fail", "ng", "false", "0"):
                        row.append(Paragraph("<b>✕</b>", NG_S))
                    elif val in ("pass", "ok", "true", "1"):
                        row.append(Paragraph("<b>✓</b>", OK_S))
                    else:
                        row.append(Paragraph("·", C))
                rows.append(row)

            # ── supervisor dimension rows ────────────────────────
            # Rendered with a light-blue tint so they stand out from visual rows
            for it in num_items:
                row = [Paragraph(it.control_item_name or "—", B)]
                row_idx = len(rows)
                for p in chunk:
                    resp = _get_cell(it.item_id, p)
                    val  = resp.cell_value if resp else None
                    if val:
                        num = None
                        try:
                            num = float(val)
                        except (TypeError, ValueError):
                            pass
                        oos = (num is not None
                               and it.min_val is not None and it.max_val is not None
                               and (num < it.min_val or num > it.max_val))
                        row.append(Paragraph(f"<b>{val}</b>" if oos else str(val),
                                             NG_S if oos else C))
                    else:
                        row.append(Paragraph("", C))
                extras.append(("BACKGROUND", (0, row_idx), (0, row_idx), _SUP_BG))
                rows.append(row)

            # ── piece-result row ─────────────────────────────────
            pr_idx = len(rows)
            pr_row = [Paragraph("<b>Piece Result</b>", CB)]
            tick_ids = {it.item_id for it in tick_items}
            for p in chunk:
                p_tick = [cr for cr in cell_responses
                          if str(cr.column_key) == str(p) and cr.item_id in tick_ids]
                has_fail = any(str(cr.cell_value).strip().lower() in ("fail", "ng", "false", "0")
                               for cr in p_tick)
                if has_fail:
                    pr_row.append(Paragraph("<b>✕</b>", NG_S))
                elif p_tick:
                    pr_row.append(Paragraph("<b>✓</b>", OK_S))
                else:
                    pr_row.append(Paragraph("·", C))
            rows.append(pr_row)
            extras.append(("BACKGROUND", (0, pr_idx), (-1, pr_idx), _GREY_HEAD))

            cw = [ITEM_W] + [pc_w] * len(chunk)
            story.append(_tbl(rows, cw, repeat=1, extra=extras))
            if chunk != chunks[-1]:
                story.append(Spacer(1, 2 * mm))

        story.append(Spacer(1, 5 * mm))

    # ══════════════════════════════════════════════════════════════════════
    # 4. ATTRIBUTION  —  Created by / Visual check by / Dimension check by
    # ══════════════════════════════════════════════════════════════════════
    admin_name    = _user_name(batch.approved_user) if batch.approved_user \
                    else (_user_name(batch.checked_user)   # fall back to whoever is set
                          if batch.checked_user else "—")
    # "Created by" = the user who created the batch (may be admin role)
    # We use the prepared_by user as operator, checked_by as supervisor,
    # and approved_by as admin; if approved_by not set yet, show "—"
    created_name   = _user_name(batch.approved_user) if batch.approved_user else "—"
    op_name        = _user_name(batch.prepared_user)
    sup_name       = _user_name(batch.checked_user)
    op_time        = _fmt_dt(batch.operator_submitted_at)
    sup_time       = _fmt_dt(batch.supervisor_submitted_at)

    attr_rows = [
        [
            Paragraph("<b>Created by (Admin)</b>",           CB),
            Paragraph("<b>Visual Check by (Operator)</b>",   CB),
            Paragraph("<b>Dimension Check by (Supervisor)</b>", CB),
        ],
        [
            Paragraph(created_name, R),
            Paragraph(f"{op_name}"
                      + (f"<br/>Submitted: {op_time}" if batch.operator_submitted_at else ""), R),
            Paragraph(f"{sup_name}"
                      + (f"<br/>Reviewed: {sup_time}" if batch.supervisor_submitted_at else ""), R),
        ],
    ]
    story.append(_tbl(attr_rows, [89*mm, 89*mm, 89*mm],
                      extra=[("BACKGROUND", (0, 0), (-1, 0), _GREY_HEAD)]))

    doc.build(story)
    return buffer.getvalue()
