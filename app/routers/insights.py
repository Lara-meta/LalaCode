from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.agent_run import AgentRun
from ..models.disruption import Disruption
from ..models.operator_result import OperatorResult
from ..models.workbench_item import WorkbenchItem


router = APIRouter(prefix="/insights", tags=["insights"])


def _ratio(part: int, total: int) -> float:
    return round(part / total, 4) if total else 0.0


def _duration_label(seconds: float) -> str:
    total_seconds = max(0, round(seconds))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, remaining_seconds = divmod(remainder, 60)
    if hours:
        return f"{hours}h {minutes}m"
    if minutes:
        return f"{minutes}m {remaining_seconds}s"
    return f"{remaining_seconds}s"


def _summary_for_runs(runs: list[AgentRun], actionable_review_run_ids: set[int]) -> dict:
    statuses = Counter(run.status for run in runs)
    durations = [
        (run.completed_at - run.triggered_at).total_seconds()
        for run in runs
        if run.completed_at and run.triggered_at
    ]
    total = len(runs)
    completed = statuses["completed"]
    raw_waiting = [run for run in runs if run.status == "waiting_for_human"]
    actionable_waiting = sum(run.id in actionable_review_run_ids for run in raw_waiting)
    return {
        "analyzed_runs": total,
        "completed": completed,
        "failed": statuses["failed"],
        "blocked": statuses["blocked_by_policy"],
        "waiting_for_human": actionable_waiting,
        "review_unavailable": len(raw_waiting) - actionable_waiting,
        "completion_rate": _ratio(completed, total),
        "average_duration_seconds": round(sum(durations) / len(durations), 1) if durations else None,
    }


def _evidence_error(run: AgentRun, operator_results: list[OperatorResult]) -> str | None:
    for result in reversed(operator_results):
        output = result.output if isinstance(result.output, dict) else {}
        for key in ("error", "detail", "message", "reason"):
            if output.get(key):
                return str(output[key])[:500]
    result = run.result if isinstance(run.result, dict) else {}
    for key in ("error", "detail", "message", "reason"):
        if result.get(key):
            return str(result[key])[:500]
    return None


