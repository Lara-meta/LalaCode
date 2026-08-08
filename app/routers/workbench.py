from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.agent_run import AgentRun
from ..models.disruption import Disruption
from ..models.operator_result import OperatorResult
from ..models.workbench_item import WorkbenchItem
from ..services.supervity import (
    SupervityError,
    trigger_orchestrator_run,
)


router = APIRouter(
    prefix="/workbench",
    tags=["workbench"],
)


# ============================================================
# OPERATORS WE WANT TO PERSIST
# ============================================================

OPERATOR_STEP_MAP = {
    "call_impact_mapper": "Impact Mapper",
    "call_alternative_sourcing": "Alternative Sourcing",
    "call_expedite_compliance": "Expedite Compliance",
    "call_recovery_strategy_operator": (
        "Recovery Strategy & Cost Evaluation"
    ),
    "step_9_log_decision_serious": "Log Decision Agent",
}


# ============================================================
# REQUEST MODEL
# ============================================================

class WorkbenchDecisionRequest(BaseModel):
    decision: Literal[
        "approve",
        "modify",
        "reject",
        "hold",
    ]

    decision_notes: Optional[str] = None
    recovery_strategy: Optional[str] = None

    # Used only for MODIFY
    item_number: Optional[str] = None
    notice_supplier_id: Optional[str] = None
    notice_type: Optional[str] = None


# ============================================================
# SERIALIZER
# ============================================================

def _serialize_item(
    item: WorkbenchItem,
    agent_run: AgentRun,
    disruption: Disruption,
) -> dict:
    raw_data = {}

    if isinstance(disruption.raw_data, dict):
        raw_data = disruption.raw_data

    run_result = (
        agent_run.result
        if isinstance(agent_run.result, dict)
        else {}
    )
    human_review = run_result.get("human_review") or {}

    return {
        "id": item.id,
        "agent_run_id": item.agent_run_id,
        "reason": item.reason,
        "status": item.status,
        "decision_notes": item.decision_notes,
        "assigned_to": item.assigned_to,
        "created_at": item.created_at,
        "resolved_at": item.resolved_at,

        "agent_run_status": agent_run.status,
        "supervity_run_id": agent_run.supervity_run_id,
        "review_source": human_review.get("source"),
        "review_url": human_review.get("review_url"),
        "review_context": {
            "form_data": human_review.get("form_data") or {},
            "recommendation_activities": (
                human_review.get("recommendation_activities") or []
            ),
        },

        "disruption_id": disruption.id,
        "external_id": disruption.external_id,

        "disruption": {
            "item_number": raw_data.get("item_number"),
            "notice_supplier_id": raw_data.get(
                "notice_supplier_id"
            ),
            "notice_type": raw_data.get("notice_type"),
            "notice_id": disruption.external_id,
        },
    }


# ============================================================
# GET WORKBENCH ITEMS
# ============================================================

@router.get("")
def list_workbench_items(
    status: str | None = "pending",
    limit: int = 50,
    db: Session = Depends(get_db),
):
    safe_limit = max(
        1,
        min(limit, 100),
    )

    # Reconcile live Supervity human stops created before the
    # Workbench callback integration (and recover safely if a
    # callback was interrupted after updating the run status).
    waiting_runs = (
        db.query(AgentRun)
        .outerjoin(
            WorkbenchItem,
            WorkbenchItem.agent_run_id == AgentRun.id,
        )
        .filter(
            AgentRun.status == "waiting_for_human",
            WorkbenchItem.id.is_(None),
        )
        .all()
    )

    for waiting_run in waiting_runs:
        db.add(
            WorkbenchItem(
                agent_run_id=waiting_run.id,
                reason=(
                    "Supervity recovery workflow requires "
                    "human approval."
                ),
                status="pending",
            )
        )

    if waiting_runs:
        db.commit()

    query = (
        db.query(
            WorkbenchItem,
            AgentRun,
            Disruption,
        )
        .join(
            AgentRun,
            WorkbenchItem.agent_run_id
            == AgentRun.id,
        )
        .join(
            Disruption,
            AgentRun.disruption_id
            == Disruption.id,
        )
        .filter(WorkbenchItem.cleared_at.is_(None))
    )

    if status:
        query = query.filter(
            WorkbenchItem.status == status
        )

    rows = (
        query
        .order_by(
            WorkbenchItem.created_at.desc(),
            WorkbenchItem.id.desc(),
        )
        .limit(safe_limit)
        .all()
    )

    return {
        "items": [
            _serialize_item(
                item,
                agent_run,
                disruption,
            )
            for (
                item,
                agent_run,
                disruption,
            ) in rows
        ]
    }


