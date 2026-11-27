"""Template API: persistence, in-place updates that protect inspection history, and validation."""
import copy
import uuid

import pytest


def row(name, kind="pf", role="operator", **over):
    """A template row payload, built the way the Templates screen builds it."""
    base = {
        "serial_no": 0, "display_order": 0, "stage_name": "Appearance", "control_item_name": name,
        "specification_content": "", "application_method": "Visual",
        "normal_frequency": "100%", "ifm_frequency": "200%",
        "assigned_role": role, "is_supervisor_checkpoint": False,
        "visible_to_operator": True, "editable_by_operator": True, "visible_to_supervisor": True,
        "is_required": True, "min_val": None, "max_val": None, "unit": None,
    }
    if kind == "numeric":
        base.update(row_mode="NUMERIC_SAMPLE", html_input_type="number", sample_columns=["S1", "S2", "S3"])
    elif kind == "yesno":
        base.update(row_mode="SERIAL_TICKBOX", html_input_type="checkbox", sample_columns=["1", "2", "3"])
    else:
        base.update(row_mode="SERIAL_TICKBOX", html_input_type="pf", sample_columns=["1", "2", "3"])
    base.update(over)
    return base


def sheet_body(items, sheet_id=None, **over):
    sid = sheet_id or f"T-{uuid.uuid4().hex[:10]}"
    body = {"sheet_id": sid, "document_title": f"Test {sid}", "part_no": f"PN-{sid}", "part_category": "MAIN PART",
            "control_items": items}
    body.update(over)
    return body


@pytest.fixture
def make_sheet(client, admin):
    def _make(items, **over):
        body = sheet_body(items, **over)
        r = client.post("/api/admin/sheets", json=body, headers=admin)
        assert r.status_code == 200, r.text
        return r.json()
    return _make


def renumber(items):
    """The Templates screen numbers rows by their position in the list before saving."""
    return [{**it, "serial_no": i + 1, "display_order": i + 1} for i, it in enumerate(items)]


def put(client, admin, sheet, items, **over):
    body = {k: sheet[k] for k in ("sheet_id", "document_title", "part_no", "part_name", "model_name",
                                  "vendor_name", "customer_name", "part_category")}
    body.update(over)
    body["control_items"] = items
    return client.put(f"/api/admin/sheets/{sheet['sheet_id']}", json=body, headers=admin)


def as_payload(item, **over):
    """An existing row sent back, as the Templates screen does (keeps item_id)."""
    drop = {"sheet_id"}
    out = {k: v for k, v in item.items() if k not in drop}
    out.update(over)
    return out


def record_cells(client, operator, admin, sheet, values):
    """Creates a batch and saves operator cells. values: list of (item, column, value)."""
    b = client.post("/api/admin/batches", json={"sheet_id": sheet["sheet_id"], "lot_number": f"L-{uuid.uuid4().hex[:6]}",
                                                "lot_quantity": 3}, headers=admin)
    assert b.status_code == 200, b.text
    bid = b.json()["batch_id"]
    for item, col, val in values:
        r = client.patch(f"/api/batches/{bid}/cell", json={"item_id": item["item_id"], "column_key": col, "cell_value": val},
                         headers=operator)
        assert r.status_code == 200, r.text
    return bid


def cells_of(client, admin, bid):
    r = client.get(f"/api/batches/{bid}", headers=admin)
    assert r.status_code == 200
    return sorted((c["item_id"], c["column_key"], c["cell_value"]) for c in r.json()["cell_responses"])


# ── Proposal B: unit and is_supervisor_checkpoint persist ─────────────────────────────────────────

def test_create_persists_unit_and_checkpoint(client, admin, make_sheet):
    sheet = make_sheet([row("Length", "numeric", unit="mm", min_val=1, max_val=2),
                        row("Label", "yesno", is_supervisor_checkpoint=True)])
    got = client.get(f"/api/admin/sheets/{sheet['sheet_id']}", headers=admin).json()
    by = {i["control_item_name"]: i for i in got["control_items"]}
    assert by["Length"]["unit"] == "mm"
    assert by["Label"]["is_supervisor_checkpoint"] is True
    assert by["Length"]["is_supervisor_checkpoint"] is False
    listed = next(s for s in client.get("/api/admin/sheets", headers=admin).json() if s["sheet_id"] == sheet["sheet_id"])
    assert {i["control_item_name"]: i["unit"] for i in listed["control_items"]}["Length"] == "mm"


