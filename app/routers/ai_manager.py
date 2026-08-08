import json
import os
import re
from datetime import datetime
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import String, cast, func, or_
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.agent_run import AgentRun
from ..models.disruption import Disruption
from ..models.operator_result import OperatorResult
from ..models.policy import Policy
from ..models.ai_chat_message import AIChatMessage
from ..services.supervity import SupervityError, trigger_operator_run


router = APIRouter(prefix="/ai", tags=["ai-manager"])

OPERATOR_ALIASES = {
    "impact mapper": "Impact Mapper",
    "alternative sourcing": "Alternative Sourcing",
    "expedite compliance": "Expedite Compliance",
    "log decision agent": "Log Decision Agent",
}
POLICY_TYPES = {
    "severity_threshold",
    "expedite_spend_limit",
    "contract_clause_block",
}


class ChatHistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[ChatHistoryItem] = Field(default_factory=list)
    context: dict = Field(default_factory=dict)
    conversation_id: str = Field(default="default", min_length=1, max_length=100)
    actor_email: str | None = Field(default=None, max_length=320)


def _save_exchange(db: Session, request: ChatRequest, answer: dict) -> dict:
    page = request.context.get("page") if isinstance(request.context, dict) else None
    db.add_all([
        AIChatMessage(conversation_id=request.conversation_id, role="user",
                      content=request.message.strip(), actor_email=request.actor_email,
                      page_context=str(page) if page else None),
        AIChatMessage(conversation_id=request.conversation_id, role="assistant",
                      content=answer["response"], actor_email=request.actor_email,
                      page_context=str(page) if page else None,
                      grounded=answer.get("grounded"), refused=answer.get("refused"),
                      citations=answer.get("citations"), tool_calls=answer.get("tool_calls")),
    ])
    db.commit()
    return answer


@router.get("/history")
def chat_history(limit: int = 200, db: Session = Depends(get_db)):
    messages = (db.query(AIChatMessage)
                .order_by(AIChatMessage.created_at.desc(), AIChatMessage.id.desc())
                .limit(max(1, min(limit, 500))).all())
    return {"messages": [{
        "id": item.id, "conversation_id": item.conversation_id, "role": item.role,
        "content": item.content, "actor_email": item.actor_email,
        "page_context": item.page_context, "grounded": item.grounded,
        "refused": item.refused, "citations": item.citations or [],
        "tool_calls": item.tool_calls or [],
        "created_at": item.created_at.isoformat() if item.created_at else None,
    } for item in reversed(messages)]}


