"""The overall (final) bad count is one rule shared by the dashboard and the lot report."""
from backend.app.supervisor_workspace import final_bad_count

OK = {"r": "OK", "ng": []}


def ng(disp=None):
    return {"r": "NG", "ng": [{"id": "c1"}], "disp": disp}


def test_operator_bad_items_stay_bad_unless_approved():
    parts = [ng(), ng("Approved"), ng("Rejected"), ng("On hold"), OK]
    assert final_bad_count(parts, {}) == 3  # the approved one is now good


def test_items_the_supervisor_found_bad_count_until_approved():
    parts = [OK, OK, OK, OK]
    svd = {
        "0": {"ng": ["c1"], "d": None},          # found bad, undecided: bad
        "1": {"ng": ["c1"], "d": "Rejected"},    # bad
        "2": {"ng": ["c1"], "d": "Approved"},    # changed back to good
        "3": {"ng": [], "d": None},              # an answer entry with no problems
    }
    assert final_bad_count(parts, {}, svd) == 2


def test_older_spot_check_problems_still_count_once():
    parts = [OK, OK, OK]
    spot = {"0": {"r": "NG"}, "1": {"r": "OK"}, "2": {"r": "NG"}}
    assert final_bad_count(parts, spot) == 2
    # an item already counted from the supervisor's answers is not counted again through its spot entry
    svd = {"0": {"ng": ["c1"], "d": None}}
    assert final_bad_count(parts, spot, svd) == 2


def test_mixed_lot():
    parts = [ng("Approved"), ng("Rejected"), OK, OK, None]
    svd = {"2": {"ng": ["c1"], "d": "On hold"}}
    spot = {"3": {"r": "NG"}}
    assert final_bad_count(parts, spot, svd) == 3  # rejected + on-hold found-bad + older spot problem


def test_no_problems_means_zero():
    assert final_bad_count([OK, OK], {}) == 0
    assert final_bad_count([], {}, {}) == 0