def test_update_persists_unit_and_checkpoint(client, admin, make_sheet):
    sheet = make_sheet([row("Length", "numeric", unit="mm", min_val=1, max_val=2), row("Label", "yesno")])
    items = [as_payload(i) for i in sheet["control_items"]]
    items[0]["unit"] = "cm"
    items[1]["is_supervisor_checkpoint"] = True
    r = put(client, admin, sheet, items)
    assert r.status_code == 200, r.text
    by = {i["control_item_name"]: i for i in r.json()["control_items"]}
    assert by["Length"]["unit"] == "cm" and by["Label"]["is_supervisor_checkpoint"] is True
    items[0]["unit"] = ""  # clearing the unit stores no unit
    assert {i["control_item_name"]: i for i in put(client, admin, sheet, items).json()["control_items"]}["Length"]["unit"] is None


# ── Proposal A: updates are in place and protect inspection history ───────────────────────────────

def test_edit_keeps_item_ids_and_recorded_values(client, admin, operator, make_sheet):
    sheet = make_sheet([row("Label", "yesno"), row("Crack", "pf"), row("Length", "numeric", min_val=10, max_val=12, unit="mm")])
    a, b, c = sheet["control_items"]
    ids_before = [a["item_id"], b["item_id"], c["item_id"]]
    bid = record_cells(client, operator, admin, sheet, [(a, "1", "Pass"), (b, "2", "Fail"), (c, "S1", "11.5"), (c, "S2", "13")])
    before = cells_of(client, admin, bid)
    assert len(before) == 4

    # Rename, change limits, reorder (Length first), add a sample to Length, and add a brand-new row.
    items = [
        as_payload(c, control_item_name="Pipe length", min_val=9.5, max_val=12.5, sample_columns=["S1", "S2", "S3", "S4"]),
        as_payload(a, control_item_name="Label present"),
        as_payload(b),
        row("Brand new", "pf"),
    ]
    r = put(client, admin, sheet, renumber(items))
    assert r.status_code == 200, r.text
    after = r.json()["control_items"]

    assert [i["item_id"] for i in after[:3]] == [c["item_id"], a["item_id"], b["item_id"]], "reorder keeps ids"
    assert sorted(ids_before) == sorted(i["item_id"] for i in after if i["item_id"] in ids_before), "no id changed"
    new_row = after[3]
    assert new_row["control_item_name"] == "Brand new" and new_row["item_id"] not in ids_before
    assert [i["serial_no"] for i in after] == [1, 2, 3, 4]
    assert after[0]["control_item_name"] == "Pipe length" and after[0]["min_val"] == 9.5
    assert after[0]["sample_columns"] == ["S1", "S2", "S3", "S4"]

    assert cells_of(client, admin, bid) == before, "every recorded value is still there, unchanged"

    # Saving again (with the ids the server now returned) is stable too.
    r2 = put(client, admin, sheet, [as_payload(i) for i in after])
    assert r2.status_code == 200
    assert [i["item_id"] for i in r2.json()["control_items"]] == [i["item_id"] for i in after]
    assert cells_of(client, admin, bid) == before


def test_delete_row_without_data_is_allowed(client, admin, make_sheet):
    sheet = make_sheet([row("Keep", "pf"), row("Drop", "pf")])
    keep, _drop = sheet["control_items"]
    r = put(client, admin, sheet, [as_payload(keep)])
    assert r.status_code == 200
    assert [i["control_item_name"] for i in r.json()["control_items"]] == ["Keep"]


