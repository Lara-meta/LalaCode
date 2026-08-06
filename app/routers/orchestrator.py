"""
Orchestrator endpoint — triggers a real Supervity run for a given disruption.
TODO: Replace the auth import below with your actual verify_access dependency
and confirm it matches items.py's pattern exactly (same Depends() signature).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

# TODO: confirm these import paths against your actual project structure
from app.core.database import get_db  # or wherever your DB session dependency lives
from app.security import verify_access  # or wherever verify_access is defined

from app.services.supervity import trigger_orchestrator_run, SupervityError

router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"])


class OrchestratorRunRequest(BaseModel):
    disruption_id: str


@router.post("/run")
async def run_orchestrator(
    request: OrchestratorRunRequest,
    db: Session = Depends(get_db),
    user=Depends(verify_access),  # TODO: confirm this matches items.py's auth dependency
):
    """
    Triggers a real Supervity Orchestrator run for the given disruption.

    Done-condition per Task 9: this should return the same result Supervity's
    own UI shows for the same run.
    """
    try:
        result = await trigger_orchestrator_run(request.disruption_id)
    except SupervityError as e:
        raise HTTPException(status_code=502, detail=str(e))

    # TODO (Task 10, not this task): persist a row to agent_runs /
    # operator_results here once those tables exist via Alembic migration.

    return result