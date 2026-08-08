from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.policy import Policy
from ..models.policy_evaluation import PolicyEvaluation 


router = APIRouter(
    prefix="/policies",
    tags=["policies"],
)


# ============================================================
# REQUEST MODEL
# ============================================================

class PolicyUpdateRequest(BaseModel):
    threshold_value: Optional[float] = None
    enabled: Optional[bool] = None


# ============================================================
# GET ALL POLICIES
# ============================================================

@router.get("")
def get_policies(
    db: Session = Depends(get_db),
):
    policies = (
        db.query(Policy)
        .order_by(Policy.id.asc())
        .all()
    )

    return {
        "policies": [
            {
                "id": policy.id,
                "name": policy.name,
                "policy_type": policy.policy_type,
                "threshold_value": policy.threshold_value,
                "enabled": policy.enabled,
            }
            for policy in policies
        ]
    }

@router.get("/evaluations/recent")
def get_recent_policy_evaluations(
    limit: int = 20,
    db: Session = Depends(get_db),
):
    safe_limit = max(1, min(limit, 100))

    evaluations = (
        db.query(PolicyEvaluation)
        .order_by(
            PolicyEvaluation.evaluated_at.desc(),
            PolicyEvaluation.id.desc(),
        )
        .limit(safe_limit)
        .all()
    )

    return {
        "evaluations": [
            {
                "id": evaluation.id,
                "agent_run_id": evaluation.agent_run_id,
                "policy_name": evaluation.policy_name,
                "passed": evaluation.passed,
                "reason": evaluation.reason,
                "evaluated_at": evaluation.evaluated_at,
            }
            for evaluation in evaluations
        ]
    }
# ============================================================
# GET ONE POLICY
# ============================================================

@router.get("/{policy_id}")
def get_policy(
    policy_id: int,
    db: Session = Depends(get_db),
):
    policy = (
        db.query(Policy)
        .filter(Policy.id == policy_id)
        .first()
    )

    if policy is None:
        raise HTTPException(
            status_code=404,
            detail="Policy not found",
        )

    return {
        "id": policy.id,
        "name": policy.name,
        "policy_type": policy.policy_type,
        "threshold_value": policy.threshold_value,
        "enabled": policy.enabled,
    }


# ============================================================
# UPDATE POLICY
# ============================================================

@router.patch("/{policy_id}")
def update_policy(
    policy_id: int,
    request: PolicyUpdateRequest,
    db: Session = Depends(get_db),
):
    policy = (
        db.query(Policy)
        .filter(Policy.id == policy_id)
        .first()
    )

    if policy is None:
        raise HTTPException(
            status_code=404,
            detail="Policy not found",
        )

    # Update threshold only if it was actually provided.
    if "threshold_value" in request.model_fields_set:
        policy.threshold_value = request.threshold_value

    # Update enabled flag only if provided.
    if "enabled" in request.model_fields_set:
        policy.enabled = request.enabled

    db.commit()
    db.refresh(policy)

    return {
        "message": "Policy updated successfully",
        "policy": {
            "id": policy.id,
            "name": policy.name,
            "policy_type": policy.policy_type,
            "threshold_value": policy.threshold_value,
            "enabled": policy.enabled,
        },
    }