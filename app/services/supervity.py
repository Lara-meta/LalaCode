"""
Service layer for calling the Supervity Workflow API.

This implementation follows the API contract shown in
Supervity Operator Info -> API Details.
"""

import json
import os
from typing import Any, Awaitable, Callable, Optional

import httpx


# ============================================================
# CONFIGURATION
# ============================================================

SUPERVITY_API_KEY = os.getenv(
    "SUPERVITY_API_KEY"
)

SUPERVITY_WORKFLOW_ID = os.getenv(
    "SUPERVITY_WORKFLOW_ID"
)


SUPERVITY_ACTIVE_ORG = os.getenv(
    "SUPERVITY_ACTIVE_ORG",
    "lalaCode",
)

SUPERVITY_ACTIVE_TEAM = os.getenv(
    "SUPERVITY_ACTIVE_TEAM",
    "lalaCode",
)

SUPERVITY_TEAM_KEY = os.getenv(
    "SUPERVITY_TEAM_KEY",
    "lalaCode",
)

SUPERVITY_USER_TIMEZONE = os.getenv(
    "SUPERVITY_USER_TIMEZONE",
    "Asia/Kuala_Lumpur",
)


# Supervity API host shown in the generated API example.
SUPERVITY_BASE_URL = (
    "https://auto-workflow-api.supervity.ai/api/v1"
)


if not SUPERVITY_API_KEY:
    raise RuntimeError(
        "SUPERVITY_API_KEY must be set in .env"
    )

if not SUPERVITY_WORKFLOW_ID:
    raise RuntimeError(
        "SUPERVITY_WORKFLOW_ID must be set in .env"
    )


# ============================================================
# ERRORS
# ============================================================

class SupervityError(Exception):
    """
    Raised when communication with Supervity fails.
    """

    pass


# ============================================================
# HEADERS
# ============================================================

def _headers(
    stream: bool = False,
) -> dict[str, str]:
    """
    Build the headers required by Supervity.

    Streaming endpoints use:
        Accept: text/event-stream

    Normal endpoints use:
        Accept: application/json
    """

    headers = {
        "Authorization":
            f"Bearer {SUPERVITY_API_KEY}",

        "x-source":
            "external",

        "x-active-org":
            SUPERVITY_ACTIVE_ORG,

        "x-active-team":
            SUPERVITY_ACTIVE_TEAM,

        "x-teamKey":
            SUPERVITY_TEAM_KEY,

        "x-user-timezone":
            SUPERVITY_USER_TIMEZONE,
    }

    if stream:
        headers["Accept"] = (
            "text/event-stream"
        )

    else:
        headers["Accept"] = (
            "application/json"
        )

    return headers


# ============================================================
# HELPERS
# ============================================================

def _extract_run_id(
    payload: Any,
) -> Optional[str]:
    """
    Try to locate a Supervity workflow run ID.

    Different SSE event types can expose the run ID
    at different levels.
    """

    if not isinstance(payload, dict):
        return None


    direct_keys = [
        "workflowRunId",
        "workflow_run_id",
        "runId",
        "run_id",
    ]


    # --------------------------------------------------------
    # Direct payload
    # --------------------------------------------------------

    for key in direct_keys:
        value = payload.get(key)

        if value:
            return str(value)


    # --------------------------------------------------------
    # content object
    # --------------------------------------------------------

    content = payload.get(
        "content"
    )

    if isinstance(content, dict):
        for key in direct_keys:
            value = content.get(key)

            if value:
                return str(value)


    # --------------------------------------------------------
    # workflowRun object
    # --------------------------------------------------------

    workflow_run = payload.get(
        "workflowRun"
    )

    if isinstance(workflow_run, dict):
        for key in [
            "id",
            "workflowRunId",
            "workflow_run_id",
            "runId",
        ]:
            value = workflow_run.get(
                key
            )

            if value:
                return str(value)


    return None


def _parse_sse_payload(
    raw_data: str,
) -> Any:
    """
    Parse the data portion of a Server-Sent Event.

    Supervity normally sends JSON.

    If the value is not JSON, preserve the raw text
    rather than crashing.
    """

    try:
        return json.loads(
            raw_data
        )

    except json.JSONDecodeError:
        return {
            "raw": raw_data,
        }