def test_delete_row_with_recorded_data_is_blocked(client, admin, operator, make_sheet):
    sheet = make_sheet([row("Keep", "pf"), row("Used", "pf")])
    keep, used = sheet["control_items"]
    bid = record_cells(client, operator, admin, sheet, [(used, "1", "Pass")])
    before = cells_of(client, admin, bid)

    r = put(client, admin, sheet, [as_payload(keep)])
    assert r.status_code == 409, r.text
    assert "'Used'" in r.json()["detail"]["message"] and "can't be deleted" in r.json()["detail"]["message"]

    still = client.get(f"/api/admin/sheets/{sheet['sheet_id']}", headers=admin).json()["control_items"]
    assert {i["control_item_name"] for i in still} == {"Keep", "Used"}, "nothing was changed"
    assert cells_of(client, admin, bid) == before


def test_row_with_data_cannot_change_type_role_or_lose_recorded_samples(client, admin, operator, make_sheet):
    sheet = make_sheet([row("Reading", "numeric", min_val=1, max_val=5)])
    (only,) = sheet["control_items"]
    bid = record_cells(client, operator, admin, sheet, [(only, "S2", "3")])
    before = cells_of(client, admin, bid)

    for label, changed, field in (
        ("type", as_payload(only, row_mode="SERIAL_TICKBOX", html_input_type="pf", min_val=None, max_val=None,
                            sample_columns=["S1", "S2", "S3"]), "html_input_type"),
        ("role", as_payload(only, assigned_role="supervisor"), "assigned_role"),
        ("samples", as_payload(only, sample_columns=["S1"]), "sample_columns"),
    ):
        r = put(client, admin, sheet, [changed])
        assert r.status_code == 409, f"{label}: {r.text}"
        assert any(e["item_id"] == only["item_id"] and e["field"] == field for e in r.json()["detail"]["errors"]), label

    # Safe edits are fine: more samples, new limits, new name.
    r = put(client, admin, sheet, [as_payload(only, sample_columns=["S1", "S2", "S3", "S4"], max_val=6, control_item_name="Renamed")])
    assert r.status_code == 200, r.text
    assert cells_of(client, admin, bid) == before


def test_legacy_client_without_item_ids_never_loses_data(client, admin, operator, make_sheet):
    # No history: a full replacement (the old behaviour) still works.
    plain = make_sheet([row("A", "pf")])
    assert put(client, admin, plain, [row("B", "pf")]).status_code == 200

    # With history: the same legacy payload is refused instead of silently wiping the values.
    used = make_sheet([row("A", "pf")])
    (a,) = used["control_items"]
    bid = record_cells(client, operator, admin, used, [(a, "1", "Pass")])
    before = cells_of(client, admin, bid)
    r = put(client, admin, used, [row("A", "pf")])
    assert r.status_code == 409
    assert cells_of(client, admin, bid) == before


def test_foreign_or_unknown_item_id_is_rejected(client, admin, make_sheet):
    one = make_sheet([row("One", "pf")])
    other = make_sheet([row("Other", "pf")])
    foreign = as_payload(other["control_items"][0])
    r = put(client, admin, one, [foreign])
    assert r.status_code == 409
    assert client.get(f"/api/admin/sheets/{other['sheet_id']}", headers=admin).json()["control_items"][0]["control_item_name"] == "Other"


def test_duplicate_item_id_in_payload_is_rejected(client, admin, make_sheet):
    sheet = make_sheet([row("One", "pf")])
    item = as_payload(sheet["control_items"][0])
    r = put(client, admin, sheet, [item, copy.deepcopy(item)])
    assert r.status_code == 422


# ── Proposal D: server-side validation ────────────────────────────────────────────────────────────

def errors_of(response):
    """(path after 'body', message) pairs from a FastAPI 422."""
    assert response.status_code == 422, response.text
    return [(tuple(e["loc"][1:]), e["msg"]) for e in response.json()["detail"]]


