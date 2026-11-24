"""
IFM checksheet PDF export.

Reproduces the physical "DAILY INITIAL FLOW MANAGEMENT CONTROL ITEMS MONITORING CHECKSHEET
(PRODUCT PARAMETER)" form: part header + title + date, the inspection matrix with merged stage
column and per-sample result columns (Result / Date / S.No header, check marks, measured values),
CHK BY / APP BY rows, notes, Prepared / Checked / Approved sign-off block and images.
All content is populated from the database via backend.app.checksheet_report.
"""
import io
from datetime import datetime
from xml.sax.saxutils import escape as _esc

from reportlab.lib import colors
from reportlab.lib.pagesizes import A3, A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import (
    Flowable, Image as RLImage, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer,
    Table, TableStyle,
)

from backend.app.checksheet_report import (
    BLANK, FIXED_COLUMNS, NG, OK, OUT_OF_SPEC, build_checksheet,
)

BLACK = colors.black
WHITE = colors.white
HEADER_FILL = colors.HexColor("#F4F4F5")
GRID_COLOR = colors.HexColor("#3F3F46")

# Fixed column widths (mm): S.NO, Stage, Control Items, Content, Process Capability,
# Checking Methods, Normal Freq, IFM Freq, row-label column (Result / Date / S.No / CHK BY / APP BY)
FIXED_WIDTHS_MM = [8, 14, 30, 50, 15, 17, 14, 14, 12]
MIN_SLOT_MM = 5.6
IMAGES_ON_SHEET = 3


def esc(v) -> str:
    return _esc("" if v is None else str(v))


def _style(name, size=6.5, bold=False, align=0, color=BLACK, leading=None):
    return ParagraphStyle(
        name, fontName="Helvetica-Bold" if bold else "Helvetica", fontSize=size,
        leading=leading or size + 1.6, alignment=align, textColor=color,
    )


S_HEAD = _style("head", 6.5, bold=True, align=1)
S_CELL = _style("cell", 6.5)
S_CELL_B = _style("cellb", 6.5, bold=True)
S_CELL_C = _style("cellc", 6.5, align=1)
S_LABEL = _style("label", 7.5, bold=True)
S_VALUE = _style("value", 7.5)
S_TITLE = _style("title", 12, bold=True, align=1, leading=15)
S_SMALL = _style("small", 6)
S_SECTION = _style("section", 8, bold=True)


class VerticalText(Flowable):
    """Stage label rotated 90 degrees, as written down the merged Stage column of the paper sheet."""

    def __init__(self, text, size=6.8):
        super().__init__()
        self.text = text
        self.size = size

    def wrap(self, avail_w, avail_h):
        self.width = avail_w
        self.height = stringWidth(self.text, "Helvetica-Bold", self.size) + 6
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFont("Helvetica-Bold", self.size)
        c.translate(self.width / 2 + self.size * 0.35, self.height / 2)
        c.rotate(90)
        c.drawCentredString(0, 0, self.text)
        c.restoreState()


class Mark(Flowable):
    """Hand-drawn style check mark / cross as vector paths (renders identically in every PDF viewer)."""

    def __init__(self, kind, size, color=BLACK):
        super().__init__()
        self.kind, self.size, self.color = kind, size, color

    def wrap(self, avail_w, avail_h):
        self.width, self.height = avail_w, self.size + 2
        return self.width, self.height

    def draw(self):
        c = self.canv
        s = self.size
        x0 = (self.width - s) / 2
        c.saveState()
        c.setStrokeColor(self.color)
        c.setLineWidth(max(0.9, s * 0.16))
        c.setLineCap(1)
        c.setLineJoin(1)
        p = c.beginPath()
        if self.kind == "tick":
            p.moveTo(x0 + s * 0.08, 1 + s * 0.50)
            p.lineTo(x0 + s * 0.38, 1 + s * 0.15)
            p.lineTo(x0 + s * 0.95, 1 + s * 0.92)
            c.drawPath(p, stroke=1, fill=0)
        else:
            c.line(x0 + s * 0.15, 1 + s * 0.15, x0 + s * 0.85, 1 + s * 0.85)
            c.line(x0 + s * 0.15, 1 + s * 0.85, x0 + s * 0.85, 1 + s * 0.15)
        c.restoreState()


def _tick(size):
    return Mark("tick", size)


def _cross(size):
    return Mark("cross", size, WHITE)


