import io
import os
from datetime import datetime
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage, KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, mm

def generate_pdf_report(batch, template, cell_responses, decisions, attachments, upload_dir) -> bytes:
    """Generates an exact IFM Checksheet PDF Report matching the reference document layout."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
    )
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "DocTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=14,
        alignment=1, # Center
        textColor=colors.black
    )
    sub_title_style = ParagraphStyle(
        "SubTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=11,
        alignment=1,
        textColor=colors.black
    )
    cell_bold_style = ParagraphStyle(
        "CellBold",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=8,
        textColor=colors.black
    )
    cell_regular_style = ParagraphStyle(
        "CellRegular",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7,
        leading=8,
        textColor=colors.black
    )
    cell_center_style = ParagraphStyle(
        "CellCenter",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7,
        leading=8,
        alignment=1,
        textColor=colors.black
    )
    cell_fail_style = ParagraphStyle(
        "CellFail",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=8,
        alignment=1,
        textColor=colors.whitesmoke,
        backColor=colors.black
    )

    story = []

    # 1. Header Banner & Metadata Block
    title_p = Paragraph(f"<b>{template.document_title or 'DAILY INITIAL FLOW MANAGEMENT CONTROL ITEMS MONITORING CHECKSHEET'}</b>", title_style)
    sub_p = Paragraph("<b>(PRODUCT PARAMETER)</b>", sub_title_style)
    story.append(title_p)
    story.append(sub_p)
    story.append(Spacer(1, 3 * mm))

    # Metadata Grid
    insp_date = batch.created_at.strftime("%d-%b-%Y") if batch.created_at else datetime.now().strftime("%d-%b-%Y")
    status_label = batch.status.replace("_", " ")

    meta_data = [
        [
            Paragraph(f"<b>SHEET ID:</b> {template.sheet_id}", cell_regular_style),
            Paragraph(f"<b>PART NO.:</b> {template.part_no or 'N/A'}", cell_regular_style),
            Paragraph(f"<b>PART NAME:</b> {template.part_name or 'N/A'}", cell_regular_style),
            Paragraph(f"<b>CATEGORY:</b> {template.part_category or 'MAIN PART'}", cell_regular_style),
        ],
        [
            Paragraph(f"<b>MODEL:</b> {template.model_name or 'N/A'}", cell_regular_style),
            Paragraph(f"<b>VENDOR:</b> {template.vendor_name or 'N/A'}", cell_regular_style),
            Paragraph(f"<b>CUSTOMER:</b> {template.customer_name or 'N/A'}", cell_regular_style),
            Paragraph(f"<b>DATE:</b> {insp_date}", cell_regular_style),
        ],
        [
            Paragraph(f"<b>BATCH / LOT NO:</b> {batch.lot_number}", cell_regular_style),
            Paragraph(f"<b>LOT QUANTITY:</b> {batch.lot_quantity or 'N/A'}", cell_regular_style),
            Paragraph(f"<b>MODE:</b> {batch.inspection_mode} FREQUENCY", cell_regular_style),
            Paragraph(f"<b>STATUS:</b> <b>{status_label}</b>", cell_bold_style),
        ]
    ]

    meta_table = Table(meta_data, colWidths=[65 * mm, 65 * mm, 75 * mm, 62 * mm])
    meta_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1.5, colors.black),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.black),
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#FFFFFF")),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 4 * mm))

    # 2. Main Checksheet Matrix Grid
    # Build lookup map: (item_id, column_key) -> cell_response
    cell_map = {}
    checker_map = {}
    for r in cell_responses:
        cell_map[(r.item_id, str(r.column_key))] = r
        if r.checker_initials:
            checker_map[str(r.column_key)] = r.checker_initials

    # Standard columns max (e.g. 10 or 15 sample columns displayed per section)
    # Collect all unique sample columns across items
    all_cols = []
    for item in template.control_items:
        cols = item.sample_columns if isinstance(item.sample_columns, list) else []
        for c in cols:
            if c not in all_cols:
                all_cols.append(str(c))
    
    # Show first 15 columns if many, or up to 20
    display_cols = all_cols[:15] if len(all_cols) > 15 else all_cols
    if not display_cols:
        display_cols = ["1", "2", "3", "4", "5"]

    # Table Header
    header_row = [
        Paragraph("<b>S.No</b>", cell_center_style),
        Paragraph("<b>Stage</b>", cell_center_style),
        Paragraph("<b>Control Items</b>", cell_center_style),
        Paragraph("<b>Content / Spec Range</b>", cell_center_style),
        Paragraph("<b>Method</b>", cell_center_style),
        Paragraph("<b>Freq.</b>", cell_center_style),
    ]
    for c in display_cols:
        header_row.append(Paragraph(f"<b>{c}</b>", cell_center_style))

    matrix_rows = [header_row]

    for item in template.control_items:
        freq = item.ifm_frequency if batch.inspection_mode == "IFM" else item.normal_frequency
        row = [
            Paragraph(str(item.serial_no), cell_center_style),
            Paragraph(item.stage_name, cell_regular_style),
            Paragraph(item.control_item_name, cell_bold_style),
            Paragraph(item.specification_content, cell_regular_style),
            Paragraph(item.application_method or "-", cell_regular_style),
            Paragraph(freq or "-", cell_center_style),
        ]

        for col in display_cols:
            resp = cell_map.get((item.item_id, str(col)))
            val = resp.cell_value if resp else ""
            
            if item.row_mode == "SERIAL_TICKBOX":
                if val in ["true", "True", "1", "checked", "OK"]:
                    text = "[X]"
                elif val in ["false", "False", "0", "FAIL"]:
                    text = "[FAIL]"
                else:
                    text = "-"
                
                if resp and not resp.is_within_spec:
                    row.append(Paragraph(text, cell_fail_style))
                else:
                    row.append(Paragraph(text, cell_center_style))
            else:
                # Numeric or text
                if resp and not resp.is_within_spec:
                    row.append(Paragraph(f"<b>{val}*</b>", cell_fail_style))
                else:
                    row.append(Paragraph(str(val) if val else "-", cell_center_style))

        matrix_rows.append(row)

    # Checker Initials row
    chk_row = [
        Paragraph("<b>CHK</b>", cell_center_style),
        Paragraph("<b>Checker Initials</b>", cell_bold_style),
        Paragraph("", cell_regular_style),
        Paragraph("", cell_regular_style),
        Paragraph("", cell_regular_style),
        Paragraph("", cell_regular_style),
    ]
    for col in display_cols:
        chk_init = checker_map.get(str(col), "")
        chk_row.append(Paragraph(chk_init, cell_center_style))
    matrix_rows.append(chk_row)

    col_widths = [10 * mm, 25 * mm, 45 * mm, 45 * mm, 22 * mm, 15 * mm]
    rem_width = 267 * mm - sum(col_widths)
    cell_w = max(6 * mm, rem_width / max(1, len(display_cols)))
    final_col_widths = col_widths + [cell_w] * len(display_cols)

    matrix_table = Table(matrix_rows, colWidths=final_col_widths, repeatRows=1)
    matrix_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1.5, colors.black),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.black),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#F4F4F5")),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    story.append(matrix_table)
    story.append(Spacer(1, 4 * mm))

    # 3. Decisions & Sign-Off Footer
    prep_by = batch.prepared_user.full_name if batch.prepared_user else (batch.prepared_user.username if batch.prepared_user else "Pending")
    chk_by = batch.checked_user.full_name if batch.checked_user else (batch.checked_user.username if batch.checked_user else "Pending")
    app_by = batch.approved_user.full_name if batch.approved_user else (batch.approved_user.username if batch.approved_user else "Pending")

    op_time = batch.operator_submitted_at.strftime("%d-%b-%Y %H:%M") if batch.operator_submitted_at else "Not Submitted"
    sp_time = batch.supervisor_submitted_at.strftime("%d-%b-%Y %H:%M") if batch.supervisor_submitted_at else "Not Reviewed"

    sign_data = [
        [
            Paragraph("<b>PREPARED BY (Operator)</b>", cell_bold_style),
            Paragraph("<b>CHECKED BY (Supervisor)</b>", cell_bold_style),
            Paragraph("<b>APPROVED BY (Admin / QA)</b>", cell_bold_style),
        ],
        [
            Paragraph(f"Sign / Name: {prep_by}<br/>Time: {op_time}", cell_regular_style),
            Paragraph(f"Sign / Name: {chk_by}<br/>Time: {sp_time}", cell_regular_style),
            Paragraph(f"Sign / Name: {app_by}", cell_regular_style),
        ]
    ]

    sign_table = Table(sign_data, colWidths=[89 * mm, 89 * mm, 89 * mm])
    sign_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1.5, colors.black),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.black),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#F4F4F5")),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    story.append(sign_table)

    # 4. Appendix: Rejections & Notes (if any)
    if decisions or batch.hold_reason:
        story.append(Spacer(1, 4 * mm))
        story.append(Paragraph("<b>APPENDIX: AUDIT DECISIONS & HOLD REASONS</b>", cell_bold_style))
        dec_rows = [[
            Paragraph("<b>Role</b>", cell_center_style),
            Paragraph("<b>Decision</b>", cell_center_style),
            Paragraph("<b>Failed Items / Remarks</b>", cell_center_style),
            Paragraph("<b>Timestamp</b>", cell_center_style)
        ]]
        for d in decisions:
            items_str = f"Item IDs: {d.rejected_item_ids}" if d.rejected_item_ids else "None"
            rem = f"{items_str} | {d.remarks or ''}".strip(" |")
            ts = d.decided_at.strftime("%d-%b-%Y %H:%M:%S") if d.decided_at else "-"
            dec_rows.append([
                Paragraph(d.role.upper(), cell_center_style),
                Paragraph(d.decision, cell_fail_style if "REJECT" in d.decision else cell_bold_style),
                Paragraph(rem, cell_regular_style),
                Paragraph(ts, cell_center_style),
            ])
        if batch.hold_reason:
            dec_rows.append([
                Paragraph("SUPERVISOR", cell_center_style),
                Paragraph("ON HOLD", cell_fail_style),
                Paragraph(f"Reason: {batch.hold_reason}", cell_regular_style),
                Paragraph("-", cell_center_style)
            ])
        dec_table = Table(dec_rows, colWidths=[30 * mm, 45 * mm, 142 * mm, 50 * mm])
        dec_table.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 1, colors.black),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.black),
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#F4F4F5")),
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ]))
        story.append(dec_table)

    doc.build(story)
    return buffer.getvalue()
