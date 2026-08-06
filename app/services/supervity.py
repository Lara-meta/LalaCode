"""
Service layer for calling the Supervity Workflow API.
Confirmed against https://auto.supervity.ai/docs/api-docs/workflow-runs
and live testing (Aug 2026).
"""
import os
import httpx
import json
from typing import Any

SUPERVITY_API_KEY = os.getenv("SUPERVITY_API_KEY")
SUPERVITY_ORG_KEY = os.getenv("SUPERVITY_ORG_KEY")
SUPERVITY_WORKFLOW_ID = os.getenv("SUPERVITY_WORKFLOW_ID")
SUPERVITY_BASE_URL = "https://auto.supervity.ai/api/v1"

if not all([SUPERVITY_API_KEY, SUPERVITY_ORG_KEY, SUPERVITY_WORKFLOW_ID]):
    raise RuntimeError(
        "SUPERVITY_API_KEY, SUPERVITY_ORG_KEY, and SUPERVITY_WORKFLOW_ID "
        "must be set in .env"
    )


class SupervityError(Exception):
    pass


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {SUPERVITY_API_KEY}",
        "x-source": "external",
        "x-active-org": SUPERVITY_ORG_KEY,
    }


async def trigger_orchestrator_run(disruption_id: str) -> dict[str, Any]:
    """
    Triggers a Supervity workflow run for a given disruption.

    NOTE: Docs describe this endpoint as synchronous/blocking, but live
    testing shows it returns an immediate {"accepted": true} acknowledgment
    with no run ID. Until Supervity's list/status endpoints are confirmed
    working, this function returns that acknowledgment as-is.

    TODO: once GET /api/v1/workflow-runs (currently erroring server-side)
    is working, extend this to poll for the actual result using the
    workflowId + a timestamp/ordering to find the matching run, since no
    runId is returned at trigger time.
    """
    form_data = {
        "workflowId": SUPERVITY_WORKFLOW_ID,
        "inputs": json.dumps({"disruption_id": disruption_id}),
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{SUPERVITY_BASE_URL}/workflow-runs/execute",
            data=form_data,
            headers=_headers(),
        )

    if response.status_code >= 400:
        raise SupervityError(
            f"Supervity returned {response.status_code}: {response.text}"
        )

    return response.json()


async def get_run_result(run_id: str) -> dict[str, Any]:
    """
    Fetches a single run's full result, once run_id is known.
    Confirmed endpoint shape from docs: GET /api/v1/workflow-runs/:runId
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{SUPERVITY_BASE_URL}/workflow-runs/{run_id}",
            headers=_headers(),
        )

    if response.status_code >= 400:
        raise SupervityError(
            f"Failed to fetch run {run_id}: {response.status_code} {response.text}"
        )

    return response.json()