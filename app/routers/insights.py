from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.agent_run import AgentRun
from ..models.disruption import Disruption
from ..models.operator_result import OperatorResult


router = APIRouter(prefix="/insights", tags=["insights"])


def _ratio(part: int, total: int) -> float:
    return round(part / total, 4) if total else 0.0


@router.get("/orchestrator")
def get_orchestrator_insights(
    limit: int = 200,
    db: Session = Depends(get_db),
):
    safe_limit = max(10, min(limit, 500))
    now = datetime.now(timezone.utc)

    runs = (
        db.query(AgentRun)
        .order_by(AgentRun.id.desc())
        .limit(safe_limit)
        .all()
    )
    run_ids = [run.id for run in runs]
    disruption_ids = {
        run.disruption_id for run in runs if run.disruption_id
    }

    disruptions = (
        db.query(Disruption)
        .filter(Disruption.id.in_(disruption_ids))
        .all()
        if disruption_ids
        else []
    )
    disruption_by_id = {item.id: item for item in disruptions}

    operators = (
        db.query(OperatorResult)
        .filter(OperatorResult.agent_run_id.in_(run_ids))
        .all()
        if run_ids
        else []
    )

    statuses = Counter(run.status for run in runs)
    total = len(runs)
    completed = statuses["completed"]
    failed = statuses["failed"]
    blocked = statuses["blocked_by_policy"]
    waiting = statuses["waiting_for_human"]

    durations = [
        (run.completed_at - run.triggered_at).total_seconds()
        for run in runs
        if run.completed_at and run.triggered_at
    ]
    average_duration = (
        round(sum(durations) / len(durations), 1)
        if durations
        else None
    )

    stale_runs = [
        run for run in runs
        if run.status in {"running", "evaluating_policies"}
        and run.triggered_at
        and run.triggered_at < now - timedelta(minutes=30)
    ]

    notice_types = Counter()
    for run in runs:
        disruption = disruption_by_id.get(run.disruption_id)
        raw_data = disruption.raw_data if disruption else None
        if isinstance(raw_data, dict) and raw_data.get("notice_type"):
            notice_types[str(raw_data["notice_type"])] += 1

    operator_totals = Counter(result.operator_name for result in operators)
    operator_successes = Counter(
        result.operator_name
        for result in operators
        if result.status == "completed"
    )

    insights = []
    actions = []

    if waiting:
        insights.append({
            "id": "waiting-human-review",
            "type": "alert",
            "severity": "critical",
            "title": f"{waiting} workflow{'s' if waiting != 1 else ''} awaiting a decision",
            "description": "Orchestrator runs are paused until a human approves, modifies, or rejects them in the Workbench.",
            "data": {"waiting_runs": waiting},
            "suggested_action": "Review the pending Workbench queue",
            "action_type": "review_workbench",
            "confidence": 1.0,
            "created_at": now,
        })
        actions.append({
            "title": "Resolve pending human decisions",
            "priority": "critical",
            "estimated_impact": f"Unblock {waiting} workflow{'s' if waiting != 1 else ''}",
            "action_type": "review_workbench",
            "action_config": {"count": waiting},
        })

    if failed:
        failure_rate = _ratio(failed, total)
        insights.append({
            "id": "workflow-failure-rate",
            "type": "anomaly" if failure_rate >= 0.2 else "trend",
            "severity": "warning" if failure_rate >= 0.2 else "info",
            "title": f"Workflow failure rate is {failure_rate:.0%}",
            "description": f"{failed} of the latest {total} orchestrator runs failed. Review recent failures before increasing automation volume.",
            "data": {"failed": failed, "total": total, "failure_rate": failure_rate},
            "suggested_action": "Inspect failed runs on the operational dashboard",
            "action_type": "view_dashboard",
            "confidence": min(0.99, 0.65 + total / 1000),
            "created_at": now,
        })
        actions.append({
            "title": "Investigate failed orchestrator runs",
            "priority": "high" if failure_rate >= 0.2 else "medium",
            "estimated_impact": f"Improve reliability across {failed} failed runs",
            "action_type": "view_dashboard",
            "action_config": {"status": "failed"},
        })

    if blocked:
        insights.append({
            "id": "policy-block-frequency",
            "type": "recommendation",
            "severity": "info",
            "title": f"Policies blocked {blocked} recent runs",
            "description": "Policy blocks are governance outcomes rather than human approvals. Repeated blocks may indicate that thresholds need review.",
            "data": {"blocked": blocked, "block_rate": _ratio(blocked, total)},
            "suggested_action": "Review policy thresholds and recent evaluations",
            "action_type": "review_policies",
            "confidence": 0.95,
            "created_at": now,
        })
        actions.append({
            "title": "Review frequently triggered policies",
            "priority": "medium",
            "estimated_impact": f"Clarify outcomes for {blocked} blocked runs",
            "action_type": "review_policies",
            "action_config": {"blocked_runs": blocked},
        })

    if stale_runs:
        insights.append({
            "id": "stale-running-workflows",
            "type": "alert",
            "severity": "warning",
            "title": f"{len(stale_runs)} workflow{'s appear' if len(stale_runs) != 1 else ' appears'} stalled",
            "description": "These runs have remained active for more than 30 minutes without completing or entering human review.",
            "data": {"run_ids": [run.id for run in stale_runs]},
            "suggested_action": "Inspect active runs and reconcile their final status",
            "action_type": "view_dashboard",
            "confidence": 0.9,
            "created_at": now,
        })

    if completed:
        insights.append({
            "id": "completion-performance",
            "type": "trend",
            "severity": "info",
            "title": f"{completed} workflows completed successfully",
            "description": (
                f"Successful runs represent {_ratio(completed, total):.0%} of the analyzed history."
                + (f" Average resolved duration is {average_duration:.0f} seconds." if average_duration is not None else "")
            ),
            "data": {"completed": completed, "completion_rate": _ratio(completed, total), "average_duration_seconds": average_duration},
            "suggested_action": "Use successful runs as the baseline for workflow optimization",
            "action_type": "view_dashboard",
            "confidence": min(0.98, 0.7 + completed / 500),
            "created_at": now,
        })

    patterns = []
    if notice_types:
        notice_type, count = notice_types.most_common(1)[0]
        patterns.append({
            "name": f"{notice_type.replace('_', ' ').title()} disruptions dominate",
            "frequency": f"{count} of {sum(notice_types.values())} classified runs",
            "confidence": _ratio(count, sum(notice_types.values())),
            "sample_size": sum(notice_types.values()),
            "description": "Most frequent disruption type observed by the orchestrator.",
        })

    for operator_name, count in operator_totals.most_common(4):
        success_rate = _ratio(operator_successes[operator_name], count)
        patterns.append({
            "name": f"{operator_name} execution reliability",
            "frequency": f"{count} recorded executions",
            "confidence": success_rate,
            "sample_size": count,
            "description": f"Completed successfully in {success_rate:.0%} of persisted executions.",
        })

    return {
        "summary": {
            "analyzed_runs": total,
            "completed": completed,
            "failed": failed,
            "blocked": blocked,
            "waiting_for_human": waiting,
            "completion_rate": _ratio(completed, total),
            "average_duration_seconds": average_duration,
        },
        "insights": insights,
        "patterns": patterns,
        "actions": actions,
        "generated_at": now,
    }
