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
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from backend.app.export_pdf import Mark, _style, esc
from backend.app.supervisor_workspace import final_bad_count, reading_status_values, short_name

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
S_TILE = _style("sv_tile", 7.5, color=INK, leading=17)

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


def _pill(text: str, color, bg) -> Table:
    """A small label (prototype .pill) as a one-cell table."""
    w = stringWidth(text, "Helvetica-Bold", S_SMALL.fontSize) + 9  # fit the text, like the screen's pill
    t = Table([[Paragraph(f'<font color="{color.hexval()}"><b>{esc(text)}</b></font>', S_SMALL)]],
              colWidths=[w], hAlign="LEFT")
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), bg), ("TOPPADDING", (0, 0), (-1, -1), 1),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5), ("LEFTPADDING", (0, 0), (-1, -1), 4),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 4)]))
    return t


DEC_PILL = {"Approved": (OK_C, OK_BG), "On hold": (WARN_C, WARN_BG), "Rejected": (NG_C, NG_BG)}
EFFECT = {"Approved": "Changed to good", "Rejected": "Confirmed bad", "On hold": "Held for later decision"}


def _review_changes(lot, parts, bad, spots, spot, title_of, oos, sup_name, width) -> List[Any]:
    """Prototype svReport card "Supervisor review of the operator's work" (admin lot view)."""
    probs = [k for k in spots if spot[str(k)]["r"] == "NG"]
    overturned = sum(1 for k in bad if parts[k].get("disp") == "Approved")
    out: List[Any] = [Spacer(1, 4 * mm)]
    head = Table([[Paragraph("Supervisor review of the operator’s work", S_SEC), Paragraph(esc(sup_name or ""), S_SUB)]],
                 colWidths=[width * 0.7, width * 0.3], hAlign="LEFT")
    head.setStyle(TableStyle([("ALIGN", (1, 0), (1, 0), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                              ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    tiles = [("Bad items reviewed", len(bad), INK), ("Changed to good", overturned, WARN_C if overturned else INK),
             ("Spot checks", len(spots), INK), ("Problems found by supervisor", len(probs), NG_C if probs else INK)]
    tile_tbl = Table([[Paragraph(f'<font size="15" color="{c.hexval()}">{v}</font><br/>'
                                 f'<font size="6.5" color="#677386">{esc(k)}</font>', S_TILE) for k, v, c in tiles]],
                     colWidths=[width / 4] * 4, hAlign="LEFT")
    tile_tbl.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), SURFACE2), ("GRID", (0, 0), (-1, -1), 3, colors.white),
                                  ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    out += [head, Spacer(1, 2 * mm), tile_tbl]

    def label(t):
        return [Spacer(1, 3 * mm), Paragraph(esc(t.upper()), S_TH), Spacer(1, 1 * mm)]

    cols = [25 * mm, width * 0.42, width * 0.2, width - 25 * mm - width * 0.62]
    if bad:
        rows = [[Paragraph(h, S_TH) for h in ("ITEM", "OPERATOR FOUND", "SUPERVISOR DECISION", "EFFECT")]]
        for k in bad:
            q = parts[k]
            d = q.get("disp")
            names = ", ".join(title_of.get(n["id"], n["id"]) for n in q["ng"])
            rows.append([Paragraph(f"<b>Item {k + 1}</b>", S_TXT),
                         Paragraph(f'<font color="{NG_C.hexval()}"><b>Bad</b></font>  {esc(names)}', S_TXT),
                         _pill(d, *DEC_PILL[d]) if d in DEC_PILL else Paragraph("Not decided", S_SMALL),
                         Paragraph(esc(EFFECT.get(d, "")), S_SMALL)])
        t = Table(rows, colWidths=cols, repeatRows=1, hAlign="LEFT")
        t.setStyle(_base_style())
        out += label("Items the operator marked bad") + [t]
    if spots:
        rows = [[Paragraph(h, S_TH) for h in ("ITEM", "OPERATOR RESULT", "SUPERVISOR RESULT", "EFFECT")]]
        for k in spots:
            v = spot[str(k)]
            if v["r"] == "OK":
                res = _pill("Agreed", OK_C, OK_BG)
            else:
                names = ", ".join(title_of.get(x, x) for x in v.get("ng") or [])
                res = Paragraph(f'<font color="{NG_C.hexval()}"><b>Found a problem</b></font>  {esc(names)}', S_TXT)
            rows.append([Paragraph(f"<b>Item {k + 1}</b>", S_TXT), _pill("Good", OK_C, OK_BG), res,
                         Paragraph("No change" if v["r"] == "OK" else "Changed to bad", S_SMALL)])
        t = Table(rows, colWidths=cols, repeatRows=1, hAlign="LEFT")
        t.setStyle(_base_style())
        out += label("Supervisor spot checks") + [t]
    if oos:
        out += label("Out-of-spec readings")
        out.append(Paragraph(f"{len(oos)} reading{'s' if len(oos) > 1 else ''} out of spec. "
                             f"Action: <b>{esc(lot.get('oos') or 'not given yet')}</b>", S_TXT))
    out += label("Supervisor comments")
    out.append(Paragraph(esc(lot["supComment"]).replace("\n", "<br/>"), S_TXT) if lot.get("supComment")
               else Paragraph("No comments.", S_SMALL))
    return out


def _child_card(params, n_samples, width) -> List[Any]:
    """Prototype child-part card: dimensions whose stage name mentions "child"."""
    child = [p for p in params if "child" in (p.get("grp") or "").lower()]
    if not child:
        return []
    grp = child[0]["grp"]
    name = grp.split(",", 1)[1].strip() if grp.lower().startswith("child part,") else grp
    cells = [[Paragraph(esc(p["t"].upper()), S_DT), Paragraph(esc(p.get("spec") or "—"), S_DD)] for p in child]
    rows = [cells[i:i + 3] + [""] * (3 - len(cells[i:i + 3])) for i in range(0, len(cells), 3)]
    t = Table(rows, colWidths=[width / 3] * 3, hAlign="LEFT")
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), SURFACE2), ("GRID", (0, 0), (-1, -1), 3, colors.white),
                           ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    return _section(f"Child part: {name}") + [t, Spacer(1, 1 * mm), Paragraph(
        "A child part is a smaller component used to make the finished part. Its dimensions are measured on the "
        f"same {n_samples} samples.", S_SMALL)]


