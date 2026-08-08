import os
import json
import smtplib
import ssl
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.integration import Integration


router = APIRouter(prefix="/integrations", tags=["integrations"])


INTEGRATION_DEFINITIONS = (
    {
        "name": "Supervity Auto",
        "provider": "Supervity",
        "category": "orchestration",
        "purpose": "Runs the Procurement Exception Commander and its Operator workflows.",
        "configured_env": ("SUPERVITY_API_KEY", "SUPERVITY_WORKFLOW_ID"),
        "url_env": "SUPERVITY_HEALTH_URL",
        "checker": "generic",
    },
    {
        "name": "Procurement System of Record",
        "provider": "Supabase",
        "category": "system_of_record",
        "purpose": "Supplies orders, inventory, contracts, suppliers, and shipment records.",
        "configured_env": ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_HEALTH_TABLE"),
        "url_env": None,
        "checker": "supabase",
    },
    {
        "name": "Human Approval Delivery",
        "provider": "Microsoft 365 SMTP",
        "category": "human_loop",
        "purpose": "Sends Microsoft 365 email alerts when a Workbench decision is required.",
        "configured_env": ("SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM_EMAIL"),
        "url_env": None,
        "checker": "smtp",
    },
)


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _configured(definition: dict) -> bool:
    fields = definition["configured_env"]
    if isinstance(fields, str):
        fields = (fields,)
    return all(bool(os.getenv(field, "").strip()) for field in fields)


def _missing_fields(definition: dict) -> list[str]:
    fields = definition["configured_env"]
    if isinstance(fields, str):
        fields = (fields,)
    return [field for field in fields if not os.getenv(field, "").strip()]


def _sync_registry(db: Session) -> list[Integration]:
    existing = {item.name: item for item in db.query(Integration).all()}
    legacy_outlook = existing.pop("Disruption Intake", None)
    if legacy_outlook is not None:
        db.delete(legacy_outlook)
    for definition in INTEGRATION_DEFINITIONS:
        item = existing.get(definition["name"])
        if item is None:
            item = Integration(name=definition["name"])
            db.add(item)
            existing[item.name] = item
        item.provider = definition["provider"]
        item.category = definition["category"]
        item.purpose = definition["purpose"]
        item.configured = _configured(definition)
        item.health_url = (
            os.getenv(definition["url_env"]) if definition["url_env"] else None
        )
        item.metadata_json = {
            "checker": definition["checker"],
            "missing_fields": _missing_fields(definition),
        }
    db.commit()
    return db.query(Integration).order_by(Integration.category, Integration.name).all()


def _supabase_check() -> tuple[str, str | None]:
    base = os.environ["SUPABASE_URL"].rstrip("/")
    table = os.environ["SUPABASE_HEALTH_TABLE"].strip()
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    request = Request(
        f"{base}/rest/v1/{table}?select=*&limit=1",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"},
        method="GET",
    )
    with urlopen(request, timeout=8) as response:
        json.loads(response.read().decode())
    return "healthy", None


def _smtp_check() -> tuple[str, str | None]:
    host = os.environ["SMTP_HOST"]
    port = int(os.getenv("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=8) as client:
        client.ehlo()
        client.starttls(context=ssl.create_default_context())
        client.ehlo()
        client.login(os.environ["SMTP_USERNAME"], os.environ["SMTP_PASSWORD"])
        code, _ = client.noop()
        if code != 250:
            return "degraded", f"SMTP server returned status {code} after login."
    return "healthy", None


def _check(item: Integration) -> tuple[str, str | None]:
    if not item.enabled:
        return "disabled", None
    if not item.configured:
        missing = (item.metadata_json or {}).get("missing_fields") or []
        return "not_configured", "Missing: " + ", ".join(missing)
    checker = (item.metadata_json or {}).get("checker")
    try:
        if checker == "supabase":
            return _supabase_check()
        if checker == "smtp":
            return _smtp_check()
    except HTTPError as exc:
        return "unhealthy", f"Authentication or API check failed with HTTP {exc.code}."
    except (URLError, TimeoutError, ValueError, KeyError, json.JSONDecodeError,
            OSError, smtplib.SMTPException) as exc:
        return "unhealthy", str(exc)[:300]
    if not item.health_url:
        # SMTP has no safe read-only application endpoint. Configuration is
        # reported separately from a verified HTTP health check.
        return "configured", None
    try:
        request = Request(item.health_url, method="GET", headers={"User-Agent": "AutoPilot-Health/1.0"})
        with urlopen(request, timeout=5) as response:
            if 200 <= response.status < 400:
                return "healthy", None
            return "degraded", f"Health endpoint returned HTTP {response.status}."
    except HTTPError as exc:
        return "degraded", f"Health endpoint returned HTTP {exc.code}."
    except (URLError, TimeoutError, ValueError) as exc:
        return "unhealthy", str(exc)[:300]


def _serialize(item: Integration) -> dict:
    return {
        "id": item.id,
        "name": item.name,
        "provider": item.provider,
        "category": item.category,
        "purpose": item.purpose,
        "configured": bool(item.configured),
        "enabled": bool(item.enabled),
        "status": item.last_status,
        "last_checked_at": item.last_checked_at,
        "last_error": item.last_error,
        "missing_fields": (item.metadata_json or {}).get("missing_fields") or [],
    }


@router.get("")
def list_integrations(db: Session = Depends(get_db)):
    items = _sync_registry(db)
    required = [item for item in items if item.category in {"orchestration", "system_of_record", "human_loop"}]
    healthy = [item for item in required if item.last_status in {"healthy", "configured"}]
    categories = {item.category for item in healthy}
    gate_ready = (
        len(healthy) >= 3
        and "orchestration" in categories
        and "system_of_record" in categories
        and "human_loop" in categories
    )
    return {
        "integrations": [_serialize(item) for item in items],
        "summary": {
            "total": len(items),
            "configured": sum(1 for item in items if item.configured),
            "healthy": sum(1 for item in items if item.last_status in {"healthy", "configured"}),
            "categories": sorted(categories),
            "round_two_gate_ready": gate_ready,
        },
    }


@router.post("/check")
def check_integrations(db: Session = Depends(get_db)):
    items = _sync_registry(db)
    checked_at = datetime.now(timezone.utc)
    for item in items:
        item.last_status, item.last_error = _check(item)
        item.last_checked_at = checked_at
    db.commit()
    return list_integrations(db)
