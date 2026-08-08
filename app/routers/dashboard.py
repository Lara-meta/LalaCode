import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, text
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.agent_run import AgentRun
from ..models.disruption import Disruption
from ..models.operator_result import OperatorResult


router = APIRouter(
    prefix="/dashboard",
    tags=["dashboard"],
)


@router.get("/operations")
def get_operations_dashboard(
    limit: int = 10,
    db: Session = Depends(get_db),
):
    safe_limit = max(1, min(limit, 50))

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
    .filter(AgentRun.status.in_(["running", "evaluating_policies"]))
    .scalar()
    or 0
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
        )
            func.sum(
        case(
            (
                AgentRun.status.in_(["running", "evaluating_policies"]),
                1,
            ),
            else_=0,
        )
    ).label("active"),

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

                "supervity_run_id":
                    run.supervity_run_id,

                "status":
                    run.status,

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