def _header_block(sheet, total_w):
    side_w = 24 * mm + 62 * mm
    right_w = 20 * mm + 34 * mm
    title_w = total_w - side_w - right_w
    left = [("PART NO.", sheet.part_no), ("PART NAME", sheet.part_name), ("MODEL", sheet.model), ("VENDOR", sheet.vendor)]
    right = [("DATE", sheet.date), ("LOT NO.", sheet.lot_number), ("LOT QTY", sheet.lot_quantity), ("STATUS", sheet.status)]
    title = Paragraph(esc(sheet.title), S_TITLE)
    data = []
    for i in range(4):
        data.append([
            Paragraph(esc(left[i][0]), S_LABEL), Paragraph(esc(left[i][1]) or "-", S_VALUE),
            title if i == 0 else "",
            Paragraph(esc(right[i][0]) + ":", S_LABEL), Paragraph(f"<b>{esc(right[i][1]) or '-'}</b>", S_VALUE),
        ])
    t = Table(data, colWidths=[24 * mm, 62 * mm, title_w, 20 * mm, 34 * mm], rowHeights=[6.2 * mm] * 4)
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 1.4, BLACK),
        ("INNERGRID", (0, 0), (1, -1), 0.6, BLACK),
        ("INNERGRID", (3, 0), (4, -1), 0.6, BLACK),
        ("LINEBEFORE", (2, 0), (2, -1), 1.2, BLACK),
        ("LINEBEFORE", (3, 0), (3, -1), 1.2, BLACK),
        ("SPAN", (2, 0), (2, 3)),
        ("BACKGROUND", (0, 0), (0, -1), HEADER_FILL),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    return t


def _matrix(sheet, slot_idx, total_w):
    """Inspection matrix for the given slice of result columns."""
    fixed_w = [w * mm for w in FIXED_WIDTHS_MM]
    n = len(slot_idx)
    slot_w = (total_w - sum(fixed_w)) / n
    fs = 6.5 if slot_w >= 8 * mm else 5.6
    s_slot = _style("slot", fs, align=1)
    s_slot_hdr = _style("sloth", fs, bold=True, align=1)
    s_oos = _style("oos", fs, bold=True, align=1, color=WHITE)
    n_fixed = len(FIXED_COLUMNS)  # 8
    lab = n_fixed                 # row-label column index
    first_slot = n_fixed + 1

    data, styles = [], []

    # Header rows: Result / Date / S.No
    hdr0 = [Paragraph(esc(h), S_HEAD) for h in FIXED_COLUMNS] + [Paragraph("Result", S_HEAD)]
    hdr0 += [Paragraph(f"<b>{esc(sheet.result_summary)}</b>", _style("res", 7, bold=True, align=1))] + [""] * (n - 1)
    hdr1 = [""] * n_fixed + [Paragraph("Date", S_HEAD)] + [Paragraph(esc(sheet.slot_dates[i]), s_slot) for i in slot_idx]
    hdr2 = [""] * n_fixed + [Paragraph("S.No", S_HEAD)] + [Paragraph(esc(sheet.slot_labels[i]), s_slot_hdr) for i in slot_idx]
    data += [hdr0, hdr1, hdr2]
    for c in range(n_fixed):
        styles.append(("SPAN", (c, 0), (c, 2)))
    styles += [
        ("SPAN", (first_slot, 0), (-1, 0)),
        ("BACKGROUND", (0, 0), (-1, 2), HEADER_FILL),
    ]

    # Body rows
    body_start = len(data)
    for r in sheet.rows:
        rej = ' <font backColor="black" color="white"><b> REJECTED </b></font>' if r.is_rejected else ""
        row = [
            Paragraph(esc(r.serial_no), S_CELL_C),
            None,  # stage, filled after grouping
            Paragraph(f"<b>{esc(r.control_item)}</b>{rej}", S_CELL),
            Paragraph(esc(r.content).replace("\n", "<br/>"), S_CELL),
            Paragraph(esc(r.process_capability), S_CELL_C),
            Paragraph(esc(r.checking_method), S_CELL_C),
            Paragraph(esc(r.normal_frequency), S_CELL_C),
            Paragraph(esc(r.ifm_frequency), S_CELL_C),
            "",
        ]
        ri = len(data)
        styles.append(("SPAN", (n_fixed - 1, ri), (lab, ri)))  # IFM Frequency also covers the label column
        if r.remark is not None:
            row += [Paragraph(esc(r.remark) or "&nbsp;", _style("rem", 7, color=BLACK))] + [""] * (n - 1)
            styles.append(("SPAN", (first_slot, ri), (-1, ri)))
            styles.append(("ALIGN", (first_slot, ri), (-1, ri), "LEFT"))
            styles.append(("LEFTPADDING", (first_slot, ri), (-1, ri), 4))
        else:
            for k, i in enumerate(slot_idx):
                cell = r.cells[i]
                col = first_slot + k
                if cell.state == OK:
                    row.append(_tick(fs))
                elif cell.state == NG:
                    row.append(_cross(fs))
                    styles.append(("BACKGROUND", (col, ri), (col, ri), BLACK))
                elif cell.state == OUT_OF_SPEC:
                    row.append(Paragraph(esc(cell.text), s_oos))
                    styles.append(("BACKGROUND", (col, ri), (col, ri), BLACK))
                elif cell.state == BLANK:
                    row.append("")
                else:
                    row.append(Paragraph(esc(cell.text), s_slot))
        data.append(row)

    # Merge consecutive identical stages (vertical label) and control items.
    rows = sheet.rows
    i = 0
    while i < len(rows):
        j = i
        while j + 1 < len(rows) and rows[j + 1].stage == rows[i].stage:
            j += 1
        top, bottom = body_start + i, body_start + j
        data[top][1] = VerticalText(rows[i].stage) if j > i else Paragraph(f"<b>{esc(rows[i].stage)}</b>", S_CELL_C)
        if j > i:
            styles.append(("SPAN", (1, top), (1, bottom)))
            # merge identical control-item names inside the stage group
            k = i
            while k <= j:
                m = k
                while m + 1 <= j and rows[m + 1].control_item == rows[k].control_item and not rows[k].remark:
                    m += 1
                if m > k:
                    styles.append(("SPAN", (2, body_start + k), (2, body_start + m)))
                k = m + 1
        i = j + 1

    # CHK BY / APP BY
    for label, values in (("CHK BY", sheet.chk_by), ("APP BY", sheet.app_by)):
        ri = len(data)
        data.append([""] * n_fixed + [Paragraph(label, S_HEAD)] +
                    [Paragraph(f"<b>{esc(values[i])}</b>", s_slot) for i in slot_idx])
        styles.append(("SPAN", (0, ri), (n_fixed - 1, ri)))
    styles.append(("BACKGROUND", (lab, len(data) - 2), (lab, len(data) - 1), HEADER_FILL))

    t = Table(data, colWidths=fixed_w + [slot_w] * n, repeatRows=3)
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.45, GRID_COLOR),
        ("BOX", (0, 0), (-1, -1), 1.4, BLACK),
        ("LINEBELOW", (0, 2), (-1, 2), 1.2, BLACK),
        ("LINEABOVE", (0, len(data) - 2), (-1, len(data) - 2), 1.2, BLACK),
        ("LINEBEFORE", (first_slot, 0), (first_slot, -1), 1.2, BLACK),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 1.6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.6),
        ("LEFTPADDING", (first_slot, 0), (-1, -1), 0.5),
        ("RIGHTPADDING", (first_slot, 0), (-1, -1), 0.5),
    ] + styles))
    return t