def _history_message(item: AIChatMessage) -> dict:
    return {
        "id": item.id,
        "conversation_id": item.conversation_id,
        "role": item.role,
        "content": item.content,
        "actor_email": item.actor_email,
        "page_context": item.page_context,
        "grounded": item.grounded,
        "refused": item.refused,
        "citations": item.citations or [],
        "tool_calls": item.tool_calls or [],
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


@router.get("/history/conversations")
def conversation_history(
    q: str = Query(default="", max_length=200),
    actor: str = Query(default="", max_length=320),
    status: Literal["all", "grounded", "refused", "actions", "failures"] = "all",
    tool: str = Query(default="", max_length=80),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    matching = db.query(AIChatMessage.conversation_id)
    if q.strip():
        pattern = f"%{q.strip()}%"
        matching = matching.filter(or_(
            AIChatMessage.content.ilike(pattern),
            AIChatMessage.actor_email.ilike(pattern),
            AIChatMessage.page_context.ilike(pattern),
            AIChatMessage.conversation_id.ilike(pattern),
        ))
    if actor.strip():
        matching = matching.filter(AIChatMessage.actor_email.ilike(f"%{actor.strip()}%"))
    if date_from:
        matching = matching.filter(AIChatMessage.created_at >= date_from)
    if date_to:
        matching = matching.filter(AIChatMessage.created_at <= date_to)
    if status == "grounded":
        matching = matching.filter(AIChatMessage.grounded.is_(True))
    elif status == "refused":
        matching = matching.filter(AIChatMessage.refused.is_(True))
    elif status in {"actions", "failures"}:
        matching = matching.filter(AIChatMessage.tool_calls.isnot(None))
        if status == "failures":
            matching = matching.filter(cast(AIChatMessage.tool_calls, String).ilike('%"error"%'))
    if tool.strip():
        matching = matching.filter(cast(AIChatMessage.tool_calls, String).ilike(f"%{tool.strip()}%"))

    matching_ids = matching.distinct().subquery()
    summaries = (
        db.query(
            AIChatMessage.conversation_id.label("conversation_id"),
            func.max(AIChatMessage.created_at).label("updated_at"),
            func.count(AIChatMessage.id).label("message_count"),
        )
        .filter(AIChatMessage.conversation_id.in_(matching_ids))
        .group_by(AIChatMessage.conversation_id)
    )
    total = summaries.count()
    page_rows = (
        summaries.order_by(func.max(AIChatMessage.created_at).desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    ids = [row.conversation_id for row in page_rows]
    page_messages = (
        db.query(AIChatMessage)
        .filter(AIChatMessage.conversation_id.in_(ids))
        .order_by(AIChatMessage.created_at.asc(), AIChatMessage.id.asc())
        .all()
        if ids else []
    )
    grouped: dict[str, list[AIChatMessage]] = {conversation_id: [] for conversation_id in ids}
    for message in page_messages:
        grouped.setdefault(message.conversation_id, []).append(message)

    metric_messages = (
        db.query(AIChatMessage)
        .filter(AIChatMessage.conversation_id.in_(matching_ids))
        .filter(AIChatMessage.role == "assistant")
        .all()
    )
    actions = 0
    failures = 0
    refusals = 0
    grounded = 0
    for message in metric_messages:
        calls = message.tool_calls if isinstance(message.tool_calls, list) else []
        actions += len(calls)
        refusals += int(bool(message.refused))
        grounded += int(bool(message.grounded))
        for call in calls:
            result = call.get("result") if isinstance(call, dict) else None
            if isinstance(result, dict) and (
                result.get("error")
                or result.get("created") is False
                or result.get("triggered") is False
            ):
                failures += 1

    conversations = []
    for row in page_rows:
        items = grouped.get(row.conversation_id, [])
        first_user = next((item for item in items if item.role == "user"), None)
        title = (first_user.content.strip()[:58] if first_user else "Untitled conversation")
        conversations.append({
            "id": row.conversation_id,
            "title": title,
            "actor": first_user.actor_email if first_user and first_user.actor_email else "Unknown user",
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            "message_count": row.message_count,
            "messages": [_history_message(item) for item in items],
        })

    assistant_count = len(metric_messages)
    return {
        "conversations": conversations,
        "total": total,
        "limit": limit,
        "offset": offset,
        "metrics": {
            "conversations": total,
            "actions": actions,
            "failures": failures,
            "grounded_answers": grounded,
            "refusal_rate": round((refusals / assistant_count * 100), 1) if assistant_count else 0,
        },
    }


def _workflow_id(result: OperatorResult) -> str | None:
    output = result.output if isinstance(result.output, dict) else {}
    persisted_id = output.get("workflow_id")
    if persisted_id:
        return str(persisted_id)
    display = (output.get("outputs") or {}).get("displayData") or {}
    match = re.search(
        r"/workflow/([0-9a-f-]{36})/runs/",
        str(display.get("html") or ""),
        re.I,
    )
    return match.group(1) if match else None


def _run_record(db: Session, run_id: int) -> tuple[AgentRun, Disruption | None] | None:
    return (
        db.query(AgentRun, Disruption)
        .outerjoin(Disruption, AgentRun.disruption_id == Disruption.id)
        .filter(AgentRun.id == run_id)
        .first()
    )


def _serialize_run(db: Session, run: AgentRun, disruption: Disruption | None) -> dict:
    raw = disruption.raw_data if disruption and isinstance(disruption.raw_data, dict) else {}
    operators = (
        db.query(OperatorResult)
        .filter(OperatorResult.agent_run_id == run.id)
        .order_by(OperatorResult.id.asc())
        .all()
    )
    return {
        "id": run.id,
        "status": run.status,
        "supervity_run_id": run.supervity_run_id,
        "triggered_at": run.triggered_at.isoformat() if run.triggered_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "disruption": {
            "id": disruption.id if disruption else None,
            "notice_id": disruption.external_id if disruption else None,
            "item_number": raw.get("item_number"),
            "supplier_id": raw.get("notice_supplier_id"),
            "notice_type": raw.get("notice_type"),
            "raw_data": raw,
        },
        "operators": [
            {"id": op.id, "name": op.operator_name, "status": op.status}
            for op in operators
        ],
    }


TOOLS = [
    {
        "type": "function",
        "name": "get_recent_runs",
        "description": "Read recent persisted orchestrator runs from AutoPilot.",
        "parameters": {
            "type": "object",
            "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 20}},
            "required": ["limit"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "get_run",
        "description": "Read one real orchestrator run and its disruption/operator records.",
        "parameters": {
            "type": "object",
            "properties": {"run_id": {"type": "integer", "minimum": 1}},
            "required": ["run_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "list_policies",
        "description": "Read all currently persisted AutoPilot policies.",
        "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
        "strict": True,
    },
    {
        "type": "function",
        "name": "create_policy",
        "description": "Create a real policy only after the user explicitly confirms the complete policy details.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "minLength": 1},
                "policy_type": {"type": "string", "enum": sorted(POLICY_TYPES)},
                "threshold_value": {"type": ["number", "null"]},
                "enabled": {"type": "boolean"},
                "confirmed": {"type": "boolean"},
            },
            "required": ["name", "policy_type", "threshold_value", "enabled", "confirmed"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "trigger_operator",
        "description": "Trigger a real supported Supervity operator for an existing run, only on an explicit user request.",
        "parameters": {
            "type": "object",
            "properties": {
                "operator_name": {"type": "string", "enum": list(OPERATOR_ALIASES.values())},
                "run_id": {"type": "integer", "minimum": 1},
            },
            "required": ["operator_name", "run_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
]


INSTRUCTIONS = """You are AutoPilot AI Manager, an operations copilot backed by the application's real database.
Use tools for every claim about runs, disruptions, operators, or policies. Never invent records, IDs, status, values, or outcomes.
If the tools do not support a factual request or return no evidence, clearly say that the available AutoPilot records do not support an answer.
You may explain general concepts and help users formulate actions, but distinguish general guidance from persisted facts.
Guide multi-step tasks conversationally. Ask exactly ONE short question per response. Never present a questionnaire or ask for several fields at once. Reuse all details already supplied in the conversation and do not ask for them again.
For policy creation:
1. Understand the business intent in plain language. Infer severity_threshold for severity-score rules, expedite_spend_limit for monetary expedite limits, and contract_clause_block for contract-clause blocking. Do not ask the user to choose an internal identifier. If intent is genuinely ambiguous, ask one plain-language question about what should be controlled.
2. Gather only the missing fields in this order: purpose/type, threshold when that type needs one, human-friendly name, then whether it should be active immediately. Ask only the next missing question.
3. Accept natural answers such as "$5,000", "active now", or "leave it disabled". Never ask for True/False.
4. When all fields are known, show a compact Policy draft with Name, Purpose, Threshold (if applicable), and Initial state. End with exactly one confirmation question such as "Create this policy?"
5. The draft and confirmation must be separate turns. Never call create_policy while gathering details or in the same response that first presents the draft. Call it only after the user's latest message explicitly confirms the previously shown draft. Set confirmed=true only then.
If an action request other than policy creation is missing multiple details, also ask for only the single most important missing detail.
Call trigger_operator only when the user's latest message explicitly asks to trigger or re-trigger a named operator for a specific run. Never trigger based on an ambiguous suggestion.
After an action, report the actual tool result. Be concise and natural; do not mention internal prompting."""


def _recent_runs(db: Session, limit: int) -> dict:
    rows = (
        db.query(AgentRun, Disruption)
        .outerjoin(Disruption, AgentRun.disruption_id == Disruption.id)
        .order_by(AgentRun.id.desc())
        .limit(max(1, min(limit, 20)))
        .all()
    )
    return {"runs": [_serialize_run(db, run, disruption) for run, disruption in rows]}


async def _execute_tool(
    name: str,
    args: dict,
    db: Session,
    latest_message: str,
    history: list[ChatHistoryItem],
) -> dict:
    if name == "get_recent_runs":
        return _recent_runs(db, args["limit"])
    if name == "get_run":
        row = _run_record(db, args["run_id"])
        return {"found": bool(row), "run": _serialize_run(db, *row) if row else None}
    if name == "list_policies":
        policies = db.query(Policy).order_by(Policy.id.asc()).all()
        return {"policies": [
            {"id": p.id, "name": p.name, "policy_type": p.policy_type,
             "threshold_value": p.threshold_value, "enabled": p.enabled}
            for p in policies
        ]}
    if name == "create_policy":
        explicit = bool(re.search(
            r"\b(confirm|confirmed|yes|proceed|approved|looks good)\b|"
            r"\b(create|save|apply)\s+(it|this|that)\b",
            latest_message,
            re.I,
        ))
        prior_assistant = [item.content for item in history if item.role == "assistant"]
        policy_name = str(args.get("name") or "").strip().lower()
        has_prior_draft = any(
            "policy draft" in content.lower()
            and (not policy_name or policy_name in content.lower())
            and ("create this policy" in content.lower() or "confirm" in content.lower())
            for content in prior_assistant
        )
        if not args.get("confirmed") or not explicit or not has_prior_draft:
            return {
                "created": False,
                "error": (
                    "Creation requires a complete policy draft in the prior "
                    "assistant message and explicit confirmation in a later turn."
                ),
            }
        if args["policy_type"] not in POLICY_TYPES:
            return {"created": False, "error": "Unsupported policy type."}
        duplicate = db.query(Policy).filter(Policy.name == args["name"]).first()
        if duplicate:
            return {"created": False, "error": "A policy with this name already exists.", "policy_id": duplicate.id}
        policy = Policy(
            name=args["name"], policy_type=args["policy_type"],
            threshold_value=args["threshold_value"], enabled=args["enabled"],
        )
        db.add(policy)
        db.commit()
        db.refresh(policy)
        return {"created": True, "policy": {"id": policy.id, "name": policy.name,
                "policy_type": policy.policy_type, "threshold_value": policy.threshold_value,
                "enabled": policy.enabled}}
    if name == "trigger_operator":
        explicit = bool(re.search(r"\b(trigger|retrigger|re-trigger|run|rerun|re-run)\b", latest_message, re.I))
        if not explicit:
            return {"triggered": False, "error": "An explicit trigger request is required."}
        row = _run_record(db, args["run_id"])
        if not row:
            return {"triggered": False, "error": f"Run {args['run_id']} does not exist."}
        agent_run, disruption = row
        raw = disruption.raw_data if disruption and isinstance(disruption.raw_data, dict) else {}
        inputs = {"item_number": raw.get("item_number"), "notice_supplier_id": raw.get("notice_supplier_id"),
                  "notice_type": raw.get("notice_type"), "notice_id": disruption.external_id if disruption else None}
        missing = [key for key, value in inputs.items() if not value]
        if missing:
            return {"triggered": False, "error": "Source run is missing: " + ", ".join(missing)}
        prior = (db.query(OperatorResult).filter(OperatorResult.operator_name == args["operator_name"])
                 .order_by(OperatorResult.id.desc()).first())
        workflow_id = _workflow_id(prior) if prior else None
        if not workflow_id:
            return {"triggered": False, "error": "No persisted workflow ID exists for this operator."}
        try:
            result = await trigger_operator_run(workflow_id, {key: str(value) for key, value in inputs.items()})
        except SupervityError as exc:
            return {"triggered": False, "error": str(exc)}
        saved = OperatorResult(agent_run_id=agent_run.id, operator_name=args["operator_name"],
                               status="completed", output={"retriggered_by": "ai_manager",
                               "source_run_id": agent_run.id, "workflow_id": workflow_id, "execution": result})
        db.add(saved)
        db.commit()
        db.refresh(saved)
        return {"triggered": True, "operator_result_id": saved.id,
                "workflow_run_id": result.get("workflow_run_id"), "source_run_id": agent_run.id}
    return {"error": f"Unknown tool: {name}"}


def _chat_tools() -> list[dict]:
    """Convert Responses-style definitions to OpenAI-compatible chat tools."""
    converted = []
    for tool in TOOLS:
        function = {
            "name": tool["name"],
            "description": tool["description"],
            "parameters": tool["parameters"],
        }
        if "strict" in tool:
            function["strict"] = tool["strict"]
        converted.append({"type": "function", "function": function})
    return converted


@router.post("/chat")
async def chat(request: ChatRequest, db: Session = Depends(get_db)):
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail=(
            "AI Manager needs OPENROUTER_API_KEY in the backend environment. "
            "Add a rotated OpenRouter key to .env and restart the backend."
        ))

    conversation: list[dict[str, Any]] = [
        {"role": "system", "content": INSTRUCTIONS},
        *[
        {"role": item.role, "content": item.content}
        for item in request.history[-12:]
        ],
    ]
    conversation.append({"role": "user", "content": request.message.strip()})
    payload: dict[str, Any] = {
        "model": os.getenv(
            "OPENROUTER_AI_MANAGER_MODEL",
            "openrouter/free",
        ),
        "messages": conversation,
        "tools": _chat_tools(),
        "tool_choice": "auto",
        "parallel_tool_calls": False,
    }
    tool_calls = []

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90.0)) as client:
            for _ in range(6):
                response = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": os.getenv("FRONTEND_URL", "http://localhost:3001"),
                        "X-OpenRouter-Title": "AutoPilot AI Manager",
                    },
                    json=payload,
                )
                if response.is_error:
                    detail = response.json().get("error", {}).get("message", response.text)
                    raise HTTPException(
                        status_code=502,
                        detail=f"OpenRouter request failed: {detail}",
                    )
                data = response.json()
                choices = data.get("choices") or []
                if not choices:
                    raise HTTPException(status_code=502, detail="OpenRouter returned no choices.")
                message = choices[0].get("message") or {}
                calls = message.get("tool_calls") or []
                if not calls:
                    text = str(message.get("content") or "").strip()
                    if not text:
                        raise HTTPException(status_code=502, detail="The AI model returned no answer.")
                    return _save_exchange(db, request, {
                        "response": text,
                        "grounded": bool(tool_calls),
                        "refused": not bool(tool_calls) and bool(re.search(
                            r"(cannot|can't|can’t).*(available|records|data|evidence)|do not have.*data",
                            text, re.I | re.S)),
                        "citations": [], "tool_calls": tool_calls,
                    })

                payload["messages"].append(message)
                for call in calls:
                    try:
                        function = call.get("function") or {}
                        args = json.loads(function.get("arguments") or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    name = function.get("name", "")
                    result = await _execute_tool(
                        name,
                        args,
                        db,
                        request.message,
                        request.history,
                    )
                    tool_calls.append({"id": call["id"], "name": name,
                                       "args": args, "result": result})
                    payload["messages"].append({
                        "role": "tool",
                        "tool_call_id": call["id"],
                        "name": name,
                        "content": json.dumps(result, default=str),
                    })
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach OpenRouter: {exc}",
        ) from exc

    raise HTTPException(status_code=502, detail="AI Manager exceeded the tool-call limit.")