@pytest.mark.parametrize("patch,field,fragment", [
    ({"control_item_name": "   "}, "control_item_name", "must not be empty"),
    ({"stage_name": ""}, "stage_name", "must not be empty"),
    ({"html_input_type": "slider"}, "html_input_type", "unsupported input type"),
    ({"row_mode": "WEIRD"}, "row_mode", "unsupported row mode"),
    ({"assigned_role": "boss"}, "assigned_role", "unsupported role"),
    ({"sample_columns": []}, "sample_columns", "at least 1 sample"),
    ({"sample_columns": [str(i) for i in range(1, 52)]}, "sample_columns", "at most 50"),
    ({"sample_columns": ["1", "1"]}, "sample_columns", "unique"),
    ({"sample_columns": ["1", " "]}, "sample_columns", "must not be empty"),
    ({"unit": "x" * 31}, "unit", "30 characters"),
    ({"control_item_name": "n" * 256}, "control_item_name", "255 characters"),
])
def test_create_rejects_invalid_rows(client, admin, patch, field, fragment):
    bad = row("Valid", "pf", **patch)
    r = client.post("/api/admin/sheets", json=sheet_body([row("Fine", "pf"), bad]), headers=admin)
    errs = errors_of(r)
    assert any(path == ("control_items", 1, field) and fragment in msg for path, msg in errs), errs


def test_min_must_be_below_max_and_numbers_must_be_valid(client, admin):
    r = client.post("/api/admin/sheets", json=sheet_body([row("L", "numeric", min_val=5, max_val=5)]), headers=admin)
    assert any(path == ("control_items", 0, "max_val") and "greater than the minimum" in msg for path, msg in errors_of(r))
    r = client.post("/api/admin/sheets", json=sheet_body([row("L", "numeric", min_val=9, max_val=2)]), headers=admin)
    assert any(path == ("control_items", 0, "max_val") for path, _ in errors_of(r))
    r = client.post("/api/admin/sheets", json=sheet_body([row("L", "numeric", min_val="abc")]), headers=admin)
    assert any(path == ("control_items", 0, "min_val") for path, _ in errors_of(r))
    r = client.post("/api/admin/sheets", content='{"x":NaN}', headers={**admin, "Content-Type": "application/json"})
    assert r.status_code == 422
    body = sheet_body([row("L", "numeric")])
    raw = __import__("json").dumps(body).replace('"min_val": null', '"min_val": NaN', 1)
    r = client.post("/api/admin/sheets", content=raw, headers={**admin, "Content-Type": "application/json"})
    assert any(path == ("control_items", 0, "min_val") for path, _ in errors_of(r))


def test_sheet_level_validation(client, admin):
    def post(**over):
        return client.post("/api/admin/sheets", json=sheet_body([row("A", "pf")], **over), headers=admin)

    assert any(p == ("document_title",) for p, _ in errors_of(post(document_title="  ")))
    assert any(p == ("part_category",) for p, _ in errors_of(post(part_category="OTHER")))
    assert any(p == ("part_no",) for p, _ in errors_of(post(part_no="p" * 101)))
    assert any(p == ("sheet_id",) for p, _ in errors_of(post(sheet_id="has space")))
    assert any(p == ("sheet_id",) for p, _ in errors_of(post(sheet_id="x" * 65)))
    assert any(p == ("sheet_id",) for p, _ in errors_of(post(sheet_id="   ")))


def test_malformed_payloads(client, admin):
    assert client.post("/api/admin/sheets", json={}, headers=admin).status_code == 422
    assert client.post("/api/admin/sheets", json=sheet_body("not a list"), headers=admin).status_code == 422
    assert client.post("/api/admin/sheets", json=sheet_body([5]), headers=admin).status_code == 422
    r = client.post("/api/admin/sheets", json=sheet_body([{"control_item_name": "only a name"}]), headers=admin)
    paths = [p for p, _ in errors_of(r)]
    assert ("control_items", 0, "stage_name") in paths and ("control_items", 0, "specification_content") in paths
    assert client.post("/api/admin/sheets", content="{not json", headers={**admin, "Content-Type": "application/json"}).status_code == 422


