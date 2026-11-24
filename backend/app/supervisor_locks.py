"""
Supervisor review locks (prototype `lockBy`) — the only place that decides who holds a lot.

Behaviour matches the prototype: opening a reviewable lot locks it to that supervisor, the
same supervisor can reopen it, others are refused, and the lock is cleared only when the
supervisor saves the lot. There is no expiry. To add one later, change `lock_holder()`
(e.g. ignore locks whose `locked_at` is older than N minutes); every caller goes through it.
"""
from datetime import datetime
from typing import Optional

from backend.app.models import SupervisorLotReview, User


def lock_holder(review: Optional[SupervisorLotReview]) -> Optional[int]:
    """user_id of the supervisor holding the lock, or None."""
    return review.locked_by if review else None


def is_held_by(review: Optional[SupervisorLotReview], user: User) -> bool:
    return lock_holder(review) == user.user_id


def can_acquire(review: Optional[SupervisorLotReview], user: User) -> bool:
    holder = lock_holder(review)
    return holder is None or holder == user.user_id


def acquire(review: SupervisorLotReview, user: User) -> None:
    review.locked_by = user.user_id
    review.locked_at = datetime.utcnow()


def release(review: SupervisorLotReview) -> None:
    review.locked_by = None
    review.locked_at = None