@router.delete("/queue/clear")
def clear_workbench_queue(
    status: str | None = None,
    db: Session = Depends(get_db),
):
    resolved_statuses = {"approved", "modified", "rejected", "resumed"}
    if status in {"pending", "held"}:
        raise HTTPException(
            status_code=409,
            detail="Needs review and Held queues cannot be cleared while workflows are paused.",
        )
    if status and status not in resolved_statuses:
        raise HTTPException(status_code=400, detail="Unknown Workbench category.")

    statuses = {status} if status else resolved_statuses
    cleared_at = datetime.now(timezone.utc)
    updated = (
        db.query(WorkbenchItem)
        .filter(
            WorkbenchItem.cleared_at.is_(None),
            WorkbenchItem.status.in_(statuses),
        )
        .update({WorkbenchItem.cleared_at: cleared_at}, synchronize_session=False)
    )
    db.commit()
    return {"cleared": updated, "status": status or "all_resolved"}


# ============================================================
# GET ONE WORKBENCH ITEM
# ============================================================

@router.get("/{item_id}")
def get_workbench_item(
    item_id: int,
    db: Session = Depends(get_db),
):
    row = (
        db.query(
            WorkbenchItem,
            AgentRun,
            Disruption,
        )
        .join(
            AgentRun,
            WorkbenchItem.agent_run_id
            == AgentRun.id,
        )
        .join(
            Disruption,
            AgentRun.disruption_id
            == Disruption.id,
        )
        .filter(
            WorkbenchItem.id == item_id
        )
        .first()
    )

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Workbench item not found",
        )

    item, agent_run, disruption = row

    return _serialize_item(
        item,
        agent_run,
        disruption,
    )


# ============================================================
# HUMAN DECISION
# ============================================================

