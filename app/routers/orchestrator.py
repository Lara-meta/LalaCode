"""
Orchestrator endpoint — triggers a real Supervity run
for a given disruption.
"""

import asyncio
import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.agent_run import AgentRun
from ..models.disruption import Disruption
from ..models.operator_result import OperatorResult
from ..models.workbench_item import WorkbenchItem
from ..models.notification import Notification
from ..services.policy_engine import evaluate_policies
from ..services.policy_context import build_policy_context
from ..services.supervity import (
    SupervityError,
    list_workflow_runs,
    trigger_orchestrator_run,
)
from ..services.workbench_notification import (
    WorkbenchNotificationError,
    send_human_review_notification,
)


logger = logging.getLogger(__name__)


router = APIRouter(
    prefix="/orchestrator",
    tags=["orchestrator"],
)


# ============================================================
# HELPERS
# ============================================================

def extract_review_url(
    content: dict,
) -> str | None:
    """
    Extract the Supervity Human Review form URL from
    an activity-run waiting event.
    """

    outputs = content.get("outputs") or {}

    output_text = outputs.get("output") or ""

    match = re.search(
        r"https://auto\.supervity\.ai/u/user-forms/[^\s]+",
        output_text,
    )

    if not match:
        return None

    return match.group(0).strip()


# ============================================================
# OPERATOR STEP MAPPING
# ============================================================

# Only these Supervity workflow steps represent Operators
# that should be persisted in operator_results.
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

class OrchestratorRunRequest(BaseModel):
    item_number: str
    notice_supplier_id: str
    notice_type: str
    notice_id: str
    severity: float | str | None = None
    expedite_cost: float | None = None
    x_escalation_clause: str | None = None


# ============================================================
# DEBUG SUPERVITY RUNS
# ============================================================

@router.get("/runs/debug")
async def debug_workflow_runs():
    """
    Temporary debugging endpoint for Supervity workflow runs.
    """

    try:
        return await list_workflow_runs()

    except SupervityError as exc:
        raise HTTPException(
            status_code=502,
            detail=str(exc),
        ) from exc


# ============================================================
# RECENT LOCAL AGENT RUNS
# ============================================================

@router.get("/runs/recent")
def get_recent_runs(
    limit: int = 10,
    db: Session = Depends(get_db),
):
    safe_limit = max(
        1,
        min(limit, 50),
    )

    runs = (
        db.query(AgentRun)
        .order_by(AgentRun.id.desc())
        .limit(safe_limit)
        .all()
    )

    return {
        "runs": [
            {
                "id": run.id,
                "disruption_id": run.disruption_id,
                "supervity_run_id": run.supervity_run_id,
                "status": run.status,
                "triggered_at": run.triggered_at,
                "completed_at": run.completed_at,
            }
            for run in runs
        ]
    }


# ============================================================
# RUN ORCHESTRATOR
# ============================================================