# ============================================================
# SUPERVITY EVENT CALLBACK TYPE
# ============================================================

SupervityEventCallback = Callable[
    [dict[str, Any]],
    Awaitable[None],
]


# ============================================================
# TRIGGER ORCHESTRATOR
# ============================================================

async def trigger_orchestrator_run(
    item_number: str,
    notice_supplier_id: str,
    notice_type: str,
    notice_id: str,
    on_event: Optional[
        SupervityEventCallback
    ] = None,
) -> dict[str, Any]:
    """
    Trigger the real Supervity Orchestrator.

    The endpoint streams workflow events using
    Server-Sent Events (SSE).

    Supervity requires multipart/form-data fields:

        workflowId
        inputs[item_number]
        inputs[notice_supplier_id]
        inputs[notice_type]
        inputs[notice_id]

    on_event allows our FastAPI orchestrator to react
    to live events such as:

        Human Review -> waiting
        Human Review -> completed

    without waiting until the entire workflow finishes.
    """

    # ========================================================
    # MULTIPART FORM DATA
    # ========================================================

    multipart_data = {
        "workflowId": (
            None,
            SUPERVITY_WORKFLOW_ID,
        ),

        "inputs[item_number]": (
            None,
            str(item_number),
        ),

        "inputs[notice_supplier_id]": (
            None,
            str(notice_supplier_id),
        ),

        "inputs[notice_type]": (
            None,
            str(notice_type),
        ),

        "inputs[notice_id]": (
            None,
            str(notice_id),
        ),
    }


    # ========================================================
    # TIMEOUT
    # ========================================================

    # Human Review can pause the workflow while the admin
    # makes a decision, so the read timeout is intentionally
    # much longer than a normal API request.
    timeout = httpx.Timeout(
        connect=30.0,
        read=900.0,
        write=30.0,
        pool=30.0,
    )


    # ========================================================
    # STREAM STATE
    # ========================================================

    current_event: Optional[str] = None

    workflow_run_id: Optional[str] = None

    received_events: list[
        dict[str, Any]
    ] = []


    endpoint = (
        f"{SUPERVITY_BASE_URL}"
        "/workflow-runs/execute/stream"
    )


    # ========================================================
    # CALL SUPERVITY
    # ========================================================

    try:
        async with httpx.AsyncClient(
            timeout=timeout,
        ) as client:

            async with client.stream(
                "POST",
                endpoint,
                headers=_headers(
                    stream=True
                ),
                files=multipart_data,
            ) as response:


                # ============================================
                # HTTP ERROR
                # ============================================

                if response.status_code >= 400:
                    body = (
                        await response.aread()
                    )

                    error_text = body.decode(
                        errors="replace"
                    )

                    raise SupervityError(
                        "Supervity returned "
                        f"{response.status_code}: "
                        f"{error_text}"
                    )


                # ============================================
                # READ SSE STREAM
                # ============================================

                async for line in (
                    response.aiter_lines()
                ):

                    if line is None:
                        continue


                    line = line.strip()


                    # ----------------------------------------
                    # Empty line / keep-alive
                    # ----------------------------------------

                    if not line:
                        continue


                    # ----------------------------------------
                    # SSE heartbeat/comment
                    # ----------------------------------------

                    if line.startswith(":"):
                        continue


                    # ----------------------------------------
                    # SSE event name
                    #
                    # Example:
                    #
                    # event: activity-run
                    # ----------------------------------------

                    if line.startswith("event:"):
                        current_event = (
                            line[
                                len("event:"):
                            ]
                            .strip()
                        )

                        continue


                    # ----------------------------------------
                    # SSE event data
                    #
                    # Example:
                    #
                    # data: {"content": {...}}
                    # ----------------------------------------

                    if line.startswith("data:"):

                        raw_data = (
                            line[
                                len("data:"):
                            ]
                            .strip()
                        )


                        payload = (
                            _parse_sse_payload(
                                raw_data
                            )
                        )


                        # ------------------------------------
                        # Capture workflow run ID
                        # ------------------------------------

                        found_run_id = (
                            _extract_run_id(
                                payload
                            )
                        )

                        if found_run_id:
                            workflow_run_id = (
                                found_run_id
                            )


                        # ------------------------------------
                        # Build event object
                        # ------------------------------------

                        event_payload = {
                            "event":
                                current_event,

                            "data":
                                payload,
                        }


                        received_events.append(
                            event_payload
                        )


                        # ------------------------------------
                        # Send event to FastAPI orchestrator
                        # ------------------------------------

                        if on_event is not None:
                            await on_event(
                                event_payload
                            )


                        # ====================================
                        # FINAL SUCCESSFUL RESULT
                        # ====================================

                        if (
                            current_event
                            == "result"
                        ):

                            final_run_id = (
                                _extract_run_id(
                                    payload
                                )
                                or workflow_run_id
                            )

                            return {
                                "workflow_run_id":
                                    final_run_id,

                                "status":
                                    "completed",

                                "result":
                                    payload,

                                "events":
                                    received_events,
                            }


                        # ====================================
                        # WORKFLOW FAILURE
                        # ====================================

                        if (
                            current_event
                            == "error"
                        ):
                            raise SupervityError(
                                "Supervity workflow "
                                "execution failed: "
                                f"{payload}"
                            )


    # ========================================================
    # TIMEOUT ERROR
    # ========================================================

    except httpx.TimeoutException as exc:
        raise SupervityError(
            "Timed out waiting for the "
            "Supervity workflow to complete. "
            f"Workflow run ID: "
            f"{workflow_run_id}"
        ) from exc


    # ========================================================
    # CONNECTION ERROR
    # ========================================================

    except httpx.RequestError as exc:
        raise SupervityError(
            "Could not connect to Supervity: "
            f"{exc}"
        ) from exc


    # ========================================================
    # STREAM CLOSED WITHOUT RESULT
    # ========================================================

    raise SupervityError(
        "Supervity stream ended without "
        "returning a final result. "
        f"Workflow run ID: "
        f"{workflow_run_id}"
    )