@router.post("/{item_id}/decision")
def make_workbench_decision(
    item_id: int,
    request: WorkbenchDecisionRequest,
    db: Session = Depends(get_db),
):
    # --------------------------------------------------------
    # Find Workbench item
    # --------------------------------------------------------

    item = (
        db.query(WorkbenchItem)
        .filter(
            WorkbenchItem.id == item_id
        )
        .first()
    )

    if item is None:
        raise HTTPException(
            status_code=404,
            detail="Workbench item not found",
        )

    # Pending cases may be decided; held cases may later continue or reject.
    if item.status not in {"pending", "held"}:
        raise HTTPException(
            status_code=409,
            detail=(
                "Workbench item has already "
                "been reviewed"
            ),
        )

    # --------------------------------------------------------
    # Find original blocked run
    # --------------------------------------------------------

    original_run = (
        db.query(AgentRun)
        .filter(
            AgentRun.id == item.agent_run_id
        )
        .first()
    )

    if original_run is None:
        raise HTTPException(
            status_code=404,
            detail="Original agent run not found",
        )

    if original_run.status not in {"waiting_for_human", "held_by_human"}:
        raise HTTPException(
            status_code=409,
            detail=(
                "Workbench decisions are only allowed for "
                "runs waiting for or held by a human"
            ),
        )

    # ========================================================
    # HOLD
    # ========================================================

    if request.decision == "hold":
        item.status = "held"
        item.decision_notes = request.decision_notes or "Held by human reviewer"
        item.resolved_at = None
        original_run.status = "held_by_human"
        original_run.completed_at = None
        db.commit()
        db.refresh(item)
        return {
            "status": "held",
            "workbench_item_id": item.id,
            "original_agent_run_id": original_run.id,
            "resume_required": False,
        }

    # --------------------------------------------------------
    # Find disruption
    # --------------------------------------------------------

    disruption = (
        db.query(Disruption)
        .filter(
            Disruption.id
            == original_run.disruption_id
        )
        .first()
    )

    if disruption is None:
        raise HTTPException(
            status_code=404,
            detail="Disruption not found",
        )

    # ========================================================
    # REJECT
    # ========================================================

    if request.decision == "reject":
        item.status = "rejected"

        item.decision_notes = (
            request.decision_notes
            or "Rejected by human reviewer"
        )

        item.resolved_at = (
            datetime.now(timezone.utc)
        )

        original_run.status = "rejected_by_human"
        original_run.completed_at = (
            datetime.now(timezone.utc)
        )

        db.commit()
        db.refresh(item)

        return {
            "status": "rejected",
            "workbench_item_id": item.id,
            "original_agent_run_id": (
                original_run.id
            ),
            "resume_required": False,
        }

    # ========================================================
    # MODIFY
    # ========================================================

    if request.decision == "modify":
        if (
            request.item_number is None
            and request.notice_supplier_id is None
            and request.notice_type is None
            and request.recovery_strategy is None
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Modify requires at least "
                    "one changed field"
                ),
            )

        raw_data = dict(
            disruption.raw_data or {}
        )

        if request.item_number is not None:
            raw_data["item_number"] = (
                request.item_number
            )

        if request.notice_supplier_id is not None:
            raw_data["notice_supplier_id"] = (
                request.notice_supplier_id
            )

        if request.notice_type is not None:
            raw_data["notice_type"] = (
                request.notice_type
            )

        if request.recovery_strategy is not None:
            raw_data["selected_recovery_strategy"] = (
                request.recovery_strategy
            )

        # Keep notice ID stable.
        raw_data["notice_id"] = (
            disruption.external_id
        )

        disruption.raw_data = raw_data

        item.status = "modified"

        item.decision_notes = (
            request.decision_notes
            or (
                "Modified and approved "
                "by human reviewer"
            )
        )

        item.resolved_at = (
            datetime.now(timezone.utc)
        )

        db.commit()

        db.refresh(item)
        db.refresh(disruption)

        return {
            "status": "modified",
            "workbench_item_id": item.id,
            "original_agent_run_id": (
                original_run.id
            ),
            "resume_required": True,
            "disruption": raw_data,
        }

    # ========================================================
    # APPROVE
    # ========================================================

    if request.recovery_strategy is not None:
        raw_data = dict(disruption.raw_data or {})
        raw_data["selected_recovery_strategy"] = request.recovery_strategy
        disruption.raw_data = raw_data

    item.status = "approved"

    item.decision_notes = (
        request.decision_notes
        or "Approved by human reviewer"
    )

    item.resolved_at = (
        datetime.now(timezone.utc)
    )

    db.commit()
    db.refresh(item)

    return {
        "status": "approved",
        "workbench_item_id": item.id,
        "original_agent_run_id": (
            original_run.id
        ),
        "resume_required": True,
        "disruption": disruption.raw_data,
    }


# ============================================================
# RESUME APPROVED / MODIFIED CASE
# ============================================================

