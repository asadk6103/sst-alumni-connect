"""Celery application (worker + beat) and transactional dispatch helper.

Delivery rows (notification_logs) act as a transactional outbox: tasks are sent only after the
database transaction commits, and a periodic sweep re-dispatches rows still marked "queued"
(e.g. if Redis was briefly unavailable), so nothing is lost and consumers are idempotent.
"""

import logging

from celery import Celery
from sqlalchemy import event

from .core.config import infra

log = logging.getLogger("app.worker")

celery_app = Celery("sst_alumni", broker=infra().redis_url, backend=None, include=["app.tasks"])
celery_app.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=4,
    task_default_queue="default",
    task_routes={"app.tasks.send_email": {"queue": "notifications"}, "app.tasks.send_sms": {"queue": "notifications"}},
    broker_connection_retry_on_startup=True,
    timezone="UTC",
    beat_schedule={
        "outbox-sweep": {"task": "app.tasks.sweep_outbox", "schedule": 60.0},
        "cleanup": {"task": "app.tasks.cleanup", "schedule": 3600.0},
        "event-reminders": {"task": "app.tasks.event_reminders", "schedule": 900.0},
        "newsletters": {"task": "app.tasks.scheduled_newsletters", "schedule": 60.0},
    },
)

# Tests replace dispatching with an in-memory list.
TEST_OUTBOX: list[tuple[str, dict]] | None = None


def _send(name: str, payload: dict) -> None:
    if TEST_OUTBOX is not None:
        TEST_OUTBOX.append((name, payload))
        return
    try:
        celery_app.send_task(name, args=[payload])
    except Exception as e:  # broker down: the outbox sweep will pick it up
        log.warning("Could not queue %s (%s); it will be retried by the outbox sweep.", name, e)


def dispatch(name: str, payload: dict, after_commit_of=None) -> None:
    """Queue a task — after the given session commits (or immediately when no session is given)."""
    if after_commit_of is None:
        _send(name, payload)
        return
    event.listen(after_commit_of.sync_session, "after_commit", lambda _s: _send(name, payload), once=True)