def _image_flowable(path, max_w, max_h):
    try:
        iw, ih = ImageReader(path).getSize()
        scale = min(max_w / iw, max_h / ih)
        return RLImage(path, width=iw * scale, height=ih * scale)
    except Exception:
        return Paragraph("<i>Image could not be read</i>", S_SMALL)


def _images_grid(images, width, height, per_row):
    if not images:
        return Paragraph("<i>No images attached</i>", _style("noimg", 7, align=1))
    cell_w = width / per_row
    cells = []
    for img in images:
        pic = _image_flowable(img.path, cell_w - 4 * mm, height - 9 * mm) if img.path else \
            Paragraph("<i>Image file missing</i>", S_SMALL)
        cells.append([pic, Paragraph(esc(img.caption), _style("cap", 5.6, align=1))])
    rows = [cells[i:i + per_row] for i in range(0, len(cells), per_row)]
    table_rows = []
    for r in rows:
        r = r + [["", ""]] * (per_row - len(r))
        inner = [Table([[c[0]], [c[1]]], colWidths=[cell_w - 2 * mm]) for c in r]
        table_rows.append(inner)
    t = Table(table_rows, colWidths=[cell_w] * per_row)
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (0, 0), (-1, -1), "CENTER")]))
    return t


def _bottom_block(sheet, total_w):
    left_w = total_w * 0.46
    right_w = total_w - left_w
    notes = Paragraph("<b>Note:</b> " + " ".join(esc(n) for n in sheet.notes), _style("notes", 6))

    sign = [["", Paragraph("<b>Vendor</b>", S_HEAD), Paragraph(f"<b>{esc(sheet.customer)}</b>", S_HEAD)]]
    for s in sheet.signoffs:
        who = f"<b>{esc(s.name)}</b>" + (f"<br/>{esc(s.when)}" if s.when else "")
        sign.append([Paragraph(f"<b>{esc(s.role_label)}</b>", S_LABEL), Paragraph(who, S_VALUE), ""])
    sign_t = Table(sign, colWidths=[left_w * 0.26, left_w * 0.44, left_w * 0.30],
                   rowHeights=[5.5 * mm] + [11 * mm] * len(sheet.signoffs))
    sign_t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.6, BLACK),
        ("BOX", (0, 0), (-1, -1), 1.4, BLACK),
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_FILL),
        ("BACKGROUND", (0, 1), (0, -1), HEADER_FILL),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))

    left = Table([[notes], [Spacer(1, 1.5 * mm)], [sign_t]], colWidths=[left_w])
    left.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))

    img_h = 5.5 * mm + 11 * mm * len(sheet.signoffs) + 8 * mm
    right = _images_grid(sheet.images[:IMAGES_ON_SHEET], right_w - 4 * mm, img_h, IMAGES_ON_SHEET)

    t = Table([[left, right]], colWidths=[left_w, right_w])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (1, 0), (1, 0), 1.4, BLACK),
        ("VALIGN", (1, 0), (1, 0), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (0, 0), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 3 * mm),
    ]))
    return KeepTogether([t])


