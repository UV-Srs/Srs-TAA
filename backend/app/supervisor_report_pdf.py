"""
Supervisor lot report as a PDF: the same content as the supervisor report screen
(frontend/src/supervisor/screens/ReportScreen.tsx, prototype svReport):

    lot details -> sample dimensions and supervisor checks -> out-of-spec readings ->
    bad items with the supervisor's decisions -> spot checks -> item-by-item results
    (30 items per block, spot-check columns on the right) -> comments -> sign-off

Built from the supervisor workspace data (serialize_lot / serialize_template), so the PDF
shows exactly what the supervisor sees, including review state not stored in the checksheet.
"""
import io
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from backend.app.export_pdf import Mark, _style, esc
from backend.app.supervisor_workspace import reading_status_values, short_name

INK = colors.HexColor("#1B2533")
MUTED = colors.HexColor("#677386")
LINE = colors.HexColor("#CDD4DE")
SURFACE2 = colors.HexColor("#EEF1F6")
OK_C = colors.HexColor("#23855A")
OK_BG = colors.HexColor("#E4F3EB")
NG_C = colors.HexColor("#C8463E")
NG_BG = colors.HexColor("#FCEAE8")
WARN_C = colors.HexColor("#A46A0E")
WARN_BG = colors.HexColor("#FCF1DC")
SPOT_BG = colors.HexColor("#E7EFF8")
PRIMARY = colors.HexColor("#2D5B8C")

S_TITLE = _style("sv_title", 14, bold=True, color=INK, leading=17)
S_SUB = _style("sv_sub", 8, color=MUTED)
S_SEC = _style("sv_sec", 9, bold=True, color=INK, leading=12)
S_TXT = _style("sv_txt", 7.5, color=INK)
S_TXT_B = _style("sv_txtb", 7.5, bold=True, color=INK)
S_DT = _style("sv_dt", 6.5, color=MUTED)
S_DD = _style("sv_dd", 8, bold=True, color=INK)
S_TH = _style("sv_th", 6.5, bold=True, color=MUTED)
S_THC = _style("sv_thc", 6, bold=True, color=MUTED, align=1)
S_C = _style("sv_c", 6.5, color=INK, align=1)
S_C_NG = _style("sv_cng", 6.5, bold=True, color=NG_C, align=1)
S_C_WARN = _style("sv_cwarn", 6.5, bold=True, color=WARN_C, align=1)
S_SMALL = _style("sv_small", 6.3, color=MUTED)
S_SUMMARY = _style("sv_summary", 7.5, color=INK, leading=15)

PER = 30  # items per block, as on screen
DEC_LETTER = {"Approved": "A", "On hold": "H", "Rejected": "R"}
DEC_COLOR = {"Approved": OK_C, "On hold": WARN_C, "Rejected": NG_C}
MARK = 6.5


def _time(iso: Optional[str]) -> str:
    """Stored times are UTC ISO strings; show them in the server's local time, like the screen."""
    if not iso:
        return ""
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return iso
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone().strftime("%d %b %Y, %I:%M %p").lstrip("0")


def _fmt(v: Optional[float]) -> str:
    return "" if v is None else f"{v:.2f}"


def _base_style(extra=None):
    cmds = [
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, 0), (-1, 0), SURFACE2),
        ("TOPPADDING", (0, 0), (-1, -1), 2.2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.2),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]
    return TableStyle(cmds + (extra or []))


def _section(title: str, sub: str = "") -> List[Any]:
    out: List[Any] = [Spacer(1, 4 * mm), Paragraph(esc(title), S_SEC)]
    if sub:
        out.append(Paragraph(esc(sub), S_SMALL))
    out.append(Spacer(1, 1.5 * mm))
    return out


