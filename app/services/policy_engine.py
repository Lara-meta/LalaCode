from datetime import datetime, timezone
from time import perf_counter
from typing import Any

from sqlalchemy.orm import Session

from ..models.policy import Policy
from ..models.policy_evaluation import PolicyEvaluation
from .policy_context import field_definition


DEFAULT_FIELDS = {
    "severity_threshold": "severity",
    "expedite_spend_limit": "expedite_cost",
    "contract_clause_block": "x_escalation_clause",
}


def policy_snapshot(policy: Policy) -> dict:
    return {
        key: getattr(policy, key, None)
        for key in (
            "name", "policy_type", "description", "threshold_value", "comparison_value", "enabled",
            "status", "version", "field_name", "operator", "unit", "action",
            "scope", "fail_mode", "priority", "effective_from", "effective_until",
        )
    }


def _display(value: Any, unit: str | None) -> str:
    if value is None:
        return "missing"
    if unit == "USD" and isinstance(value, (int, float)):
        return f"${value:,.2f}"
    if unit == "score_10":
        return f"{value}/10"
    return str(value)


def _scope_matches(policy: Policy, data: dict) -> bool:
    scope = policy.scope if isinstance(policy.scope, dict) else {}
    for key, expected in scope.items():
        if expected in (None, "", []):
            continue
        actual = data.get(key)
        if isinstance(expected, list):
            if actual not in expected:
                return False
        elif str(actual) != str(expected):
            return False
    return True


def evaluate_policy(policy: Policy, data: dict, include_lifecycle: bool = True,
                    defer_missing: bool = False) -> dict:
    started = perf_counter()
    now = datetime.now(timezone.utc)
    status = policy.status or ("active" if policy.enabled else "draft")
    if include_lifecycle:
        effective_from = policy.effective_from
        effective_until = policy.effective_until
        if effective_from and effective_from.tzinfo is None:
            effective_from = effective_from.replace(tzinfo=timezone.utc)
        if effective_until and effective_until.tzinfo is None:
            effective_until = effective_until.replace(tzinfo=timezone.utc)
        if not policy.enabled or status not in {"active", "scheduled"}:
            return _result(policy, "skipped", None, "Policy is not active", "No effect", started)
        if status == "scheduled" and not effective_from:
            return _result(policy, "skipped", None, "Scheduled policy has no activation date", "No effect", started)
        if effective_from and effective_from > now:
            return _result(policy, "skipped", None, "Policy is scheduled for later", "No effect", started)
        if effective_until and effective_until < now:
            return _result(policy, "skipped", None, "Policy has expired", "No effect", started)
    if not _scope_matches(policy, data):
        return _result(policy, "not_applicable", None, "Run is outside policy scope", "No effect", started)

    field = policy.field_name or DEFAULT_FIELDS.get(policy.policy_type)
    value = data.get(field) if field else None
    operator = policy.operator or ("not_empty" if policy.policy_type == "contract_clause_block" else "gt")
    threshold = getattr(policy, "comparison_value", None)
    if threshold is None:
        threshold = policy.threshold_value
    if value is None:
        if defer_missing:
            return _result(
                policy, "deferred", value,
                f"Required field '{field}' will be evaluated after Operator evidence is available",
                "Deferred to proposed-action checkpoint", started,
            )
        definition = field_definition(field)
        if definition and not definition.get("required", False):
            return _result(policy, "not_applicable", value,
                           f"Optional field '{field}' was not produced for this run",
                           "No effect", started)
        outcome = "error"
        effect = "Blocked (fail closed)" if (policy.fail_mode or "closed") == "closed" else "Allowed (fail open)"
        return _result(policy, outcome, value, f"Required field '{field}' is missing", effect, started)

    try:
        if operator == "gt":
            matched = float(value) > float(threshold)
            symbol = ">"
        elif operator == "gte":
            matched = float(value) >= float(threshold)
            symbol = ">="
        elif operator == "lt":
            matched = float(value) < float(threshold)
            symbol = "<"
        elif operator == "lte":
            matched = float(value) <= float(threshold)
            symbol = "<="
        elif operator == "eq":
            matched = str(value) == str(threshold)
            symbol = "="
        elif operator == "contains":
            matched = str(threshold).lower() in str(value).lower()
            symbol = "contains"
        elif operator == "not_empty":
            matched = bool(str(value).strip())
            symbol = "is not empty"
        else:
            return _result(policy, "error", value, f"Unsupported operator '{operator}'", "Blocked (fail closed)", started)
    except (TypeError, ValueError):
        return _result(policy, "error", value, "Input and threshold could not be compared", "Blocked (fail closed)", started)

    lhs = _display(value, policy.unit)
    rhs = _display(threshold, policy.unit) if operator != "not_empty" else ""
    calculation = f"{lhs} {symbol} {rhs}".strip()
    if matched and (policy.action or "block") == "block":
        return _result(policy, "block", value, f"Rule matched: {calculation}", "Orchestration blocked", started, calculation)
    return _result(policy, "pass", value, f"Rule did not block: {calculation}", "Orchestration allowed", started, calculation)


def _result(policy: Policy, outcome: str, value: Any, reason: str, effect: str,
            started: float, calculation: str | None = None) -> dict:
    comparison = getattr(policy, "comparison_value", None)
    if comparison is None:
        comparison = policy.threshold_value
    passed = outcome in {"pass", "not_applicable", "skipped", "deferred"} or (
        outcome == "error" and (policy.fail_mode or "closed") == "open"
    )
    return {
        "policy_id": policy.id, "policy": policy.name, "policy_version": policy.version or 1,
        "passed": passed, "outcome": outcome, "reason": reason,
        "input_field": policy.field_name or DEFAULT_FIELDS.get(policy.policy_type),
        "input_value": None if value is None else str(value), "operator": policy.operator,
        "threshold_value": comparison, "calculation": calculation,
        "final_effect": effect, "duration_ms": max(0, round((perf_counter() - started) * 1000)),
    }


def evaluate_policies(db: Session, agent_run_id: int, disruption_data: dict,
                      defer_missing: bool = False) -> tuple[bool, list[dict]]:
    policies = db.query(Policy).filter(Policy.status != "archived").order_by(Policy.priority, Policy.id).all()
    results = [
        evaluate_policy(policy, disruption_data, defer_missing=defer_missing)
        for policy in policies
    ]
    for policy, result in zip(policies, results):
        db.add(PolicyEvaluation(
            agent_run_id=agent_run_id, policy_id=policy.id, policy_name=policy.name,
            policy_version=result["policy_version"], passed=result["passed"], outcome=result["outcome"],
            reason=result["reason"], input_field=result["input_field"], input_value=result["input_value"],
            operator=result["operator"],
            threshold_value=result["threshold_value"] if isinstance(result["threshold_value"], (int, float)) else None,
            comparison_value=result["threshold_value"],
            calculation=result["calculation"], final_effect=result["final_effect"],
            duration_ms=result["duration_ms"], details={"scope": policy.scope or {}, "unit": policy.unit},
        ))
    db.commit()
    return all(result["passed"] for result in results), results
