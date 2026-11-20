import io
from datetime import datetime
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

def generate_excel_report(batch, template, cell_responses, decisions, attachments) -> bytes:
    """Generates an exact IFM Checksheet Excel (.xlsx) matching physical checksheet layout."""
    wb = Workbook()
    
    # Sheet 1: IFM Checksheet
    ws = wb.active
    ws.title = "IFM Checksheet"
    ws.views.sheetView[0].showGridLines = True

    # Styling constants
    font_title = Font(name="Calibri", size=13, bold=True, color="000000")
    font_subtitle = Font(name="Calibri", size=10, bold=True, color="000000")
    font_header = Font(name="Calibri", size=9, bold=True, color="000000")
    font_regular = Font(name="Calibri", size=8, color="000000")
    font_bold = Font(name="Calibri", size=8, bold=True, color="000000")
    font_fail = Font(name="Calibri", size=8, bold=True, color="FFFFFF")

    fill_header = PatternFill(start_color="F4F4F5", end_color="F4F4F5", fill_type="solid")
    fill_fail = PatternFill(start_color="000000", end_color="000000", fill_type="solid")
    fill_white = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")

    thin_border_side = Side(border_style="thin", color="000000")
    medium_border_side = Side(border_style="medium", color="000000")
    dashed_border_side = Side(border_style="dashed", color="000000")

    border_cell = Border(left=thin_border_side, right=thin_border_side, top=thin_border_side, bottom=thin_border_side)
    border_fail = Border(left=dashed_border_side, right=dashed_border_side, top=dashed_border_side, bottom=dashed_border_side)
    border_thick = Border(left=medium_border_side, right=medium_border_side, top=medium_border_side, bottom=medium_border_side)

    align_center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    align_left = Alignment(horizontal="left", vertical="center", wrap_text=True)

    # 1. Title Block
    ws.merge_cells("A1:U1")
    ws["A1"] = template.document_title or "DAILY INITIAL FLOW MANAGEMENT CONTROL ITEMS MONITORING CHECKSHEET"
    ws["A1"].font = font_title
    ws["A1"].alignment = align_center

    ws.merge_cells("A2:U2")
    ws["A2"] = "(PRODUCT PARAMETER)"
    ws["A2"].font = font_subtitle
    ws["A2"].alignment = align_center

    # 2. Metadata Block
    insp_date = batch.created_at.strftime("%d-%b-%Y") if batch.created_at else datetime.now().strftime("%d-%b-%Y")
    
    meta_rows = [
        [("SHEET ID", template.sheet_id), ("PART NO.", template.part_no or "N/A"), ("PART NAME", template.part_name or "N/A"), ("CATEGORY", template.part_category or "MAIN PART")],
        [("MODEL", template.model_name or "N/A"), ("VENDOR", template.vendor_name or "N/A"), ("CUSTOMER", template.customer_name or "N/A"), ("DATE", insp_date)],
        [("BATCH / LOT NO", batch.lot_number), ("LOT QTY", batch.lot_quantity or "N/A"), ("MODE", f"{batch.inspection_mode} FREQUENCY"), ("STATUS", batch.status.replace("_", " "))]
    ]

    cur_row = 4
    for r_idx, row_data in enumerate(meta_rows):
        col_idx = 1
        for label, val in row_data:
            c1 = ws.cell(row=cur_row, column=col_idx, value=f"{label}:")
            c1.font = font_bold
            c1.border = border_cell
            c1.fill = fill_header

            # Value cell spans 3 columns
            c2 = ws.cell(row=cur_row, column=col_idx + 1, value=str(val))
            c2.font = font_regular
            c2.border = border_cell
            ws.merge_cells(start_row=cur_row, start_column=col_idx + 1, end_row=cur_row, end_column=col_idx + 3)
            
            # Fill borders across merged region
            for m_col in range(col_idx + 1, col_idx + 4):
                ws.cell(row=cur_row, column=m_col).border = border_cell

            col_idx += 4
        cur_row += 1

    cur_row += 1

    # 3. Main Inspection Grid
    cell_map = {}
    checker_map = {}
    for r in cell_responses:
        cell_map[(r.item_id, str(r.column_key))] = r
        if r.checker_initials:
            checker_map[str(r.column_key)] = r.checker_initials

    all_cols = []
    for item in template.control_items:
        cols = item.sample_columns if isinstance(item.sample_columns, list) else []
        for c in cols:
            if c not in all_cols:
                all_cols.append(str(c))
    
    display_cols = all_cols[:15] if len(all_cols) > 15 else all_cols
    if not display_cols:
        display_cols = ["1", "2", "3", "4", "5"]

    headers = ["S.No", "Stage", "Control Items", "Content / Spec Range", "Method", "Freq."] + display_cols
    
    grid_start_row = cur_row
    for c_idx, h in enumerate(headers, start=1):
        c = ws.cell(row=cur_row, column=c_idx, value=h)
        c.font = font_header
        c.fill = fill_header
        c.alignment = align_center
        c.border = border_thick

    cur_row += 1

    for item in template.control_items:
        freq = item.ifm_frequency if batch.inspection_mode == "IFM" else item.normal_frequency
        
        c_sno = ws.cell(row=cur_row, column=1, value=item.serial_no)
        c_sno.alignment = align_center
        c_sno.border = border_cell
        c_sno.font = font_regular

        c_stage = ws.cell(row=cur_row, column=2, value=item.stage_name)
        c_stage.alignment = align_left
        c_stage.border = border_cell
        c_stage.font = font_regular

        c_item = ws.cell(row=cur_row, column=3, value=item.control_item_name)
        c_item.alignment = align_left
        c_item.border = border_cell
        c_item.font = font_bold

        c_spec = ws.cell(row=cur_row, column=4, value=item.specification_content)
        c_spec.alignment = align_left
        c_spec.border = border_cell
        c_spec.font = font_regular

        c_meth = ws.cell(row=cur_row, column=5, value=item.application_method or "-")
        c_meth.alignment = align_center
        c_meth.border = border_cell
        c_meth.font = font_regular

        c_freq = ws.cell(row=cur_row, column=6, value=freq or "-")
        c_freq.alignment = align_center
        c_freq.border = border_cell
        c_freq.font = font_regular

        for c_offset, col in enumerate(display_cols):
            cell_idx = 7 + c_offset
            resp = cell_map.get((item.item_id, str(col)))
            val = resp.cell_value if resp else ""
            c_val = ws.cell(row=cur_row, column=cell_idx)

            if item.row_mode == "SERIAL_TICKBOX":
                if val in ["true", "True", "1", "checked", "OK"]:
                    c_val.value = "☑"
                elif val in ["false", "False", "0", "FAIL"]:
                    c_val.value = "FAIL"
                else:
                    c_val.value = "-"
            else:
                c_val.value = str(val) if val else "-"

            if resp and not resp.is_within_spec:
                c_val.font = font_fail
                c_val.fill = fill_fail
                c_val.border = border_fail
            else:
                c_val.font = font_regular
                c_val.border = border_cell

            c_val.alignment = align_center

        cur_row += 1

    # Checker row
    c_chk_lbl = ws.cell(row=cur_row, column=1, value="CHK")
    c_chk_lbl.font = font_bold
    c_chk_lbl.alignment = align_center
    c_chk_lbl.border = border_cell
    c_chk_lbl.fill = fill_header

    c_chk_t = ws.cell(row=cur_row, column=2, value="Checker Initials")
    c_chk_t.font = font_bold
    c_chk_t.border = border_cell
    c_chk_t.fill = fill_header

    for i in range(3, 7):
        c_bl = ws.cell(row=cur_row, column=i, value="")
        c_bl.border = border_cell
        c_bl.fill = fill_header

    for c_offset, col in enumerate(display_cols):
        cell_idx = 7 + c_offset
        c_init = ws.cell(row=cur_row, column=cell_idx, value=checker_map.get(str(col), ""))
        c_init.font = font_bold
        c_init.alignment = align_center
        c_init.border = border_cell
        c_init.fill = fill_header

    cur_row += 2

    # 4. Sign-Off Footer
    prep_by = batch.prepared_user.full_name if batch.prepared_user else "Pending"
    chk_by = batch.checked_user.full_name if batch.checked_user else "Pending"
    app_by = batch.approved_user.full_name if batch.approved_user else "Pending"

    ws.merge_cells(start_row=cur_row, start_column=1, end_row=cur_row, end_column=5)
    ws.cell(row=cur_row, column=1, value="PREPARED BY (Operator)").font = font_bold
    ws.cell(row=cur_row, column=1).fill = fill_header
    ws.cell(row=cur_row, column=1).alignment = align_center
    ws.cell(row=cur_row, column=1).border = border_thick

    ws.merge_cells(start_row=cur_row, start_column=6, end_row=cur_row, end_column=10)
    ws.cell(row=cur_row, column=6, value="CHECKED BY (Supervisor)").font = font_bold
    ws.cell(row=cur_row, column=6).fill = fill_header
    ws.cell(row=cur_row, column=6).alignment = align_center
    ws.cell(row=cur_row, column=6).border = border_thick

    ws.merge_cells(start_row=cur_row, start_column=11, end_row=cur_row, end_column=15)
    ws.cell(row=cur_row, column=11, value="APPROVED BY (Admin / QA)").font = font_bold
    ws.cell(row=cur_row, column=11).fill = fill_header
    ws.cell(row=cur_row, column=11).alignment = align_center
    ws.cell(row=cur_row, column=11).border = border_thick

    cur_row += 1
    ws.merge_cells(start_row=cur_row, start_column=1, end_row=cur_row, end_column=5)
    ws.cell(row=cur_row, column=1, value=f"{prep_by}").font = font_regular
    ws.cell(row=cur_row, column=1).alignment = align_center
    ws.cell(row=cur_row, column=1).border = border_cell

    ws.merge_cells(start_row=cur_row, start_column=6, end_row=cur_row, end_column=10)
    ws.cell(row=cur_row, column=6, value=f"{chk_by}").font = font_regular
    ws.cell(row=cur_row, column=6).alignment = align_center
    ws.cell(row=cur_row, column=6).border = border_cell

    ws.merge_cells(start_row=cur_row, start_column=11, end_row=cur_row, end_column=15)
    ws.cell(row=cur_row, column=11, value=f"{app_by}").font = font_regular
    ws.cell(row=cur_row, column=11).alignment = align_center
    ws.cell(row=cur_row, column=11).border = border_cell

    # Set column widths nicely
    ws.column_dimensions["A"].width = 7
    ws.column_dimensions["B"].width = 18
    ws.column_dimensions["C"].width = 28
    ws.column_dimensions["D"].width = 30
    ws.column_dimensions["E"].width = 15
    ws.column_dimensions["F"].width = 12
    for c_idx in range(7, 7 + len(display_cols)):
        ws.column_dimensions[get_column_letter(c_idx)].width = 7

    # Sheet 2: Decisions & Evidence Tab
    ws2 = wb.create_sheet(title="Decisions & Evidence")
    ws2.views.sheetView[0].showGridLines = True
    ws2["A1"] = "INSPECTION DECISIONS & AUDIT LOG"
    ws2["A1"].font = font_title
    
    headers2 = ["Decision ID", "Role", "Decision", "Rejected Item IDs", "Remarks", "Hold Reason", "Timestamp"]
    for c_idx, h in enumerate(headers2, start=1):
        c = ws2.cell(row=3, column=c_idx, value=h)
        c.font = font_header
        c.fill = fill_header
        c.border = border_thick

    r_idx = 4
    for d in decisions:
        ws2.cell(row=r_idx, column=1, value=d.decision_id).border = border_cell
        ws2.cell(row=r_idx, column=2, value=d.role).border = border_cell
        ws2.cell(row=r_idx, column=3, value=d.decision).border = border_cell
        ws2.cell(row=r_idx, column=4, value=str(d.rejected_item_ids or "")).border = border_cell
        ws2.cell(row=r_idx, column=5, value=d.remarks or "").border = border_cell
        ws2.cell(row=r_idx, column=6, value=batch.hold_reason or "").border = border_cell
        ws2.cell(row=r_idx, column=7, value=d.decided_at.strftime("%Y-%m-%d %H:%M:%S") if d.decided_at else "").border = border_cell
        r_idx += 1

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
