import csv
import io
from datetime import datetime
from types import SimpleNamespace
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.agent_run import AgentRun
from ..models.disruption import Disruption
from ..models.policy import Policy
from ..models.policy_evaluation import PolicyEvaluation
from ..models.policy_version import PolicyAudit, PolicyVersion
from ..services.policy_engine import evaluate_policy, policy_snapshot
from ..security import get_current_user


router = APIRouter(prefix="/policies", tags=["policies"])
POLICY_TYPES = {"severity_threshold", "expedite_spend_limit", "contract_clause_block"}
STATUSES = {"draft", "test", "active", "scheduled", "archived"}
OPERATORS = {"gt", "gte", "lt", "lte", "eq", "contains", "not_empty"}


def require_admin(user: dict | None = Depends(get_current_user)) -> dict:
    if not user:
        raise HTTPException(401, "Authentication required")
    roles = user.get("realm_access", {}).get("roles", [])
    if "admin" not in roles:
        raise HTTPException(403, "Administrator role required")
    return user


class PolicyWrite(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    policy_type: str
    description: str | None = Field(default=None, max_length=500)
    threshold_value: float | None = None
    field_name: str | None = Field(default=None, max_length=100)
    operator: str = "gt"
    unit: str | None = Field(default=None, max_length=30)
    action: Literal["block"] = "block"
    scope: dict[str, Any] = Field(default_factory=dict)
    fail_mode: Literal["open", "closed"] = "closed"
    priority: int = Field(default=100, ge=1, le=1000)
    effective_from: datetime | None = None
    effective_until: datetime | None = None
    status: str = "draft"
    actor: str | None = Field(default=None, max_length=320)
    change_reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_rule(self):
        if self.policy_type not in POLICY_TYPES:
            raise ValueError("Unsupported policy type")
        if self.status not in STATUSES:
            raise ValueError("Unsupported lifecycle status")
        if self.operator not in OPERATORS:
            raise ValueError("Unsupported operator")
        if self.operator not in {"not_empty"} and self.threshold_value is None:
            raise ValueError("This operator requires a threshold")
        if self.effective_from and self.effective_until and self.effective_from >= self.effective_until:
            raise ValueError("Expiry must be after the effective date")
        return self


class PolicyPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    threshold_value: float | None = None
    field_name: str | None = Field(default=None, max_length=100)
    operator: str | None = None
    unit: str | None = Field(default=None, max_length=30)
    scope: dict[str, Any] | None = None
    fail_mode: Literal["open", "closed"] | None = None
    priority: int | None = Field(default=None, ge=1, le=1000)
    effective_from: datetime | None = None
    effective_until: datetime | None = None
    actor: str | None = Field(default=None, max_length=320)
    change_reason: str = Field(min_length=2, max_length=500)


class LifecycleRequest(BaseModel):
    actor: str | None = None
    reason: str = Field(min_length=2, max_length=500)
    effective_from: datetime | None = None


class SimulationRequest(BaseModel):
    policy_id: int | None = None
    proposed: dict[str, Any] | None = None
    run_ids: list[int] = Field(default_factory=list, max_length=200)
    limit: int = Field(default=50, ge=1, le=200)


def _serialize(policy: Policy) -> dict:
    rule = policy_snapshot(policy)
    for key in ("effective_from", "effective_until"):
        if rule.get(key):
            rule[key] = rule[key].isoformat()
    return {
        "id": policy.id, **rule,
        "enabled": bool(policy.enabled),
        "created_by": policy.created_by, "updated_by": policy.updated_by,
        "created_at": policy.created_at.isoformat() if policy.created_at else None,
        "updated_at": policy.updated_at.isoformat() if policy.updated_at else None,
        "last_simulated_version": policy.last_simulated_version,
        "last_simulated_at": policy.last_simulated_at.isoformat() if policy.last_simulated_at else None,
        "last_simulation_summary": policy.last_simulation_summary,
        "plain_language": _plain_language(policy),
    }


def _plain_language(policy: Policy) -> str:
    field = (policy.field_name or policy.policy_type).replace("_", " ")
    symbols = {"gt": "greater than", "gte": "at least", "lt": "less than", "lte": "at most", "eq": "equal to", "contains": "contains", "not_empty": "is present"}
    value = "" if policy.operator == "not_empty" else f" {policy.threshold_value:g}" if policy.threshold_value is not None else ""
    if policy.unit == "USD" and policy.threshold_value is not None:
        value = f" ${policy.threshold_value:,.2f}"
    elif policy.unit == "score_10" and policy.threshold_value is not None:
        value = f" {policy.threshold_value:g}/10"
    return f"Block when {field} is {symbols.get(policy.operator, policy.operator)}{value}."


def _snapshot(policy: Policy) -> dict:
    snapshot = _serialize(policy)
    snapshot.pop("plain_language", None)
    return snapshot


def _record_change(db: Session, policy: Policy, action: str, actor: str | None,
                   reason: str, previous: dict | None, from_version: int | None) -> None:
    if previous is not None:
        db.add(PolicyVersion(policy_id=policy.id, version=from_version or 1,
                             snapshot=previous, change_reason=reason, changed_by=actor))
    db.add(PolicyAudit(policy_id=policy.id, action=action, from_version=from_version,
                       to_version=policy.version, actor=actor, reason=reason,
                       changes={"before": previous, "after": _snapshot(policy)}))


def _get(db: Session, policy_id: int) -> Policy:
    policy = db.query(Policy).filter(Policy.id == policy_id).first()
    if not policy:
        raise HTTPException(404, "Policy not found")
    return policy


@router.get("")
def get_policies(status: str | None = None, search: str | None = None,
                 db: Session = Depends(get_db)):
    query = db.query(Policy)
    if status and status != "all":
        query = query.filter(Policy.status == status)
    if search:
        query = query.filter(or_(Policy.name.ilike(f"%{search}%"), Policy.description.ilike(f"%{search}%")))
    return {"policies": [_serialize(p) for p in query.order_by(Policy.priority, Policy.id).all()]}


@router.post("")
def create_policy(request: PolicyWrite, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    if db.query(Policy).filter(func.lower(Policy.name) == request.name.lower()).first():
        raise HTTPException(409, "A policy with this name already exists")
    data = request.model_dump(exclude={"actor", "change_reason"})
    policy = Policy(**data, enabled=request.status == "active", version=1,
                    created_by=request.actor, updated_by=request.actor)
    db.add(policy); db.flush()
    _record_change(db, policy, "created", request.actor, request.change_reason or "Policy created", None, None)
    db.commit(); db.refresh(policy)
    return {"message": "Policy created as a safe draft" if policy.status == "draft" else "Policy created", "policy": _serialize(policy)}


@router.get("/metrics")
def policy_metrics(db: Session = Depends(get_db)):
    total = db.query(Policy).filter(Policy.status != "archived").count()
    active = db.query(Policy).filter(Policy.status == "active", Policy.enabled.is_(True)).count()
    evaluated = db.query(func.count(func.distinct(PolicyEvaluation.agent_run_id))).scalar() or 0
    blocked = db.query(func.count(func.distinct(PolicyEvaluation.agent_run_id))).filter(PolicyEvaluation.outcome == "block").scalar() or 0
    errors = db.query(PolicyEvaluation).filter(PolicyEvaluation.outcome == "error").count()
    top = (db.query(PolicyEvaluation.policy_name, func.count(PolicyEvaluation.id).label("count"))
           .filter(PolicyEvaluation.outcome == "block").group_by(PolicyEvaluation.policy_name)
           .order_by(func.count(PolicyEvaluation.id).desc()).first())
    return {"total": total, "active": active, "runs_evaluated": evaluated,
            "runs_blocked": blocked, "block_rate": round((blocked / evaluated * 100) if evaluated else 0, 1),
            "errors": errors, "top_blocker": {"name": top[0], "count": top[1]} if top else None}


@router.get("/evaluations")
def grouped_evaluations(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
                        outcome: str | None = None, policy_id: int | None = None,
                        run_id: int | None = None, search: str | None = None,
                        db: Session = Depends(get_db)):
    query = db.query(PolicyEvaluation)
    if outcome and outcome != "all": query = query.filter(PolicyEvaluation.outcome == outcome)
    if policy_id: query = query.filter(PolicyEvaluation.policy_id == policy_id)
    if run_id: query = query.filter(PolicyEvaluation.agent_run_id == run_id)
    if search: query = query.filter(or_(PolicyEvaluation.policy_name.ilike(f"%{search}%"), PolicyEvaluation.reason.ilike(f"%{search}%")))
    run_ids_query = query.with_entities(PolicyEvaluation.agent_run_id, func.max(PolicyEvaluation.evaluated_at).label("latest")).group_by(PolicyEvaluation.agent_run_id)
    total = run_ids_query.count()
    selected = [row[0] for row in run_ids_query.order_by(func.max(PolicyEvaluation.evaluated_at).desc()).offset((page - 1) * page_size).limit(page_size).all()]
    rows = query.filter(PolicyEvaluation.agent_run_id.in_(selected or [-1])).order_by(PolicyEvaluation.agent_run_id.desc(), PolicyEvaluation.id).all()
    grouped: dict[int, list] = {rid: [] for rid in selected}
    for item in rows: grouped.setdefault(item.agent_run_id, []).append(item)
    return {"page": page, "page_size": page_size, "total": total, "runs": [
        {"run_id": rid, "final_decision": "blocked" if any(x.outcome == "block" or (x.outcome == "error" and not x.passed) for x in grouped[rid]) else "allowed",
         "passed": sum(1 for x in grouped[rid] if x.outcome == "pass"), "total": len(grouped[rid]),
         "blocked_by": [x.policy_name for x in grouped[rid] if x.outcome == "block"],
         "evaluated_at": max((x.evaluated_at for x in grouped[rid] if x.evaluated_at), default=None),
         "evaluations": [_serialize_evaluation(x) for x in grouped[rid]]} for rid in selected]}


def _serialize_evaluation(x: PolicyEvaluation) -> dict:
    return {"id": x.id, "policy_id": x.policy_id, "policy_name": x.policy_name,
            "policy_version": x.policy_version, "outcome": x.outcome or ("pass" if x.passed else "block"),
            "passed": x.passed, "reason": x.reason, "input_field": x.input_field,
            "input_value": x.input_value, "operator": x.operator, "threshold_value": x.threshold_value,
            "calculation": x.calculation, "final_effect": x.final_effect, "duration_ms": x.duration_ms,
            "evaluated_at": x.evaluated_at.isoformat() if x.evaluated_at else None}


@router.get("/evaluations/recent")
def recent_compat(limit: int = 20, db: Session = Depends(get_db)):
    rows = db.query(PolicyEvaluation).order_by(PolicyEvaluation.evaluated_at.desc(), PolicyEvaluation.id.desc()).limit(max(1, min(limit, 100))).all()
    return {"evaluations": [{**_serialize_evaluation(x), "agent_run_id": x.agent_run_id} for x in rows]}


@router.get("/evaluations/export")
def export_evaluations(db: Session = Depends(get_db)):
    output = io.StringIO(); writer = csv.writer(output)
    writer.writerow(["run_id", "policy", "version", "outcome", "input", "operator", "threshold", "calculation", "effect", "evaluated_at"])
    for x in db.query(PolicyEvaluation).order_by(PolicyEvaluation.evaluated_at.desc()).all():
        writer.writerow([x.agent_run_id, x.policy_name, x.policy_version, x.outcome, x.input_value, x.operator, x.threshold_value, x.calculation, x.final_effect, x.evaluated_at])
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=policy-evaluations.csv"})


@router.post("/simulate")
def simulate(request: SimulationRequest, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    base = _get(db, request.policy_id) if request.policy_id else None
    values = _snapshot(base) if base else {}
    values.update(request.proposed or {})
    values.setdefault("id", base.id if base else 0); values.setdefault("name", "Proposed policy")
    values.setdefault("policy_type", base.policy_type if base else "severity_threshold")
    values.setdefault("version", (base.version or 1) + 1 if base else 1)
    values.setdefault("enabled", True); values.setdefault("status", "active"); values.setdefault("action", "block")
    values.setdefault("operator", "gt"); values.setdefault("fail_mode", "closed"); values.setdefault("scope", {})
    proposed = SimpleNamespace(**values)
    query = db.query(AgentRun, Disruption).join(Disruption, AgentRun.disruption_id == Disruption.id)
    if request.run_ids: query = query.filter(AgentRun.id.in_(request.run_ids))
    rows = query.order_by(AgentRun.id.desc()).limit(request.limit).all()
    results = [{"run_id": run.id, **evaluate_policy(proposed, disruption.raw_data or {}, include_lifecycle=False)} for run, disruption in rows]
    blocked = sum(1 for x in results if x["outcome"] == "block")
    summary = {"runs_tested": len(results), "would_block": blocked,
               "block_rate": round((blocked / len(results) * 100) if results else 0, 1),
               "errors": sum(1 for x in results if x["outcome"] == "error")}
    if base and not request.proposed:
        base.last_simulated_version = base.version or 1
        base.last_simulated_at = datetime.utcnow()
        base.last_simulation_summary = summary
        db.commit()
    return {"policy": values, **summary, "results": results}


@router.get("/{policy_id}")
def get_policy(policy_id: int, db: Session = Depends(get_db)):
    return _serialize(_get(db, policy_id))


@router.patch("/{policy_id}")
def update_policy(policy_id: int, request: PolicyPatch, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    policy = _get(db, policy_id); previous = _snapshot(policy); old_version = policy.version or 1
    for key, value in request.model_dump(exclude_unset=True, exclude={"actor", "change_reason"}).items(): setattr(policy, key, value)
    if policy.operator not in OPERATORS: raise HTTPException(422, "Unsupported operator")
    policy.version = old_version + 1; policy.updated_by = request.actor
    policy.status = "draft"; policy.enabled = False
    policy.last_simulated_version = None; policy.last_simulated_at = None; policy.last_simulation_summary = None
    _record_change(db, policy, "updated", request.actor, request.change_reason, previous, old_version)
    db.commit(); db.refresh(policy)
    return {"message": "Draft updated. Simulate before activation.", "policy": _serialize(policy)}


@router.delete("/{policy_id}")
def delete_policy(policy_id: int, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    policy = _get(db, policy_id)
    if policy.status == "active" or policy.enabled:
        raise HTTPException(409, "Deactivate the policy before deleting it")
    evaluation_count = db.query(PolicyEvaluation).filter(PolicyEvaluation.policy_id == policy_id).count()
    if evaluation_count:
        raise HTTPException(409, "This policy has evaluation history and must be archived instead of deleted")
    db.query(PolicyVersion).filter(PolicyVersion.policy_id == policy_id).delete(synchronize_session=False)
    db.query(PolicyAudit).filter(PolicyAudit.policy_id == policy_id).delete(synchronize_session=False)
    db.delete(policy); db.commit()
    return {"message": f"Policy '{policy.name}' deleted permanently"}


@router.post("/{policy_id}/lifecycle/{status}")
def lifecycle(policy_id: int, status: str, request: LifecycleRequest, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    if status not in STATUSES: raise HTTPException(422, "Unsupported lifecycle status")
    policy = _get(db, policy_id); previous = _snapshot(policy); old_version = policy.version or 1
    if status in {"active", "scheduled"}:
        if policy.last_simulated_version != old_version:
            raise HTTPException(409, "Simulate the current policy version before activation")
        if (policy.last_simulation_summary or {}).get("errors", 0) > 0:
            raise HTTPException(409, "Resolve simulation errors before activation")
        if status == "scheduled" and not request.effective_from:
            raise HTTPException(422, "Scheduled activation requires an effective date")
    policy.status = status; policy.enabled = status == "active"; policy.effective_from = request.effective_from
    if status == "scheduled": policy.enabled = True
    policy.version = old_version + 1; policy.updated_by = request.actor
    _record_change(db, policy, status, request.actor, request.reason, previous, old_version)
    db.commit(); db.refresh(policy)
    return {"message": f"Policy moved to {status}", "policy": _serialize(policy)}


@router.post("/{policy_id}/duplicate")
def duplicate(policy_id: int, request: LifecycleRequest, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    source = _get(db, policy_id); values = policy_snapshot(source)
    values.update({"name": f"{source.name} (copy)", "status": "draft", "enabled": False, "version": 1,
                   "created_by": request.actor, "updated_by": request.actor})
    copy = Policy(**values); db.add(copy); db.flush()
    _record_change(db, copy, "duplicated", request.actor, request.reason, None, None)
    db.commit(); db.refresh(copy)
    return {"message": "Policy duplicated as draft", "policy": _serialize(copy)}


@router.get("/{policy_id}/history")
def history(policy_id: int, db: Session = Depends(get_db)):
    _get(db, policy_id)
    versions = db.query(PolicyVersion).filter(PolicyVersion.policy_id == policy_id).order_by(PolicyVersion.version.desc()).all()
    audits = db.query(PolicyAudit).filter(PolicyAudit.policy_id == policy_id).order_by(PolicyAudit.created_at.desc()).all()
    return {"versions": [{"id": x.id, "version": x.version, "snapshot": x.snapshot, "reason": x.change_reason, "actor": x.changed_by, "created_at": x.created_at} for x in versions],
            "audit": [{"id": x.id, "action": x.action, "from_version": x.from_version, "to_version": x.to_version, "reason": x.reason, "actor": x.actor, "created_at": x.created_at} for x in audits]}


@router.post("/{policy_id}/rollback/{version}")
def rollback(policy_id: int, version: int, request: LifecycleRequest, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    policy = _get(db, policy_id)
    target = db.query(PolicyVersion).filter(PolicyVersion.policy_id == policy_id, PolicyVersion.version == version).order_by(PolicyVersion.id.desc()).first()
    if not target: raise HTTPException(404, "Policy version not found")
    previous = _snapshot(policy); old_version = policy.version or 1
    protected = {"id", "created_at", "updated_at", "created_by", "updated_by", "version", "last_simulated_version", "last_simulated_at", "last_simulation_summary"}
    for key, value in target.snapshot.items():
        if key not in protected and hasattr(policy, key):
            if key in {"effective_from", "effective_until"} and isinstance(value, str):
                value = datetime.fromisoformat(value)
            setattr(policy, key, value)
    policy.version = old_version + 1; policy.updated_by = request.actor
    policy.status = "draft"; policy.enabled = False
    policy.last_simulated_version = None; policy.last_simulated_at = None; policy.last_simulation_summary = None
    _record_change(db, policy, "rolled_back", request.actor, request.reason, previous, old_version)
    db.commit(); db.refresh(policy)
    return {"message": f"Restored version {version} as version {policy.version}", "policy": _serialize(policy)}