def _remarks_and_history(sheet, total_w):
    out = []
    if sheet.remarks:
        rem_t = Table([[Paragraph(esc(r), S_VALUE)] for r in sheet.remarks], colWidths=[total_w])
        rem_t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 1, BLACK), ("INNERGRID", (0, 0), (-1, -1), 0.4, GRID_COLOR)]))
        out += [KeepTogether([Paragraph("REMARKS", S_SECTION), Spacer(1, 1 * mm), rem_t]), Spacer(1, 3 * mm)]
    if sheet.history:
        hdr = ["Stage", "Role", "By", "Decision", "Failed Items", "Remarks", "Date / Time"]
        rows = [[Paragraph(h, S_HEAD) for h in hdr]]
        for h in sheet.history:
            rows.append([Paragraph(esc(h[k]), S_CELL) for k in
                         ("stage", "role", "by", "decision", "failed_items", "remarks", "when")])
        widths = [f * total_w for f in (0.10, 0.08, 0.15, 0.10, 0.20, 0.25, 0.12)]
        ht = Table(rows, colWidths=widths, repeatRows=1)
        ht.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.45, GRID_COLOR), ("BOX", (0, 0), (-1, -1), 1, BLACK),
            ("BACKGROUND", (0, 0), (-1, 0), HEADER_FILL), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        out += [KeepTogether([Paragraph("DECISION HISTORY", S_SECTION), Spacer(1, 1 * mm), ht]), Spacer(1, 3 * mm)]
    extra = sheet.images[IMAGES_ON_SHEET:]
    if extra:
        out.append(KeepTogether([Paragraph("PHOTO EVIDENCE (continued)", S_SECTION), Spacer(1, 1 * mm),
                                 _images_grid(extra, total_w, 60 * mm, 4)]))
    return out


def generate_pdf_report(batch, template, cell_responses, decisions, attachments, upload_dir) -> bytes:
    """Generates the IFM checksheet PDF matching the physical reference form."""
    sheet = build_checksheet(batch, template, cell_responses, decisions, attachments, upload_dir)
    n_slots = len(sheet.slot_labels)

    # A4 landscape fits ~20 sample columns legibly; larger sheets use A3 landscape like the paper form.
    pagesize = landscape(A4)
    margin = 8 * mm
    total_w = pagesize[0] - 2 * margin
    per_page = int((total_w - sum(FIXED_WIDTHS_MM) * mm) // (MIN_SLOT_MM * mm))
    if n_slots > per_page:
        pagesize = landscape(A3)
        total_w = pagesize[0] - 2 * margin
        per_page = int((total_w - sum(FIXED_WIDTHS_MM) * mm) // (MIN_SLOT_MM * mm))

    generated = datetime.now().strftime("%d-%m-%Y %H:%M")
    footer = f"{sheet.sheet_id}  |  Lot {sheet.lot_number}  |  {sheet.mode} frequency  |  Generated {generated}"

    def on_page(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 6)
        canvas.drawString(margin, 4.5 * mm, footer)
        canvas.drawRightString(pagesize[0] - margin, 4.5 * mm, f"Page {doc.page}")
        canvas.restoreState()

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=pagesize, leftMargin=margin, rightMargin=margin,
        topMargin=7 * mm, bottomMargin=9 * mm,
        title=f"IFM Checksheet {sheet.sheet_id} {sheet.lot_number}", author="AI-Smart Scan Inspection Management System",
    )

    story = []
    chunks = [list(range(s, min(s + per_page, n_slots))) for s in range(0, n_slots, per_page)]
    for ci, idx in enumerate(chunks):
        if ci:
            story.append(PageBreak())
        story += [_header_block(sheet, total_w), Spacer(1, 2 * mm), _matrix(sheet, idx, total_w)]
    story += [Spacer(1, 3 * mm), _bottom_block(sheet, total_w), Spacer(1, 4 * mm)]
    story += _remarks_and_history(sheet, total_w)

    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return buffer.getvalue()