def generate_supervisor_report_pdf(lot: Dict[str, Any], tpl: Dict[str, Any], reviewer_name: str,
                                   read_only: bool) -> bytes:
    sheet = tpl.get("sheet") or {}
    items: List[Dict[str, Any]] = tpl.get("items") or []
    groups: List[str] = tpl.get("groups") or []
    params: List[Dict[str, Any]] = tpl.get("params") or []
    sup_checks: List[Dict[str, Any]] = tpl.get("supChecks") or []
    parts: List[Optional[Dict[str, Any]]] = lot.get("parts") or []
    dims: Dict[str, List[Optional[float]]] = lot.get("dims") or {}
    sup_res: Dict[str, List[Optional[str]]] = lot.get("supChecks") or {}
    spot: Dict[str, Dict[str, Any]] = lot.get("spot") or {}
    title_of = {x["id"]: x["t"] for x in items}

    n_items = len(parts)
    bad = [k for k, p in enumerate(parts) if p and p["r"] == "NG"]
    cnt = {"Approved": 0, "On hold": 0, "Rejected": 0}
    for k in bad:
        d = parts[k].get("disp")
        if d in cnt:
            cnt[d] += 1
    n_samples = max([len(p["samples"]) for p in params] + [len(c["samples"]) for c in sup_checks] + [0])
    readings = [(p, j, v) for p in params for j, v in enumerate(dims.get(p["id"]) or [])]
    filled = sum(1 for _, _, v in readings if v is not None)
    oos = [(p, j, v) for p, j, v in readings if reading_status_values(p.get("min"), p.get("max"), v) == "bad"]
    spots = sorted(int(k) for k in spot if str(k).isdigit())

    op = lot.get("op") or {}
    sup = lot.get("sup") or {}
    op_name = short_name((op.get("by") or {}).get("name"))
    sup_name = short_name((sup.get("by") or {}).get("name")) if read_only and sup else short_name(reviewer_name)
    lot_date = _time(lot.get("date")).split(",")[0]

    page = landscape(A4)
    width = page[0] - 20 * mm
    story: List[Any] = []

    # ---------------- heading + lot details ----------------
    story.append(Paragraph("Lot report" if read_only else "Lot report (preview, not saved yet)", S_TITLE))
    story.append(Paragraph(esc(
        f"Saved by {sup_name}, {_time(sup.get('at'))}." if read_only and sup
        else "Visual results with the supervisor's decisions, and the sample dimensions."), S_SUB))
    story.append(Spacer(1, 3 * mm))

    summary = [("Items", str(n_items), INK), ("Good", str(n_items - len(bad)), OK_C),
               ("Bad", str(len(bad)), NG_C if bad else INK), ("Readings", f"{filled}/{len(readings)}", INK)]
    sum_tbl = Table([[Paragraph(f'<font size="13" color="{c.hexval()}">{esc(v)}</font><br/>'
                                f'<font size="6.5" color="#677386">{esc(k)}</font>', S_SUMMARY) for k, v, c in summary]],
                    colWidths=[28 * mm] * 4, hAlign="LEFT")
    sum_tbl.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.4, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
                                 ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))

    meta = [("Part no.", sheet.get("part")), ("Part name", sheet.get("partName")),
            ("Lot barcode", lot.get("code")), ("Lot", f"{lot.get('name') or ''}, {lot_date}".strip(", ")),
            ("Inspected by", op_name), ("Operator clearance", (lot.get("clearance") or {}).get("d")),
            ("Bad item decisions", f"{cnt['Approved']} approved, {cnt['On hold']} on hold, {cnt['Rejected']} rejected"),
            ("Reviewed by", sup_name)]
    cell = lambda k, v: [Paragraph(esc(k.upper()), S_DT), Paragraph(esc(v or "—"), S_DD)]
    meta_rows = [[cell(*meta[i]) for i in range(r, r + 4)] for r in (0, 4)]
    meta_tbl = Table(meta_rows, colWidths=[width / 4] * 4)
    meta_tbl.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), SURFACE2), ("GRID", (0, 0), (-1, -1), 2, colors.white),
                                  ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story += [sum_tbl, Spacer(1, 2.5 * mm), meta_tbl]

    # ---------------- samples: dimensions + supervisor checks ----------------
    if n_samples:
        head = [Paragraph("DIMENSION" if params else "CHECK", S_TH), Paragraph("SPEC", S_TH)] + \
               [Paragraph(str(j + 1), S_THC) for j in range(n_samples)] + [Paragraph("RESULT", S_TH)]
        rows, style = [head], []
        for p in params:
            vals = (dims.get(p["id"]) or []) + [None] * n_samples
            row = [Paragraph(f"<b>{esc(p['t'])}</b>", S_TXT), Paragraph(esc(p.get("spec")), S_SMALL)]
            for j in range(n_samples):
                v = vals[j] if j < len(p["samples"]) else None
                s = reading_status_values(p.get("min"), p.get("max"), v)
                row.append(Paragraph(_fmt(v), S_C_NG if s == "bad" else S_C_WARN if s == "warn" else S_C))
                if s == "bad":
                    style.append(("BACKGROUND", (2 + j, len(rows)), (2 + j, len(rows)), NG_BG))
                elif s == "warn":
                    style.append(("BACKGROUND", (2 + j, len(rows)), (2 + j, len(rows)), WARN_BG))
            own = vals[:len(p["samples"])]
            st = [reading_status_values(p.get("min"), p.get("max"), v) for v in own]
            got = sum(1 for v in own if v is not None)
            res = "Out of spec" if "bad" in st else f"{got}/{len(own)}" if got < len(own) else "Near limit" if "warn" in st else "OK"
            row.append(Paragraph(esc(res), S_C_NG if res == "Out of spec" else S_TXT))
            rows.append(row)
        if sup_checks and params:
            rows.append([Paragraph("SUPERVISOR CHECKS", S_TH)] + [""] * (n_samples + 2))
            style += [("SPAN", (0, len(rows) - 1), (-1, len(rows) - 1)), ("BACKGROUND", (0, len(rows) - 1), (-1, len(rows) - 1), SURFACE2)]
        for c in sup_checks:
            vals = sup_res.get(c["id"]) or []
            row = [Paragraph(f"<b>{esc(c['t'])}</b>", S_TXT), Paragraph(esc(c.get("desc")), S_SMALL)]
            for j in range(n_samples):
                v = vals[j] if j < len(vals) else None
                row.append(Mark("tick", MARK, OK_C) if v == "OK" else Mark("cross", MARK, NG_C) if v == "NG" else "")
                if v == "NG":
                    style.append(("BACKGROUND", (2 + j, len(rows)), (2 + j, len(rows)), NG_BG))
            got = sum(1 for v in vals if v is not None)
            res = "Bad" if "NG" in vals else f"{got}/{len(vals)}" if got < len(vals) else "OK"
            row.append(Paragraph(esc(res), S_C_NG if res == "Bad" else S_TXT))
            rows.append(row)
        sample_w = min(14 * mm, (width - 140 * mm) / n_samples)
        tbl = Table(rows, colWidths=[60 * mm, 50 * mm] + [sample_w] * n_samples + [24 * mm], repeatRows=1, hAlign="LEFT")
        tbl.setStyle(_base_style(style))
        story += _section(f"{'Dimension check' if params else 'Supervisor checks'}, samples (items 1 – {n_samples})",
                          " / ".join(sorted({p.get("method") for p in params if p.get("method")})))
        story.append(tbl)

    # ---------------- out of spec ----------------
    if oos:
        lst = "; ".join(f"{p['t']} {_fmt(v)} on item {j + 1}" for p, j, v in oos)
        story += _section(f"{len(oos)} reading{'s' if len(oos) > 1 else ''} out of spec")
        story.append(Paragraph(esc(f"{lst}. Action: {lot.get('oos') or '—'}"), S_TXT))

    # ---------------- bad items + decisions ----------------
    story += _section(f"Bad items from the operator ({sum(cnt.values())}/{len(bad)} decided)")
    if bad:
        rows = [[Paragraph("ITEM", S_TH), Paragraph("FAILED CHECKS", S_TH), Paragraph("SUPERVISOR DECISION", S_TH)]]
        style = []
        for k in bad:
            p = parts[k]
            d = p.get("disp")
            rows.append([Paragraph(f"<b>Item {k + 1}</b>", S_TXT),
                         Paragraph(esc(", ".join(title_of.get(n["id"], n["id"]) for n in p["ng"])), S_TXT),
                         Paragraph(f'<font color="{DEC_COLOR[d].hexval()}"><b>{esc(d)}</b></font>' if d else "—", S_TXT)])
        tbl = Table(rows, colWidths=[25 * mm, width - 75 * mm, 50 * mm], repeatRows=1, hAlign="LEFT")
        tbl.setStyle(_base_style(style))
        story.append(tbl)
    else:
        story.append(Paragraph("No bad items in this lot.", S_TXT))

    # ---------------- spot checks ----------------
    story += _section(f"Supervisor spot checks ({len(spots)})")
    if spots:
        rows = [[Paragraph("ITEM", S_TH), Paragraph("RESULT", S_TH), Paragraph("PROBLEMS FOUND", S_TH)]]
        for k in spots:
            s = spot[str(k)]
            rows.append([Paragraph(f"<b>Item {k + 1}</b>", S_TXT),
                         Paragraph(f'<font color="{(OK_C if s["r"] == "OK" else NG_C).hexval()}"><b>{"Good" if s["r"] == "OK" else "Bad"}</b></font>', S_TXT),
                         Paragraph(esc(", ".join(title_of.get(x, x) for x in s.get("ng") or []) or "—"), S_TXT)])
        tbl = Table(rows, colWidths=[25 * mm, 25 * mm, width - 50 * mm], repeatRows=1, hAlign="LEFT")
        tbl.setStyle(_base_style())
        story.append(tbl)
    else:
        story.append(Paragraph("No spot checks recorded.", S_TXT))

    # ---------------- item-by-item results ----------------
    story += _section("Item results", "Tick / cross per check and item. Right columns (blue): supervisor spot checks. "
                      "Decision row: A approved, H on hold, R rejected.")
    fixed = [8 * mm, 46 * mm]
    item_w = (width - sum(fixed) - 3 * 7 * mm - 1.5 * mm) / PER
    spot_cols = [spots[j] if j < len(spots) else None for j in range(3)]
    for start in range(0, n_items, PER):
        idx = list(range(start, min(n_items, start + PER)))
        pad = PER - len(idx)
        head = [Paragraph("S.NO", S_THC), Paragraph("CONTROL ITEM", S_TH)] + \
               [Paragraph(str(i + 1), S_THC) for i in idx] + [""] * pad + [""] + \
               [Paragraph(str(k + 1) if k is not None else "", S_THC) for k in spot_cols]
        rows, style = [head], []
        bar = 2 + PER
        for g in groups:
            rows.append([Paragraph(esc(g.upper()), S_TH)] + [""] * (PER + 5))
            r = len(rows) - 1
            style += [("SPAN", (0, r), (bar - 1, r)), ("BACKGROUND", (0, r), (bar - 1, r), SURFACE2)]
            for x in [x for x in items if x["g"] == g]:
                row = [Paragraph(str(items.index(x) + 1), S_C), Paragraph(esc(x["t"]), S_TXT)]
                for c, i in enumerate(idx):
                    p = parts[i]
                    if not p:
                        row.append("")
                    elif p["r"] == "NG" and any(n["id"] == x["id"] for n in p["ng"]):
                        row.append(Mark("cross", MARK, NG_C))
                        style.append(("BACKGROUND", (2 + c, len(rows)), (2 + c, len(rows)), NG_BG))
                    else:
                        row.append(Mark("tick", MARK, OK_C))
                row += [""] * pad + [""]
                for k in spot_cols:
                    s = spot.get(str(k)) if k is not None else None
                    row.append("" if not s else Mark("cross", MARK, NG_C) if s["r"] == "NG" and x["id"] in (s.get("ng") or []) else Mark("tick", MARK, OK_C))
                rows.append(row)
        # operator result + supervisor decision rows
        res_row = [Paragraph("<b>Operator result</b>", S_TXT), ""]
        dec_row = [Paragraph("<b>Supervisor decision</b>", S_TXT), ""]
        for c, i in enumerate(idx):
            p = parts[i]
            res_row.append("" if not p else Mark("cross", MARK, NG_C) if p["r"] == "NG" else Mark("tick", MARK, OK_C))
            d = p.get("disp") if p and p["r"] == "NG" else None
            dec_row.append(Paragraph(f'<font color="{DEC_COLOR[d].hexval()}"><b>{DEC_LETTER[d]}</b></font>', S_C) if d
                           else Paragraph("—", S_C) if p and p["r"] == "NG" else "")
        res_row += [""] * pad + [""]
        dec_row += [""] * pad + [""]
        for k in spot_cols:
            s = spot.get(str(k)) if k is not None else None
            res_row.append("" if not s else Mark("cross", MARK, NG_C) if s["r"] == "NG" else Mark("tick", MARK, OK_C))
            # Spot check verdict, styled like the bad-item decisions: A = agree, good; R = found a problem.
            d = None if not s else "Rejected" if s["r"] == "NG" else "Approved"
            dec_row.append(Paragraph(f'<font color="{DEC_COLOR[d].hexval()}"><b>{DEC_LETTER[d]}</b></font>', S_C) if d else "")
        rows += [res_row, dec_row]
        n = len(rows)
        style += [("SPAN", (0, n - 2), (1, n - 2)), ("SPAN", (0, n - 1), (1, n - 1)),
                  ("BACKGROUND", (0, n - 2), (-1, n - 1), SURFACE2),
                  ("BACKGROUND", (bar, 0), (bar, -1), INK), ("BACKGROUND", (bar + 1, 0), (-1, n - 3), SPOT_BG),
                  ("LEFTPADDING", (2, 0), (-1, -1), 0), ("RIGHTPADDING", (2, 0), (-1, -1), 0)]
        tbl = Table(rows, colWidths=fixed + [item_w] * PER + [1.5 * mm] + [7 * mm] * 3, repeatRows=1, hAlign="LEFT")
        tbl.setStyle(_base_style(style))
        label = Paragraph(f"<b>Items {idx[0] + 1} – {idx[-1] + 1}</b>", S_TXT)
        story += [Spacer(1, 2 * mm), KeepTogether([label, Spacer(1, 1 * mm), tbl])]

    # ---------------- comments + sign-off ----------------
    if lot.get("supComment"):
        story += _section("Supervisor comments")
        story.append(Paragraph(esc(lot["supComment"]).replace("\n", "<br/>"), S_TXT))

    story += _section("Sign-off")
    approved = f"{sup_name}, Supervisor, {_time(sup.get('at'))}" if read_only and sup else f"{sup_name}, Supervisor, on saving"
    sign = Table([[Paragraph("Checked by", S_TH), Paragraph(esc(f"{op_name or '—'}, Operator, {_time(op.get('at'))}"), S_TXT_B)],
                  [Paragraph("Approved by", S_TH), Paragraph(esc(approved), S_TXT_B)]],
                 colWidths=[40 * mm, width - 40 * mm], hAlign="LEFT")
    sign.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                              ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story.append(sign)

    def footer(c, doc):
        c.saveState()
        c.setFont("Helvetica", 6.5)
        c.setFillColor(MUTED)
        c.drawString(10 * mm, 6 * mm, f"{lot.get('code')} lot report · {sheet.get('part') or ''} {sheet.get('partName') or ''}".strip())
        c.drawRightString(page[0] - 10 * mm, 6 * mm, f"Page {doc.page}")
        c.restoreState()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=page, leftMargin=10 * mm, rightMargin=10 * mm, topMargin=10 * mm,
                            bottomMargin=12 * mm, title=f"{lot.get('code')} lot report", author=sup_name)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
