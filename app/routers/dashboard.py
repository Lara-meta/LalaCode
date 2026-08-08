import os
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, text
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.agent_run import AgentRun
from ..models.disruption import Disruption
from ..models.operator_result import OperatorResult
from ..models.workbench_item import WorkbenchItem


router = APIRouter(
    prefix="/dashboard",
    tags=["dashboard"],
)


def _recovery_context(result):
    """Extract decision-level impact without exposing raw workflow noise."""
    if not isinstance(result, dict):
        return {}
    review = result.get("human_review") or {}
    activities = review.get("recommendation_activities") or []
    for activity in reversed(activities):
        outputs = activity.get("outputs") if isinstance(activity, dict) else None
        output = outputs.get("output") if isinstance(outputs, dict) else None
        if not isinstance(output, str) or not output.strip().startswith("{"):
            continue
        try:
            payload = json.loads(output)
        except json.JSONDecodeError:
            continue
        impact = payload.get("impact_mapper") or {}
        return {
            "severity": impact.get("severity"),
            "exposure_value": impact.get("exposure_value"),
            "recommended_strategy": payload.get("recommended_strategy"),
        }
    return {}


@router.get("/operations")
def get_operations_dashboard(
    limit: int = 10,
    db: Session = Depends(get_db),
):
    safe_limit = max(1, min(limit, 50))
    stalled_after_minutes = max(
        5,
        int(os.getenv("DASHBOARD_STALLED_AFTER_MINUTES", "15")),
    )
    stalled_cutoff = datetime.now(timezone.utc) - timedelta(
        minutes=stalled_after_minutes
    )

    # ============================================================
    # 1. SUMMARY COUNTS
    # ============================================================

    total_runs = (
        db.query(func.count(AgentRun.id))
        .scalar()
        or 0
    )

    completed_runs = (
        db.query(func.count(AgentRun.id))
        .filter(AgentRun.status == "completed")
        .scalar()
        or 0
    )

    blocked_runs = (
        db.query(func.count(AgentRun.id))
        .filter(AgentRun.status == "blocked_by_policy")
        .scalar()
        or 0
    )

    failed_runs = (
        db.query(func.count(AgentRun.id))
        .filter(AgentRun.status == "failed")
        .scalar()
        or 0
    )

    active_runs = (
        db.query(func.count(AgentRun.id))
        .filter(
            AgentRun.status.in_(
                ["running", "evaluating_policies"]
            ),
            AgentRun.triggered_at >= stalled_cutoff,
        )
        .scalar()
        or 0
    )

    stalled_runs = (
        db.query(func.count(AgentRun.id))
        .filter(
            AgentRun.status.in_(["running", "evaluating_policies"]),
            AgentRun.triggered_at < stalled_cutoff,
        )
        .scalar()
        or 0
    )

    pending_review_rows = (
        db.query(WorkbenchItem.agent_run_id, WorkbenchItem.id)
        .filter(WorkbenchItem.status == "pending")
        .all()
    )
    pending_review_by_run = {
        agent_run_id: item_id for agent_run_id, item_id in pending_review_rows
    }

    waiting_for_human_total = (
        db.query(func.count(AgentRun.id))
        .filter(AgentRun.status == "waiting_for_human")
        .scalar()
        or 0
    )
    waiting_for_human_runs = len(pending_review_by_run)
    review_unavailable_runs = max(
        0, waiting_for_human_total - waiting_for_human_runs
    )

    rejected_runs = (
        db.query(func.count(AgentRun.id))
        .filter(AgentRun.status == "rejected_by_human")
        .scalar()
        or 0
    )

    superseded_runs = (
        db.query(func.count(AgentRun.id))
        .filter(AgentRun.status == "superseded_by_human_decision")
        .scalar()
        or 0
    )

    known_status_runs = (
        active_runs
        + stalled_runs
        + waiting_for_human_runs
        + review_unavailable_runs
        + completed_runs
        + rejected_runs
        + failed_runs
        + blocked_runs
        + superseded_runs
    )

    pending_reviews = waiting_for_human_runs

    oldest_pending = (
        db.query(WorkbenchItem)
        .filter(WorkbenchItem.status == "pending")
        .order_by(WorkbenchItem.created_at.asc())
        .first()
    )

    oldest_wait_minutes = None
    if oldest_pending and oldest_pending.created_at:
        created_at = oldest_pending.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        oldest_wait_minutes = max(
            0,
            int((datetime.now(timezone.utc) - created_at).total_seconds() // 60),
        )

    # ============================================================
    # 2. ACTIVITY CHART - LAST 7 DAYS
    # ============================================================

    today = datetime.now(timezone.utc).date()
    start_date = today - timedelta(days=6)

    start_datetime = datetime.combine(
        start_date,
        datetime.min.time(),
    ).replace(tzinfo=timezone.utc)

    daily_rows = (
        db.query(
            func.date(AgentRun.triggered_at).label("day"),

            func.count(
                AgentRun.id
            ).label("total"),

            func.sum(
                case(
                    (
                        AgentRun.status == "completed",
                        1,
                    ),
                    else_=0,
                )
            ).label("completed"),

            func.sum(
                case(
                    (
                        AgentRun.status == "blocked_by_policy",
                        1,
                    ),
                    else_=0,
                )
            ).label("blocked"),

            func.sum(
                case(
                    (
                        AgentRun.status == "failed",
                        1,
                    ),
                    else_=0,
                )
            ).label("failed"),

            func.sum(
                case(
                    (
                        AgentRun.status.in_(
                            ["running", "evaluating_policies"]
                        ),
                        1,
                    ),
                    else_=0,
                )
            ).label("active"),

            func.sum(
                case(
                    (
                        AgentRun.status == "superseded_by_human_decision",
                        1,
                    ),
                    else_=0,
                )
            ).label("human_assisted"),

            func.sum(
                case(
                    (
                        AgentRun.status.in_([
                            "failed",
                            "blocked_by_policy",
                            "rejected_by_human",
                        ]),
                        1,
                    ),
                    else_=0,
                )
            ).label("unresolved"),
        )

        .filter(
            AgentRun.triggered_at >= start_datetime
        )
        .group_by(
            func.date(AgentRun.triggered_at)
        )
        .order_by(
            func.date(AgentRun.triggered_at)
        )
        .all()
    )

    daily_lookup = {
        row.day: {
            "total": int(row.total or 0),
            "completed": int(row.completed or 0),
            "blocked": int(row.blocked or 0),
            "failed": int(row.failed or 0),
            "active": int(row.active or 0),
            "human_assisted": int(row.human_assisted or 0),
            "unresolved": int(row.unresolved or 0),
        }
        for row in daily_rows
    }

    activity_chart = []

    for offset in range(7):
        day = start_date + timedelta(days=offset)

        values = daily_lookup.get(
            day,
            {
                "total": 0,
                "completed": 0,
                "blocked": 0,
                "failed": 0,
                "active": 0,
                "human_assisted": 0,
                "unresolved": 0,
            },
        )

        activity_chart.append(
            {
                "date": day.isoformat(),
                "label": day.strftime("%a"),
                **values,
            }
        )

    # ============================================================
    # 3. RECENT ORCHESTRATION RUNS
    # ============================================================

    recent_run_rows = (
        db.query(
            AgentRun,
            Disruption,
        )
        .outerjoin(
            Disruption,
            AgentRun.disruption_id == Disruption.id,
        )
        .order_by(
            AgentRun.id.desc()
        )
        .limit(safe_limit)
        .all()
    )

    recent_runs = []

    for run, disruption in recent_run_rows:

        raw_data = {}

        if (
            disruption
            and isinstance(disruption.raw_data, dict)
        ):
            raw_data = disruption.raw_data

        if run.status == "waiting_for_human" and run.id not in pending_review_by_run:
            effective_status = "review_unavailable"
        elif run.status in ["running", "evaluating_policies"] and run.triggered_at < stalled_cutoff:
            effective_status = "stalled"
        else:
            effective_status = run.status
        recovery = _recovery_context(run.result)
        severity = str(recovery.get("severity") or "").lower()
        if effective_status == "waiting_for_human" or severity == "critical":
            priority = "critical"
        elif effective_status in ["stalled", "failed"] or severity == "high":
            priority = "high"
        elif effective_status == "blocked_by_policy" or severity == "medium":
            priority = "medium"
        else:
            priority = "low"

        triggered_at = run.triggered_at
        if triggered_at and triggered_at.tzinfo is None:
            triggered_at = triggered_at.replace(tzinfo=timezone.utc)
        age_minutes = (
            max(0, int((datetime.now(timezone.utc) - triggered_at).total_seconds() // 60))
            if triggered_at else None
        )

        recent_runs.append(
            {
                "id": run.id,

                "disruption_id": run.disruption_id,

                "notice_id": (
                    disruption.external_id
                    if disruption
                    else None
                ),

                "item_number": raw_data.get(
                    "item_number"
                ),

                "notice_type": raw_data.get(
                    "notice_type"
                ),

                "supplier_id": raw_data.get("notice_supplier_id"),
                "severity": recovery.get("severity"),
                "exposure_value": recovery.get("exposure_value"),
                "recommended_strategy": recovery.get("recommended_strategy"),
                "priority": priority,
                "age_minutes": age_minutes,
                "workbench_item_id": pending_review_by_run.get(run.id),

                "supervity_run_id":
                    run.supervity_run_id,

                "status": effective_status,

                "triggered_at":
                    run.triggered_at,

                "completed_at":
                    run.completed_at,
            }
        )

    # ============================================================
    # 4. RECENT OPERATOR ACTIVITY
    # ============================================================

    operator_results = (
        db.query(OperatorResult)
        .order_by(
            OperatorResult.created_at.desc(),
            OperatorResult.id.desc(),
        )
        .limit(12)
        .all()
    )

    recent_operators = [
        {
            "id": result.id,
            "agent_run_id": result.agent_run_id,
            "operator_name": result.operator_name,
            "status": result.status,
            "created_at": result.created_at,
        }
        for result in operator_results
    ]

    # ============================================================
    # 5. SYSTEM HEALTH
    # ============================================================

    database_status = "healthy"

    try:
        db.execute(text("SELECT 1"))

    except Exception:
        database_status = "unhealthy"

    # Check whether Supervity configuration exists.
    # Do NOT return secret values.
    supervity_configured = bool(
        os.getenv("SUPERVITY_API_KEY")
        and os.getenv("SUPERVITY_WORKFLOW_ID")
    )

    latest_supervity_success = (
        db.query(AgentRun)
        .filter(
            AgentRun.status == "completed",
            AgentRun.supervity_run_id.isnot(None),
        )
        .order_by(
            AgentRun.id.desc()
        )
        .first()
    )

    if (
        supervity_configured
        and latest_supervity_success
    ):
        supervity_status = "healthy"

        supervity_detail = (
            "Recent successful workflow: "
            f"Run {latest_supervity_success.id}"
        )

    elif supervity_configured:
        supervity_status = "configured"

        supervity_detail = (
            "Configured, but no successful "
            "Supervity workflow found"
        )

    else:
        supervity_status = "not_configured"

        supervity_detail = (
            "Supervity integration not configured"
        )

    # ============================================================
    # 6. FINAL RESPONSE
    # ============================================================

    return {
        "summary": {
            "total_runs": total_runs,
            "completed": completed_runs,
            "blocked": blocked_runs,
            "failed": failed_runs,
            "active": active_runs,
            "stalled": stalled_runs,
            "waiting_for_human": waiting_for_human_runs,
            "review_unavailable": review_unavailable_runs,
            "rejected": rejected_runs,
            "superseded": superseded_runs,
            "other": max(0, total_runs - known_status_runs),
            "stalled_after_minutes": stalled_after_minutes,
        },

        "action_required": {
            "pending_reviews": pending_reviews,
            "failed_runs": failed_runs,
            "policy_blocks": blocked_runs,
            "stalled_runs": stalled_runs,
            "oldest_wait_minutes": oldest_wait_minutes,
            "oldest_review_id": (
                oldest_pending.id if oldest_pending else None
            ),
        },

        "activity_chart": activity_chart,

        "recent_runs": recent_runs,

        "recent_operators": recent_operators,

        "system_health": {
            "backend": {
                "status": "healthy",
                "detail": "Dashboard API responding",
            },

            "database": {
                "status": database_status,
                "detail": "PostgreSQL database",
            },

            "supervity": {
                "status": supervity_status,
                "configured": supervity_configured,
                "detail": supervity_detail,

                "last_success_run": (
                    latest_supervity_success.id
                    if latest_supervity_success
                    else None
                ),
            },
        },

        "last_updated":
            datetime.now(timezone.utc),
    }