@router.post("/run")
async def run_orchestrator(
    request: OrchestratorRunRequest,
    db: Session = Depends(get_db),
):
    # ========================================================
    # 1. FIND OR CREATE DISRUPTION
    # ========================================================

    disruption = (
        db.query(Disruption)
        .filter(
            Disruption.external_id
            == request.notice_id
        )
        .first()
    )

    if disruption is None:
        disruption = Disruption(
            external_id=request.notice_id,
            raw_data=request.model_dump(),
        )

        db.add(disruption)
        db.commit()
        db.refresh(disruption)

    else:
        # Always refresh the stored disruption data so
        # policies and Supervity receive the newest values.
        disruption.raw_data = (
            request.model_dump()
        )

        db.commit()
        db.refresh(disruption)


    # ========================================================
    # 2. CREATE AGENT RUN
    # ========================================================

    agent_run = AgentRun(
        disruption_id=disruption.id,
        status="evaluating_policies",
    )

    db.add(agent_run)
    db.commit()
    db.refresh(agent_run)


    # ========================================================
    # 3. EVALUATE COMMAND CENTER POLICIES
    # ========================================================

    disruption_data = build_policy_context(disruption.raw_data or {})
    agent_run.policy_context = disruption_data
    agent_run.policy_context_stage = "preflight"
    db.commit()

    try:
        passed, policy_results = (
            evaluate_policies(
                db,
                agent_run.id,
                disruption_data,
                defer_missing=True,
            )
        )

    except Exception as exc:
        agent_run.status = "failed"

        agent_run.completed_at = (
            datetime.now(timezone.utc)
        )

        db.commit()
        db.refresh(agent_run)

        raise HTTPException(
            status_code=500,
            detail=(
                "Policy evaluation failed: "
                f"{exc}"
            ),
        ) from exc


    # ========================================================
    # 4. POLICY BLOCK -> STOP
    # ========================================================

    if not passed:
        agent_run.status = (
            "blocked_by_policy"
        )

        db.commit()
        db.refresh(agent_run)

        blocked_reasons = "; ".join(
            result["reason"]
            for result in policy_results
            if not result["passed"]
        )

        return {
            "agent_run_id":
                agent_run.id,

            "disruption_db_id":
                disruption.id,

            "notice_id":
                request.notice_id,

            "status":
                "blocked",

            "policy_results":
                policy_results,

            "blocked_reasons":
                blocked_reasons,
        }


    # ========================================================
    # 5. POLICIES PASSED -> PREPARE SUPERVITY
    # ========================================================

    agent_run.status = "running"

    db.commit()
    db.refresh(agent_run)


    # Prevent the same Human Review from sending duplicate
    # notification emails.
    review_notification_sent = False

    # Completed upstream activities are retained until the
    # human-decision checkpoint so the Workbench can present
    # the complete evidence and recommendation snapshot.
    review_activities: list[dict] = []


    # ========================================================
    # 5A. LIVE SUPERVITY EVENT CALLBACK
    # ========================================================

    async def handle_supervity_event(
        event: dict,
    ) -> None:
        nonlocal review_notification_sent

        event_type = event.get("event")

        data = event.get("data") or {}

        content = data.get("content")

        if not isinstance(content, dict):
            return


        workflow_run_id = content.get(
            "workflowRunId"
        )

        step_id = content.get(
            "stepId"
        )

        step_status = content.get(
            "status"
        )

        activity_kind = content.get(
            "kind"
        )

        if (
            event_type == "activity-run"
            and activity_kind == "step"
            and step_status == "completed"
            and step_id != "step_human_review_serious"
        ):
            review_activities.append({
                "step_id": step_id,
                "step_name": content.get("stepName"),
                "description": content.get("stepDescription"),
                "outputs": content.get("outputs") or {},
                "output_object_keys": (
                    content.get("outputObjectKeys") or []
                ),
            })


        # ====================================================
        # SAVE SUPERVITY WORKFLOW RUN ID
        # ====================================================

        # Save the real Supervity workflow run ID as soon as
        # Supervity provides it.
        if (
            workflow_run_id
            and agent_run.supervity_run_id
            != str(workflow_run_id)
        ):
            agent_run.supervity_run_id = (
                str(workflow_run_id)
            )

            db.commit()
            db.refresh(agent_run)


        # ====================================================
        # ONLY WATCH ACTIVITY-RUN EVENTS
        # ====================================================

        if event_type != "activity-run":
            return


        # ====================================================
        # ONLY WATCH REAL WORKFLOW STEPS
        # ====================================================

        # Supervity may reuse the same step ID for a condition
        # after the Human Review.
        #
        # We only want the real Human Review workflow step.
        if activity_kind != "step":
            return


        # ====================================================
        # ONLY WATCH HUMAN REVIEW
        # ====================================================

        if (
            step_id
            != "step_human_review_serious"
        ):
            return


        # ====================================================
        # HUMAN REVIEW WAITING
        # ====================================================

        if step_status == "waiting":

            governance_context = build_policy_context(
                disruption_data,
                review_activities,
            )
            policies_passed, checkpoint_results = evaluate_policies(
                db,
                agent_run.id,
                governance_context,
            )
            agent_run.policy_context = governance_context
            agent_run.policy_context_stage = "human_review"

            # ----------------------------------------------
            # Update database/dashboard status
            # ----------------------------------------------

            if (
                agent_run.status
                != "waiting_for_human"
            ):
                agent_run.status = (
                    "waiting_for_human"
                )

                db.commit()
                db.refresh(agent_run)

                logger.info(
                    "Agent Run %s is waiting "
                    "for human review.",
                    agent_run.id,
                )


            # ----------------------------------------------
            # Extract Supervity Human Review form URL
            # ----------------------------------------------

            review_url = (
                extract_review_url(
                    content
                )
            )

            # Persist the live review context so the local
            # Workbench can surface the same human stop.
            run_result = dict(agent_run.result or {})
            run_result["human_review"] = {
                "source": "autopilot_workbench",
                "step_id": step_id,
                "status": "waiting",
                "form_data": content,
                "recommendation_activities": review_activities,
                "policy_context": governance_context,
                "policy_results": checkpoint_results,
            }
            agent_run.result = run_result

            workbench_item = (
                db.query(WorkbenchItem)
                .filter(
                    WorkbenchItem.agent_run_id
                    == agent_run.id
                )
                .first()
            )

            if workbench_item is None:
                workbench_item = WorkbenchItem(
                    agent_run_id=agent_run.id,
                    reason=(
                        "Policy-controlled recovery requires human approval: "
                        + "; ".join(
                            result["reason"] for result in checkpoint_results
                            if not result["passed"]
                        )
                        if not policies_passed else
                        "Supervity recovery workflow requires human approval."
                    ),
                    status="pending",
                )
                db.add(workbench_item)
            elif workbench_item.status == "pending":
                workbench_item.reason = (
                    "Supervity recovery workflow "
                    "requires human approval."
                )

            db.commit()
            db.refresh(agent_run)


            # ----------------------------------------------
            # Send Admin notification ONCE
            # ----------------------------------------------

            if not review_notification_sent:
                try:
                    await asyncio.to_thread(
                        send_human_review_notification,

                        item_number=
                            request.item_number,

                        notice_supplier_id=
                            request.notice_supplier_id,

                        notice_type=
                            request.notice_type,

                        notice_id=
                            request.notice_id,

                        reason=(
                            "Supervity recovery "
                            "workflow requires "
                            "human approval."
                        ),

                    )

                    review_notification_sent = (
                        True
                    )

                    db.add(Notification(
                        title="Human approval required",
                        message=f"Run #{agent_run.id} for {request.item_number} is waiting for your review.",
                        notification_type="warning",
                        link="/workbench",
                        agent_run_id=agent_run.id,
                    ))
                    db.commit()

                    logger.info(
                        "Human review email sent "
                        "for Agent Run %s.",
                        agent_run.id,
                    )

                except WorkbenchNotificationError as exc:
                    logger.warning(
                        "Human review email failed "
                        "for Agent Run %s: %s",
                        agent_run.id,
                        exc,
                    )

            return


        # ====================================================
        # HUMAN REVIEW COMPLETED
        # ====================================================

        if step_status == "completed":

            # Legacy Supervity forms are not authoritative.
            # Only a decision submitted through the AutoPilot
            # Workbench may update or continue this local run.
            logger.warning(
                "Ignoring legacy Supervity human-review "
                "completion for Agent Run %s; a Workbench "
                "decision is required.",
                agent_run.id,
            )

            return


    # ========================================================
    # 5B. TRIGGER REAL SUPERVITY ORCHESTRATOR
    # ========================================================

    try:
        result = (
            await trigger_orchestrator_run(
                item_number=
                    request.item_number,

                notice_supplier_id=
                    request.notice_supplier_id,

                notice_type=
                    request.notice_type,

                notice_id=
                    request.notice_id,

                expedite_cost=
                    request.expedite_cost,

                on_event=
                    handle_supervity_event,
            )
        )

    except SupervityError as exc:
        agent_run.status = "failed"

        agent_run.completed_at = (
            datetime.now(timezone.utc)
        )

        db.commit()
        db.refresh(agent_run)

        raise HTTPException(
            status_code=502,
            detail=str(exc),
        ) from exc


    # ========================================================
    # 6. SUPERVITY COMPLETED
    # ========================================================

    agent_run.status = "completed"

    agent_run.result = result

    final_policy_context = build_policy_context(disruption_data, result)
    final_policies_passed, final_policy_results = evaluate_policies(
        db, agent_run.id, final_policy_context
    )
    result["policy_context"] = final_policy_context
    result["policy_results"] = final_policy_results
    agent_run.policy_context = final_policy_context
    agent_run.policy_context_stage = "post_operator"
    if not final_policies_passed:
        agent_run.status = "blocked_by_policy"


    # Use the final workflow run ID returned by Supervity.
    #
    # If Supervity doesn't provide it in the final result,
    # preserve the ID already captured from live SSE events.
    final_workflow_run_id = (
        result.get("workflow_run_id")
    )

    if final_workflow_run_id:
        agent_run.supervity_run_id = (
            str(final_workflow_run_id)
        )


    agent_run.completed_at = (
        datetime.now(timezone.utc)
    )

    db.commit()
    db.refresh(agent_run)


    # ========================================================
    # 7. SAVE OPERATOR RESULTS
    # ========================================================

    workflow_run = (
        result
        .get("result", {})
        .get("workflowRun", {})
    )

    activity_runs = (
        workflow_run.get(
            "activityRuns",
            [],
        )
    )

    operator_count = 0


    for activity in activity_runs:
        step_id = activity.get(
            "stepId"
        )

        # ----------------------------------------------------
        # Skip Human Review, conditions, consolidation nodes,
        # cleaners, and any other steps that aren't Operators.
        # ----------------------------------------------------

        if step_id not in OPERATOR_STEP_MAP:
            continue


        # ----------------------------------------------------
        # Only save actual workflow steps.
        #
        # Conditions may sometimes reuse step IDs.
        # ----------------------------------------------------

        if activity.get("kind") != "step":
            continue


        operator_result = OperatorResult(
            agent_run_id=
                agent_run.id,

            operator_name=
                OPERATOR_STEP_MAP[
                    step_id
                ],

            status=
                activity.get(
                    "status",
                    "unknown",
                ),

            output=
                activity,
        )

        db.add(operator_result)

        operator_count += 1


    db.commit()


    # ========================================================
    # 8. FINAL API RESPONSE
    # ========================================================

    return {
        "agent_run_id":
            agent_run.id,

        "disruption_db_id":
            disruption.id,

        "notice_id":
            request.notice_id,

        "status":
            agent_run.status,

        "workflow_run_id":
            agent_run.supervity_run_id,

        "policy_results":
            policy_results,

        "operators_saved":
            operator_count,

        "supervity_response":
            result,
    }