@router.post("/{item_id}/resume")
async def resume_workbench_item(
    item_id: int,
    db: Session = Depends(get_db),
):
    # --------------------------------------------------------
    # 1. Find Workbench item
    # --------------------------------------------------------

    item = (
        db.query(WorkbenchItem)
        .filter(
            WorkbenchItem.id == item_id
        )
        .first()
    )

    if item is None:
        raise HTTPException(
            status_code=404,
            detail="Workbench item not found",
        )

    # Only approved / modified cases may continue.
    if item.status not in {
        "approved",
        "modified",
    }:
        raise HTTPException(
            status_code=409,
            detail=(
                "Workbench item must be "
                "approved or modified "
                "before resume"
            ),
        )

    review_status = item.status

    # --------------------------------------------------------
    # 2. Find original blocked run
    # --------------------------------------------------------

    original_run = (
        db.query(AgentRun)
        .filter(
            AgentRun.id == item.agent_run_id
        )
        .first()
    )

    if original_run is None:
        raise HTTPException(
            status_code=404,
            detail="Original agent run not found",
        )

    if original_run.status not in {"waiting_for_human", "held_by_human"}:
        raise HTTPException(
            status_code=409,
            detail=(
                "Only runs waiting for or held by a human "
                "can be continued"
            ),
        )

    # --------------------------------------------------------
    # 3. Find disruption
    # --------------------------------------------------------

    disruption = (
        db.query(Disruption)
        .filter(
            Disruption.id
            == original_run.disruption_id
        )
        .first()
    )

    if disruption is None:
        raise HTTPException(
            status_code=404,
            detail="Disruption not found",
        )

    raw_data = dict(
        disruption.raw_data or {}
    )

    item_number = raw_data.get(
        "item_number"
    )

    notice_supplier_id = raw_data.get(
        "notice_supplier_id"
    )

    notice_type = raw_data.get(
        "notice_type"
    )

    notice_id = disruption.external_id

    # --------------------------------------------------------
    # 4. Validate required Supervity inputs
    # --------------------------------------------------------

    missing_fields = []

    if not item_number:
        missing_fields.append(
            "item_number"
        )

    if not notice_supplier_id:
        missing_fields.append(
            "notice_supplier_id"
        )

    if not notice_type:
        missing_fields.append(
            "notice_type"
        )

    if not notice_id:
        missing_fields.append(
            "notice_id"
        )

    if missing_fields:
        raise HTTPException(
            status_code=400,
            detail=(
                "Cannot resume. Missing fields: "
                + ", ".join(missing_fields)
            ),
        )

    # ========================================================
    # 5. CREATE A NEW AGENT RUN
    # ========================================================

    resumed_run = AgentRun(
        disruption_id=disruption.id,
        status="running",
    )

    db.add(resumed_run)

    original_run.status = (
        "superseded_by_human_decision"
    )
    original_run.completed_at = (
        datetime.now(timezone.utc)
    )

    db.commit()
    db.refresh(resumed_run)

    # IMPORTANT:
    #
    # We intentionally do NOT call evaluate_policies()
    # here.
    #
    # The approved Workbench item acts as the verified
    # human override for this specific blocked case.

    # ========================================================
    # 6. TRIGGER REAL SUPERVITY
    # ========================================================

    try:
        result = await trigger_orchestrator_run(
            item_number=str(
                item_number
            ),
            notice_supplier_id=str(
                notice_supplier_id
            ),
            notice_type=str(
                notice_type
            ),
            notice_id=str(
                notice_id
            ),
            expedite_cost=raw_data.get("expedite_cost"),
        )

    except SupervityError as e:
        resumed_run.status = "failed"

        resumed_run.completed_at = (
            datetime.now(timezone.utc)
        )

        db.commit()

        raise HTTPException(
            status_code=502,
            detail=str(e),
        )

    # ========================================================
    # 7. SAVE SUCCESSFUL NEW RUN
    # ========================================================

    resumed_run.status = "completed"

    resumed_run.result = result

    resumed_run.supervity_run_id = (
        result.get("workflow_run_id")
    )

    resumed_run.completed_at = (
        datetime.now(timezone.utc)
    )

    db.commit()
    db.refresh(resumed_run)

    # ========================================================
    # 8. SAVE OPERATOR RESULTS
    # ========================================================

    workflow_run = (
        result
        .get("result", {})
        .get("workflowRun", {})
    )

    activity_runs = workflow_run.get(
        "activityRuns",
        [],
    )

    operator_count = 0

    for activity in activity_runs:
        step_id = activity.get(
            "stepId"
        )

        if step_id not in OPERATOR_STEP_MAP:
            continue

        if activity.get("kind") != "step":
            continue

        operator_result = OperatorResult(
            agent_run_id=resumed_run.id,

            operator_name=(
                OPERATOR_STEP_MAP[
                    step_id
                ]
            ),

            status=activity.get(
                "status",
                "unknown",
            ),

            output=activity,
        )

        db.add(operator_result)

        operator_count += 1

    # ========================================================
    # 9. MARK WORKBENCH ITEM RESUMED
    # ========================================================

    existing_notes = (
        item.decision_notes or ""
    )

    resume_note = (
        f"Resumed as Agent Run "
        f"{resumed_run.id}."
    )

    if existing_notes:
        item.decision_notes = (
            existing_notes
            + " | "
            + resume_note
        )
    else:
        item.decision_notes = resume_note

    item.status = "resumed"

    if item.resolved_at is None:
        item.resolved_at = (
            datetime.now(timezone.utc)
        )

    db.commit()
    db.refresh(item)

    # ========================================================
    # 10. RESPONSE
    # ========================================================

    return {
        "status": "completed",

        "workbench_item_id": (
            item.id
        ),

        "review_decision": (
            review_status
        ),

        "workbench_status": (
            item.status
        ),

        "original_agent_run_id": (
            original_run.id
        ),

        "resumed_agent_run_id": (
            resumed_run.id
        ),

        "workflow_run_id": (
            resumed_run.supervity_run_id
        ),

        "operators_saved": (
            operator_count
        ),
    }
