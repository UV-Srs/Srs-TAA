"""
Resolves the Operator / Supervisor / Approver names printed on exported reports
(PDF, Excel, CSV). Uses the batch sign-off columns first and falls back to the
decision history, so a name is shown whenever the person is known.
"""

PENDING = "Pending"


def _user_name(user):
    if not user:
        return None
    return user.full_name or user.username


def _last_decision_user(decisions, predicate):
    for d in reversed(list(decisions or [])):
        if predicate(d):
            name = _user_name(getattr(d, "user", None))
            if name:
                return name
    return None


def resolve_report_people(batch, decisions=None) -> dict:
    """Returns {'operator', 'supervisor', 'approver'} display names ('Pending' when unknown)."""
    if decisions is None:
        decisions = batch.decisions or []
    decisions = sorted(
        decisions,
        key=lambda d: (d.decided_at is None, d.decided_at or 0),
    ) if all(hasattr(d, "decided_at") for d in decisions) else list(decisions)

    operator = _user_name(batch.prepared_user) or _last_decision_user(
        decisions, lambda d: d.stage == "Inspection" or getattr(d, "role", None) == "operator"
    )
    supervisor = (
        _user_name(batch.checked_user)
        or _last_decision_user(
            decisions,
            lambda d: d.stage in ("Review", "Hold placed") or getattr(d, "role", None) == "supervisor",
        )
        or _user_name(getattr(batch, "hold_user", None))
    )
    approver = _user_name(batch.approved_user)

    return {
        "operator": operator or PENDING,
        "supervisor": supervisor or PENDING,
        "approver": approver or PENDING,
    }