@router.get("/orchestrator")
def get_orchestrator_insights(
    limit: int = 200,
    period: str = "7d",
    start: datetime | None = None,
    end: datetime | None = None,
    db: Session = Depends(get_db),
):
    safe_limit = max(10, min(limit, 500))
    now = datetime.now(timezone.utc)

    period_days = {"24h": 1, "7d": 7, "30d": 30}
    if period == "custom":
        if not start or not end or start >= end:
            raise HTTPException(status_code=400, detail="Custom range requires a valid start before end.")
        window_start, window_end = start, end
    elif period in period_days:
        window_end = now
        window_start = now - timedelta(days=period_days[period])
    else:
        raise HTTPException(status_code=400, detail="Period must be 24h, 7d, 30d, or custom.")

    window_duration = window_end - window_start
    previous_start = window_start - window_duration
    previous_end = window_start

    runs = (
        db.query(AgentRun)
        .filter(AgentRun.triggered_at >= window_start, AgentRun.triggered_at < window_end)
        .order_by(AgentRun.id.desc())
        .limit(safe_limit)
        .all()
    )
    previous_runs = (
        db.query(AgentRun)
        .filter(AgentRun.triggered_at >= previous_start, AgentRun.triggered_at < previous_end)
        .order_by(AgentRun.id.desc())
        .limit(safe_limit)
        .all()
    )
    actionable_review_run_ids = {
        run_id for (run_id,) in (
            db.query(WorkbenchItem.agent_run_id)
            .filter(
                WorkbenchItem.status == "pending",
                WorkbenchItem.cleared_at.is_(None),
            )
            .all()
        )
    }
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

    summary = _summary_for_runs(runs, actionable_review_run_ids)
    previous_summary = _summary_for_runs(previous_runs, actionable_review_run_ids)
    total = summary["analyzed_runs"]
    completed = summary["completed"]
    failed = summary["failed"]
    blocked = summary["blocked"]
    waiting = summary["waiting_for_human"]
    review_unavailable = summary["review_unavailable"]
    average_duration = summary["average_duration_seconds"]

    stalled_after_minutes = max(5, int(os.getenv("DASHBOARD_STALLED_AFTER_MINUTES", "15")))
    stale_runs = [
        run for run in runs
        if run.status in {"running", "evaluating_policies"}
        and run.triggered_at
        and run.triggered_at < now - timedelta(minutes=stalled_after_minutes)
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
        terminal_execution_outcomes = failed + completed
        failure_rate = _ratio(failed, terminal_execution_outcomes)
        insights.append({
            "id": "workflow-failure-rate",
            "type": "anomaly" if failure_rate >= 0.2 else "trend",
            "severity": "warning" if failure_rate >= 0.2 else "info",
            "title": f"Workflow failure rate is {failure_rate:.0%}",
            "description": f"{failed} of {terminal_execution_outcomes} terminal execution outcomes failed. Policy blocks and unfinished runs are excluded.",
            "data": {"failed": failed, "terminal_outcomes": terminal_execution_outcomes, "failure_rate": failure_rate},
            "suggested_action": "Inspect failed runs on the operational dashboard",
            "action_type": "view_dashboard",
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
            "description": f"These runs have remained active for more than {stalled_after_minutes} minutes without completing or entering human review.",
            "data": {"affected_runs": len(stale_runs), "threshold_minutes": stalled_after_minutes},
            "suggested_action": "Inspect active runs and reconcile their final status",
            "action_type": "view_dashboard",
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
                + (f" Average resolved duration is {_duration_label(average_duration)}." if average_duration is not None else "")
            ),
            "data": {"completed": completed, "completion_rate": _ratio(completed, total), "average_duration_seconds": average_duration},
            "suggested_action": "Use successful runs as the baseline for workflow optimization",
            "action_type": "view_dashboard",
            "created_at": now,
        })

    if review_unavailable:
        insights.append({
            "id": "review-unavailable-workflows",
            "type": "anomaly",
            "severity": "warning",
            "title": f"{review_unavailable} historical review stop{'s have' if review_unavailable != 1 else ' has'} no active Workbench case",
            "description": "These runs retain a legacy waiting status, but there is no pending approval an administrator can act on. They are excluded from Awaiting Human.",
            "data": {"affected_runs": review_unavailable},
            "suggested_action": "Inspect unavailable review runs on the dashboard",
            "action_type": "view_dashboard",
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
        "summary": summary,
        "comparison": {
            "previous": previous_summary,
            "deltas": {
                "analyzed_runs": total - previous_summary["analyzed_runs"],
                "completion_rate": round(summary["completion_rate"] - previous_summary["completion_rate"], 4),
                "failed": failed - previous_summary["failed"],
            "waiting_for_human": waiting - previous_summary["waiting_for_human"],
            },
        },
        "window": {
            "period": period,
            "start": window_start,
            "end": window_end,
            "previous_start": previous_start,
            "previous_end": previous_end,
        },
        "insights": insights,
        "patterns": patterns,
        "actions": actions,
        "generated_at": now,
    }


@router.get("/orchestrator/evidence/{insight_id}")
def get_insight_evidence(
    insight_id: str,
    limit: int = 100,
    offset: int = 0,
    period: str = "7d",
    start: datetime | None = None,
    end: datetime | None = None,
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    period_days = {"24h": 1, "7d": 7, "30d": 30}
    if period == "custom":
        if not start or not end or start >= end:
            raise HTTPException(status_code=400, detail="Custom range requires a valid start before end.")
        window_start, window_end = start, end
    elif period in period_days:
        window_end = now
        window_start = now - timedelta(days=period_days[period])
    else:
        raise HTTPException(status_code=400, detail="Period must be 24h, 7d, 30d, or custom.")

    status_map = {
        "workflow-failure-rate": {"failed"},
        "policy-block-frequency": {"blocked_by_policy"},
        "completion-performance": {"completed"},
    }
    query = (
        db.query(AgentRun, Disruption)
        .outerjoin(Disruption, AgentRun.disruption_id == Disruption.id)
        .filter(AgentRun.triggered_at >= window_start, AgentRun.triggered_at < window_end)
    )
    if insight_id == "stale-running-workflows":
        stalled_after_minutes = max(5, int(os.getenv("DASHBOARD_STALLED_AFTER_MINUTES", "15")))
        query = query.filter(
            AgentRun.status.in_({"running", "evaluating_policies"}),
            AgentRun.triggered_at < now - timedelta(minutes=stalled_after_minutes),
        )
    elif insight_id in {"waiting-human-review", "review-unavailable-workflows"}:
        active_review_ids = db.query(WorkbenchItem.agent_run_id).filter(
            WorkbenchItem.status == "pending",
            WorkbenchItem.cleared_at.is_(None),
        )
        query = query.filter(AgentRun.status == "waiting_for_human")
        if insight_id == "waiting-human-review":
            query = query.filter(AgentRun.id.in_(active_review_ids))
        else:
            query = query.filter(~AgentRun.id.in_(active_review_ids))
    elif insight_id in status_map:
        query = query.filter(AgentRun.status.in_(status_map[insight_id]))
    else:
        raise HTTPException(status_code=404, detail="Evidence is not available for this insight.")

    total = query.count()
    rows = query.order_by(AgentRun.triggered_at.desc(), AgentRun.id.desc()).offset(max(0, offset)).limit(max(1, min(limit, 100))).all()
    run_ids = [run.id for run, _ in rows]
    operator_rows = (
        db.query(OperatorResult)
        .filter(OperatorResult.agent_run_id.in_(run_ids))
        .order_by(OperatorResult.created_at.asc(), OperatorResult.id.asc())
        .all()
        if run_ids else []
    )
    operators_by_run: dict[int, list[OperatorResult]] = defaultdict(list)
    for operator in operator_rows:
        operators_by_run[operator.agent_run_id].append(operator)

    evidence = []
    for run, disruption in rows:
        raw = disruption.raw_data if disruption and isinstance(disruption.raw_data, dict) else {}
        run_operators = operators_by_run[run.id]
        evidence.append({
            "run_id": run.id,
            "status": run.status,
            "item_number": raw.get("item_number"),
            "supplier_id": raw.get("notice_supplier_id"),
            "notice_id": disruption.external_id if disruption else None,
            "notice_type": raw.get("notice_type"),
            "triggered_at": run.triggered_at,
            "completed_at": run.completed_at,
            "error": _evidence_error(run, run_operators),
            "operators": [{"name": item.operator_name, "status": item.status} for item in run_operators],
            "operator_count": len(run_operators),
        })

    return {"insight_id": insight_id, "total": total, "offset": offset, "limit": min(limit, 100), "records": evidence}
