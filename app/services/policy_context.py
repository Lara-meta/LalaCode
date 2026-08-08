"""Normalized, auditable inputs exposed to the policy engine."""
from __future__ import annotations

import json
from typing import Any


POLICY_FIELDS: dict[str, dict[str, Any]] = {
    "notice_id": {"label": "Notice ID", "type": "number", "stage": "preflight", "required": True,
                  "operators": ["gt", "gte", "lt", "lte", "eq"]},
    "notice_type": {"label": "Notice type", "type": "string", "stage": "preflight", "required": True,
                    "operators": ["eq", "contains", "not_empty"]},
    "supplier_id": {"label": "Supplier ID", "type": "string", "stage": "preflight", "required": True,
                    "operators": ["eq", "contains", "not_empty"]},
    "item_number": {"label": "Item number", "type": "string", "stage": "preflight", "required": True,
                    "operators": ["eq", "contains", "not_empty"]},
    "severity": {"label": "Impact severity", "type": "number", "stage": "impact_mapping", "required": False,
                 "operators": ["gt", "gte", "lt", "lte", "eq"], "unit": "score_10"},
    "expedite_cost": {"label": "Estimated expedite cost", "type": "number", "stage": "recovery_planning", "required": False,
                      "operators": ["gt", "gte", "lt", "lte", "eq"], "unit": "USD"},
    "estimated_delay_days": {"label": "Estimated delay (days)", "type": "number", "stage": "impact_mapping", "required": False,
                             "operators": ["gt", "gte", "lt", "lte", "eq"], "unit": "days"},
    "contract_clauses": {"label": "Contract clauses", "type": "string", "stage": "compliance", "required": False,
                         "operators": ["contains", "not_empty"]},
    "recovery_strategy": {"label": "Recovery strategy", "type": "string", "stage": "recovery_planning", "required": False,
                          "operators": ["eq", "contains", "not_empty"]},
}

ALIASES = {
    "notice_supplier_id": "supplier_id", "supplierId": "supplier_id", "supplier_id": "supplier_id",
    "severity_score": "severity", "impact_severity": "severity", "impactSeverity": "severity",
    "impact_severity_score": "severity", "severity": "severity",
    "estimated_expedite_cost": "expedite_cost", "expediteCost": "expedite_cost", "expedite_cost": "expedite_cost",
    "expedite_spend": "expedite_cost", "expedited_cost": "expedite_cost", "expediting_cost": "expedite_cost",
    "delay_days": "estimated_delay_days", "estimatedDelayDays": "estimated_delay_days",
    "estimated_delay_days": "estimated_delay_days", "contract_clauses": "contract_clauses",
    "x_escalation_clause": "contract_clauses", "escalation_clause": "contract_clauses",
    "contract_clause": "contract_clauses", "clauses": "contract_clauses", "selected_recovery_strategy": "recovery_strategy",
    "recoveryStrategy": "recovery_strategy", "recovery_strategy": "recovery_strategy",
}

SEVERITY_SCORES = {
    "low": 2,
    "medium": 5,
    "high": 8,
    "critical": 10,
}


def _normalize_value(field: str, value: Any) -> Any:
    if field == "severity" and isinstance(value, str):
        return SEVERITY_SCORES.get(value.strip().lower(), value)
    return value


def _walk(value: Any):
    if isinstance(value, dict):
        for key, child in value.items():
            yield key, child
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)
    elif isinstance(value, str):
        candidate = value.strip()
        if candidate.startswith(("{", "[")):
            try:
                yield from _walk(json.loads(candidate))
            except json.JSONDecodeError:
                return


def build_policy_context(raw_data: dict | None, operator_outputs: Any = None) -> dict:
    raw = dict(raw_data or {})
    context = {
        "notice_id": raw.get("notice_id"),
        "notice_type": raw.get("notice_type"),
        "supplier_id": raw.get("supplier_id") or raw.get("notice_supplier_id"),
        "item_number": raw.get("item_number"),
    }
    sources = [raw]
    if operator_outputs is not None:
        sources.append(operator_outputs)
    for source in sources:
        for key, value in _walk(source):
            normalized = ALIASES.get(key, key if key in POLICY_FIELDS else None)
            if normalized and value not in (None, "", [], {}) and context.get(normalized) in (None, "", [], {}):
                context[normalized] = _normalize_value(normalized, value)
    return {key: value for key, value in context.items() if value not in (None, "", [], {})}


def field_registry() -> list[dict[str, Any]]:
    return [{"name": name, **definition} for name, definition in POLICY_FIELDS.items()]


def field_definition(name: str | None) -> dict[str, Any] | None:
    return POLICY_FIELDS.get(name or "")
