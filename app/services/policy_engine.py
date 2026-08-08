from sqlalchemy.orm import Session
from ..models.policy import Policy
from ..models.policy_evaluation import PolicyEvaluation


def evaluate_policies(db: Session, agent_run_id: int, disruption_data: dict) -> tuple[bool, list[dict]]:
    """
    Runs all enabled policies against disruption_data.
    Returns (all_passed, results). Logs every evaluation to policy_evaluations.
    """
    policies = db.query(Policy).filter(Policy.enabled == True).all()
    results = []
    all_passed = True

    for policy in policies:
        passed, reason = _evaluate_one(policy, disruption_data)
        if not passed:
            all_passed = False

        evaluation = PolicyEvaluation(
            agent_run_id=agent_run_id,
            policy_name=policy.name,
            passed=passed,
            reason=reason,
        )
        db.add(evaluation)
        results.append({"policy": policy.name, "passed": passed, "reason": reason})

    db.commit()
    return all_passed, results


def _evaluate_one(policy: Policy, data: dict) -> tuple[bool, str]:
    if policy.policy_type == "severity_threshold":
        severity = data.get("severity") or 0
        if severity > policy.threshold_value:
            return False, f"Severity {severity} exceeds threshold {policy.threshold_value}"
        return True, "Within severity threshold"

    if policy.policy_type == "expedite_spend_limit":
        cost = data.get("expedite_cost") or 0
        if cost > policy.threshold_value:
            return False, f"Expedite cost {cost} exceeds limit {policy.threshold_value}"
        return True, "Within spend limit"

    if policy.policy_type == "contract_clause_block":
        clause_text = data.get("x_escalation_clause") or ""
        if clause_text and clause_text.strip():
            return False, f"Contract has escalation clause: {clause_text[:100]}"
        return True, "No escalation clause found"

    return True, "Unknown policy type — skipped"