def test_update_validation_and_sheet_id_mismatch(client, admin, make_sheet):
    sheet = make_sheet([row("A", "numeric", min_val=1, max_val=2)])
    item = as_payload(sheet["control_items"][0])
    r = put(client, admin, sheet, [{**item, "min_val": 3, "max_val": 1}])
    assert any(p == ("control_items", 0, "max_val") for p, _ in errors_of(r))
    r = put(client, admin, sheet, [item], sheet_id="SOMETHING-ELSE")
    assert any(p == ("sheet_id",) for p, _ in errors_of(r))
    # nothing changed
    got = client.get(f"/api/admin/sheets/{sheet['sheet_id']}", headers=admin).json()["control_items"][0]
    assert got["min_val"] == 1 and got["max_val"] == 2


def test_validation_does_not_block_reading_or_resaving_legacy_rows(client, admin, make_sheet):
    # A text-style row with no sample columns is allowed (only tick / numeric rows need samples).
    sheet = make_sheet([row("Note", "pf", row_mode="STANDARD_INPUT", html_input_type="text", sample_columns=[])])
    assert put(client, admin, sheet, [as_payload(sheet["control_items"][0])]).status_code == 200


def test_duplicate_part_number_still_rejected(client, admin, make_sheet):
    first = make_sheet([row("A", "pf")])
    r = client.post("/api/admin/sheets", json=sheet_body([row("A", "pf")], part_no=first["part_no"]), headers=admin)
    assert r.status_code == 400 and "already linked" in r.json()["detail"]


# ── Permissions ───────────────────────────────────────────────────────────────────────────────────

def test_only_admin_can_write_templates(client, operator, supervisor, make_sheet, admin):
    sheet = make_sheet([row("A", "pf")])
    for headers in (operator, supervisor):
        assert client.post("/api/admin/sheets", json=sheet_body([row("A", "pf")]), headers=headers).status_code == 403
        assert put(client, headers, sheet, [row("A", "pf")]).status_code == 403
    assert client.post("/api/admin/sheets", json=sheet_body([row("A", "pf")])).status_code == 401


# ── Other screens still read what the Templates screen saves ──────────────────────────────────────

def test_supervisor_and_operator_screens_read_saved_template(client, admin, operator, supervisor, make_sheet):
    sheet = make_sheet([
        row("Label", "yesno"), row("Pipe length", "numeric", min_val=10, max_val=12, unit="mm"),
        row("Wall", "numeric", role="supervisor", min_val=1, max_val=2.5, unit="mm", sample_columns=["S1", "S2"]),
        row("Condition", "pf", role="supervisor", sample_columns=["1", "2", "3", "4"]),
    ])
    items = {i["control_item_name"]: i for i in sheet["control_items"]}
    bid = record_cells(client, operator, admin, sheet, [(items["Label"], "1", "Pass"), (items["Pipe length"], "S1", "13")])

    # the operator can't write supervisor rows, and the out-of-spec flag uses the template's limits
    r = client.patch(f"/api/batches/{bid}/cell", json={"item_id": items["Wall"]["item_id"], "column_key": "S1", "cell_value": "1.5"}, headers=operator)
    assert r.status_code == 403
    detail = client.get(f"/api/batches/{bid}", headers=admin).json()
    flagged = {(c["item_id"], c["column_key"]): c["is_within_spec"] for c in detail["cell_responses"]}
    assert flagged[(items["Pipe length"]["item_id"], "S1")] is False

    ws = client.get("/api/supervisor/workspace", headers=supervisor).json()["templates"][sheet["sheet_id"]]
    params = {p["t"]: p for p in ws["params"]}
    assert params["Wall"]["editable"] is True and params["Pipe length"]["editable"] is False
    assert params["Wall"]["unit"] == "mm" and params["Wall"]["min"] == 1 and params["Wall"]["max"] == 2.5
    assert params["Wall"]["samples"] == ["S1", "S2"]
    assert [c["t"] for c in ws["supChecks"]] == ["Condition"] and ws["supChecks"][0]["samples"] == ["1", "2", "3", "4"]
    assert [i["t"] for i in ws["items"]] == ["Label"]
