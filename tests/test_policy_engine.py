from types import SimpleNamespace

from app.routers.orchestrator import build_policy_context
from app.services.policy_engine import evaluate_policy


def policy(**overrides):
    values = {
        "id": 1,
        "name": "Expedite guard",
        "policy_type": "expedite_spend_limit",
        "status": "active",
        "enabled": True,
        "effective_from": None,
        "effective_until": None,
        "scope": {},
        "field_name": "expedite_cost",
        "operator": "gt",
        "threshold_value": 10_000,
        "unit": "USD",
        "action": "block",
        "fail_mode": "closed",
        "version": 1,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_missing_operator_evidence_is_deferred_during_preflight():
    result = evaluate_policy(policy(), {"notice_id": "5001"}, defer_missing=True)
    assert result["outcome"] == "deferred"
    assert result["passed"] is True


def test_operator_evidence_is_normalized_and_blocks_proposed_action():
    evidence = [{"outputs": {"output": '{"estimated_expedite_cost": 12500}'}}]
    context = build_policy_context({"notice_id": "5001"}, evidence)
    result = evaluate_policy(policy(), context)
    assert context["expedite_cost"] == 12_500
    assert result["outcome"] == "block"
    assert result["passed"] is False


def test_missing_operator_evidence_fails_closed_at_checkpoint():
    result = evaluate_policy(policy(), {"notice_id": "5001"})
    assert result["outcome"] == "error"
    assert result["passed"] is False


def test_expedite_spend_alias_is_normalized():
    evidence = [{"outputs": {"output": '{"expedite_spend": 8750}'}}]
    context = build_policy_context({"notice_id": "5001"}, evidence)
    assert context["expedite_cost"] == 8_750


def test_explicit_zero_expedite_cost_is_preserved():
    context = build_policy_context(
        {"notice_id": "5001", "expedite_cost": 0}
    )
    assert context["expedite_cost"] == 0