# ============================================================
# GET ONE SUPERVITY RUN
# ============================================================

async def get_run_result(
    run_id: str,
) -> dict[str, Any]:
    """
    Fetch one existing Supervity workflow run.

    This is not currently used by the primary execution
    flow because execute/stream waits for the result.

    It is retained for debugging and future recovery logic.
    """

    endpoint = (
        f"{SUPERVITY_BASE_URL}"
        f"/workflow-runs/{run_id}"
    )


    try:
        async with httpx.AsyncClient(
            timeout=30.0,
        ) as client:

            response = await client.get(
                endpoint,
                headers=_headers(),
            )

    except httpx.RequestError as exc:
        raise SupervityError(
            "Could not connect to Supervity "
            f"while fetching run {run_id}: "
            f"{exc}"
        ) from exc


    if response.status_code >= 400:
        raise SupervityError(
            f"Failed to fetch run {run_id}: "
            f"{response.status_code} "
            f"{response.text}"
        )


    try:
        return response.json()

    except json.JSONDecodeError as exc:
        raise SupervityError(
            "Supervity returned a non-JSON "
            "response while fetching run "
            f"{run_id}: "
            f"{response.text}"
        ) from exc


# ============================================================
# LIST SUPERVITY RUNS
# ============================================================

async def list_workflow_runs() -> dict[str, Any]:
    """
    Fetch recent workflow runs.

    Currently used only by the debug endpoint:

        GET /api/orchestrator/runs/debug
    """

    endpoint = (
        f"{SUPERVITY_BASE_URL}"
        "/workflow-runs"
    )


    params = {
        "workflowId":
            SUPERVITY_WORKFLOW_ID,

        "page":
            1,

        "limit":
            20,
    }


    try:
        async with httpx.AsyncClient(
            timeout=30.0,
        ) as client:

            response = await client.get(
                endpoint,
                headers=_headers(),
                params=params,
            )

    except httpx.RequestError as exc:
        raise SupervityError(
            "Could not connect to Supervity "
            "while listing workflow runs: "
            f"{exc}"
        ) from exc


    if response.status_code >= 400:
        raise SupervityError(
            "Failed to list workflow runs: "
            f"{response.status_code} "
            f"{response.text}"
        )


    try:
        return response.json()

    except json.JSONDecodeError as exc:
        raise SupervityError(
            "Supervity returned a non-JSON "
            "response while listing runs: "
            f"{response.text}"
        ) from exc