def generate_supervisor_report_pdf(lot: Dict[str, Any], tpl: Dict[str, Any], reviewer_name: str,
                                   read_only: bool, layout: str = "supervisor") -> bytes:
    """layout="supervisor": the supervisor's download. layout="admin": the admin's lot view of a
    completed lot (prototype admLot -> svReport(L, true)): lot details, the supervisor's review of
    the operator's work, child part, samples, out-of-spec, item grid with content and method, sign-off."""
    admin = layout == "admin"
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
    # Overall (final) bad count after the supervisor's decisions and spot checks (same rule as the dashboard).
    final_bad = final_bad_count(parts, spot)

    # The supervisor's answers where they differ from the operator's ({item index: {"ng": [...]}}).
    svd: Dict[str, Dict[str, Any]] = lot.get("svd") or {}

    def answered_no(k: int) -> set:
        a = svd.get(str(k))
        if a is not None:
            return set(a.get("ng") or [])
        p = parts[k]
        return {n["id"] for n in p["ng"]} if p and p["r"] == "NG" else set()

    def sup_rejected(k: int) -> bool:
        """Marked good by the operator, found bad by the supervisor (a check answered No)."""
        p = parts[k]
        return bool(p and p["r"] == "OK" and (svd.get(str(k)) or {}).get("ng"))

    def found_bad_disp(k: int) -> Optional[str]:
        return (svd.get(str(k)) or {}).get("d")

    # Summary after the supervisor's review (same rules as the preview's supSummary):
    # bad = operator-bad items not approved + good items the supervisor found bad;
    # readings = the supervisor's own: supervisor dimension samples, supervisor checks, spot readings.
    n_bad = sum(1 for k, p in enumerate(parts)
                if (p and p["r"] == "NG" and p.get("disp") != "Approved") or (sup_rejected(k) and found_bad_disp(k) != "Approved"))
    sup_vals: List[Optional[Any]] = []
    for p in params:
        if p.get("editable"):
            vals = dims.get(p["id"]) or []
            sup_vals += [vals[j] if j < len(vals) else None for j in range(len(p["samples"]))]
    for c in sup_checks:
        vals = sup_res.get(c["id"]) or []
        sup_vals += [vals[j] if j < len(vals) else None for j in range(len(c["samples"]))]
    for k in spots:
        if sup_rejected(k):
            continue
        for p in params:
            sv = (dims.get(p["id"]) or [])
            from_sample = k < len(p["samples"]) and (p.get("editable") or (k < len(sv) and sv[k] is not None))
            if not from_sample:
                v = ((spot.get(str(k)) or {}).get("dims") or {}).get(p["id"])
                sup_vals.append(v)
                if reading_status_values(p.get("min"), p.get("max"), v) == "bad":
                    oos.append((p, k, v))
    sup_filled = sum(1 for v in sup_vals if v is not None)

    op = lot.get("op") or {}
    sup = lot.get("sup") or {}
    op_name = short_name((op.get("by") or {}).get("name"))
    sup_name = short_name((sup.get("by") or {}).get("name")) if read_only and sup else short_name(reviewer_name)
    lot_date = _time(lot.get("date")).split(",")[0]

    page = landscape(A4)
    width = page[0] - 20 * mm
    # Each section is built into its own list, then assembled in the order of the chosen layout.
    blocks: Dict[str, List[Any]] = {}
    story = blocks.setdefault("head", [])

    # ---------------- heading + lot details ----------------
    story.append(Paragraph("Lot report" if read_only else "Lot report (preview, not saved yet)", S_TITLE))
    story.append(Paragraph(esc(
        f"Saved by {sup_name}, {_time(sup.get('at'))}." if read_only and sup
        else "Visual results with the supervisor's decisions, and the sample dimensions."), S_SUB))
    story.append(Spacer(1, 3 * mm))

    summary = [("Items", str(n_items), INK), ("Good", str(n_items - n_bad), OK_C),
               ("Bad", str(n_bad), NG_C if n_bad else INK), ("Readings", f"{sup_filled}/{len(sup_vals)}", INK)]
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
    story = blocks.setdefault("samples", [])

    def samples_table(plist: List[Dict[str, Any]], checks: List[Dict[str, Any]]) -> Table:
        """One sample table: the given dimensions, then the given supervisor checks."""
        head = [Paragraph("DIMENSION" if plist else "CHECK", S_TH), Paragraph("SPEC", S_TH)] + \
               [Paragraph(str(j + 1), S_THC) for j in range(n_samples)] + [Paragraph("RESULT", S_TH)]
        rows, style = [head], []
        for p in plist:
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
        if checks and plist:
            rows.append([Paragraph("SUPERVISOR CHECKS", S_TH)] + [""] * (n_samples + 2))
            style += [("SPAN", (0, len(rows) - 1), (-1, len(rows) - 1)), ("BACKGROUND", (0, len(rows) - 1), (-1, len(rows) - 1), SURFACE2)]
        for c in checks:
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
    def methods_of(plist: List[Dict[str, Any]]) -> str:
        return " / ".join(sorted({p.get("method") for p in plist if p.get("method")}))

    if n_samples:
        child = [p for p in params if "child" in (p.get("grp") or "").lower()]
        main = [p for p in params if p not in child]
        if not child:
            # One table.
            story += _section(f"{'Dimension check' if params else 'Supervisor checks'}, samples (items 1 – {n_samples})",
                              methods_of(params))
            story.append(samples_table(params, sup_checks))
        else:
            # Child part's dimensions and the parent (main) part's in separate tables.
            grp = child[0]["grp"]
            child_name = grp.split(",", 1)[1].strip() if grp.lower().startswith("child part,") else ""
            if admin:
                child_title, main_title = "Dimension check (child part)", "Dimension check (parent part)"
            else:
                child_title = f"Child part dimensions{f': {child_name}' if child_name else ''}"
                main_title = "Main part dimensions"
            story += _section(f"{child_title}, samples (items 1 – {n_samples})", methods_of(child))
            story.append(samples_table(child, []))
            if main or sup_checks:
                story.append(Spacer(1, 2 * mm))
                story += _section(f"{main_title if main else 'Supervisor checks'}, samples (items 1 – {n_samples})",
                                  methods_of(main))
                story.append(samples_table(main, sup_checks))


    # ---------------- out of spec ----------------
    story = blocks.setdefault("oos", [])
    if oos:
        lst = "; ".join(f"{p['t']} {_fmt(v)} on item {j + 1}" for p, j, v in oos)
        story += _section(f"{len(oos)} reading{'s' if len(oos) > 1 else ''} out of spec")
        story.append(Paragraph(esc(f"{lst}. Action: {lot.get('oos') or '—'}"), S_TXT))

    # ---------------- bad items + decisions ----------------
    story = blocks.setdefault("bad", [])
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
    story = blocks.setdefault("spot", [])
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
    story = blocks.setdefault("items", [])
    story += _section("Item results", "Tick / cross per check and item. Right columns (blue): supervisor spot checks. "
                      "Decision row: A approved, H on hold, R rejected.")
    # Admin layout: the reference grid's S.No / Control item / Content / Method columns.
    fixed = [9 * mm, 29 * mm, 41 * mm, 17 * mm] if admin else [8 * mm, 46 * mm]
    nf = len(fixed)
    item_w = (width - sum(fixed) - 3 * 7 * mm - 1.5 * mm) / PER
    spot_cols = [spots[j] if j < len(spots) else None for j in range(3)]
    for start in range(0, n_items, PER):
        idx = list(range(start, min(n_items, start + PER)))
        pad = PER - len(idx)
        head = [Paragraph("S.NO", S_THC), Paragraph("CONTROL ITEM", S_TH)] + \
               ([Paragraph("CONTENT", S_TH), Paragraph("METHOD", S_TH)] if admin else []) + \
               [Paragraph(str(i + 1), S_THC) for i in idx] + [""] * pad + [""] + \
               [Paragraph(str(k + 1) if k is not None else "", S_THC) for k in spot_cols]
        rows, style = [head], []
        bar = nf + PER
        for g in groups:
            rows.append([Paragraph(esc(g.upper()), S_TH)] + [""] * (nf + PER + 3))
            r = len(rows) - 1
            style += [("SPAN", (0, r), (bar - 1, r)), ("BACKGROUND", (0, r), (bar - 1, r), SURFACE2)]
            for x in [x for x in items if x["g"] == g]:
                row = [Paragraph(str(items.index(x) + 1), S_C),
                       Paragraph(f"<b>{esc(x['t'])}</b>" if admin else esc(x["t"]), S_TXT)]
                if admin:
                    row += [Paragraph(esc(x.get("desc")), S_SMALL), Paragraph(esc(x.get("method")), S_SMALL)]
                for c, i in enumerate(idx):
                    p = parts[i]
                    if not p:
                        row.append("")
                    else:
                        # The supervisor's answer where changed (outlined), else the operator's.
                        no = x["id"] in answered_no(i)
                        op_no = p["r"] == "NG" and any(n["id"] == x["id"] for n in p["ng"])
                        row.append(Mark("cross", MARK, NG_C) if no else Mark("tick", MARK, OK_C))
                        if no:
                            style.append(("BACKGROUND", (nf + c, len(rows)), (nf + c, len(rows)), NG_BG))
                        if no != op_no:
                            style.append(("BOX", (nf + c, len(rows)), (nf + c, len(rows)), 1, WARN_C))
                row += [""] * pad + [""]
                for k in spot_cols:
                    s = spot.get(str(k)) if k is not None else None
                    row.append("" if not s else Mark("cross", MARK, NG_C) if s["r"] == "NG" and x["id"] in (s.get("ng") or []) else Mark("tick", MARK, OK_C))
                rows.append(row)
        # operator result + supervisor decision rows
        res_row = [Paragraph("<b>Operator result</b>", S_TXT)] + [""] * (nf - 1)
        dec_row = [Paragraph("<b>Supervisor decision</b>", S_TXT)] + [""] * (nf - 1)
        for c, i in enumerate(idx):
            p = parts[i]
            res_row.append("" if not p else Mark("cross", MARK, NG_C) if p["r"] == "NG" else Mark("tick", MARK, OK_C))
            d = p.get("disp") if p and p["r"] == "NG" else found_bad_disp(i) if sup_rejected(i) else None
            dec_row.append(Paragraph(f'<font color="{DEC_COLOR[d].hexval()}"><b>{DEC_LETTER[d]}</b></font>', S_C) if d
                           else Paragraph("—", S_C) if (p and p["r"] == "NG") or sup_rejected(i) else "")
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
        style += [("SPAN", (0, n - 2), (nf - 1, n - 2)), ("SPAN", (0, n - 1), (nf - 1, n - 1)),
                  ("BACKGROUND", (0, n - 2), (-1, n - 1), SURFACE2),
                  ("BACKGROUND", (bar, 0), (bar, -1), INK), ("BACKGROUND", (bar + 1, 0), (-1, n - 3), SPOT_BG),
                  ("LEFTPADDING", (nf, 0), (-1, -1), 0), ("RIGHTPADDING", (nf, 0), (-1, -1), 0)]
        tbl = Table(rows, colWidths=fixed + [item_w] * PER + [1.5 * mm] + [7 * mm] * 3, repeatRows=1, hAlign="LEFT")
        tbl.setStyle(_base_style(style))
        label = Paragraph(f"<b>Items {idx[0] + 1} – {idx[-1] + 1}</b>", S_TXT)
        story += [Spacer(1, 2 * mm), KeepTogether([label, Spacer(1, 1 * mm), tbl])]

    # ---------------- comments + sign-off ----------------
    story = blocks.setdefault("comment", [])
    if lot.get("supComment"):
        story += _section("Supervisor comments")
        story.append(Paragraph(esc(lot["supComment"]).replace("\n", "<br/>"), S_TXT))

    story = blocks.setdefault("sign", [])
    story += _section("Sign-off")
    approved = f"{sup_name}, Supervisor, {_time(sup.get('at'))}" if read_only and sup else f"{sup_name}, Supervisor, on saving"
    sign = Table([[Paragraph("Checked by", S_TH), Paragraph(esc(f"{op_name or '—'}, Operator, {_time(op.get('at'))}"), S_TXT_B)],
                  [Paragraph("Approved by", S_TH), Paragraph(esc(approved), S_TXT_B)]],
                 colWidths=[40 * mm, width - 40 * mm], hAlign="LEFT")
    sign.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                              ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story.append(sign)

    if admin:
        blocks["changes"] = _review_changes(lot, parts, bad, spots, spot, title_of, oos, sup_name, width)
        order = ["head", "changes", "samples", "oos", "items", "sign"]
    else:
        order = ["head", "samples", "oos", "bad", "spot", "items", "comment", "sign"]
    story = [f for name in order for f in blocks.get(name, [])]

    def footer(c, doc):
        c.saveState()
        c.setFont("Helvetica", 6.5)
        c.setFillColor(MUTED)
        part = " ".join(x for x in (sheet.get("part"), sheet.get("partName")) if x)
        c.drawString(10 * mm, 6 * mm, f"{lot.get('code')} lot report" + (f" · {part}" if part else ""))
        c.drawRightString(page[0] - 10 * mm, 6 * mm, f"Page {doc.page}")
        c.restoreState()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=page, leftMargin=10 * mm, rightMargin=10 * mm, topMargin=10 * mm,
                            bottomMargin=12 * mm, title=f"{lot.get('code')} lot report", author=sup_name)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
