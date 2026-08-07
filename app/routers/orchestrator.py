"""
Orchestrator endpoint — triggers a real Supervity run for a given disruption.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..core.database import get_db
from ..models.disruption import Disruption
from ..models.agent_run import AgentRun
from ..services.supervity import trigger_orchestrator_run, SupervityError

router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"])


class OrchestratorRunRequest(BaseModel):
    disruption_id: str


@router.post("/run")
async def run_orchestrator(
    request: OrchestratorRunRequest,
    db: Session = Depends(get_db),
):
    # Find or create the disruption record
    disruption = (
        db.query(Disruption)
        .filter(Disruption.external_id == request.disruption_id)
        .first()
    )
    if disruption is None:
        disruption = Disruption(
            external_id=request.disruption_id,
            raw_data={"disruption_id": request.disruption_id},
        )
        db.add(disruption)
        db.commit()
        db.refresh(disruption)

    # Trigger the real Supervity run
    try:
        result = await trigger_orchestrator_run(request.disruption_id)
    except SupervityError as e:
        raise HTTPException(status_code=502, detail=str(e))

    # Persist the agent_runs row
    agent_run = AgentRun(
        disruption_id=disruption.id,
        status="running",  # Supervity's trigger is async — no final result yet
        result=result,  # stores the {"accepted": true, ...} ack for now
    )
    db.add(agent_run)
    db.commit()
    db.refresh(agent_run)

    return {
        "agent_run_id": agent_run.id,
        "disruption_id": disruption.id,
        "supervity_response": result,
    }