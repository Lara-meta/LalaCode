import os
import smtplib
import ssl
from email.message import EmailMessage


SMTP_HOST = os.getenv("SMTP_HOST")

SMTP_PORT = int(
    os.getenv("SMTP_PORT", "587")
)

SMTP_USERNAME = os.getenv(
    "SMTP_USERNAME"
)

SMTP_PASSWORD = os.getenv(
    "SMTP_PASSWORD"
)

SMTP_FROM_EMAIL = os.getenv(
    "SMTP_FROM_EMAIL"
)

WORKBENCH_REVIEW_EMAIL = os.getenv(
    "WORKBENCH_REVIEW_EMAIL"
)

FRONTEND_URL = os.getenv(
    "FRONTEND_URL",
    "http://localhost:3001",
).rstrip("/")


class WorkbenchNotificationError(Exception):
    pass


def send_human_review_notification(
    *,
    item_number: str,
    notice_supplier_id: str,
    notice_type: str,
    notice_id: str,
    reason: str,
) -> None:
    required = {
        "SMTP_HOST": SMTP_HOST,
        "SMTP_USERNAME": SMTP_USERNAME,
        "SMTP_PASSWORD": SMTP_PASSWORD,
        "SMTP_FROM_EMAIL": SMTP_FROM_EMAIL,
        "WORKBENCH_REVIEW_EMAIL":
            WORKBENCH_REVIEW_EMAIL,
    }

    missing = [
        key
        for key, value in required.items()
        if not value
    ]

    if missing:
        raise WorkbenchNotificationError(
            "Missing email configuration: "
            + ", ".join(missing)
        )

    message = EmailMessage()

    message["Subject"] = (
        "Procurement Recovery Requires Human Review "
        f"- {item_number}"
    )

    message["From"] = SMTP_FROM_EMAIL
    message["To"] = WORKBENCH_REVIEW_EMAIL

    message.set_content(
        f"""
Procurement Exception Requires Human Review

Item Number:
{item_number}

Supplier ID:
{notice_supplier_id}

Notice Type:
{notice_type}

Notice ID:
{notice_id}

Reason:
{reason}

Open the AutoPilot Approval Workbench:

{FRONTEND_URL}/workbench

Approve, modify, or reject the case in AutoPilot. The Workbench
decision is the authoritative decision for this workflow.
"""
    )

    try:
        context = ssl.create_default_context()

        with smtplib.SMTP(
            SMTP_HOST,
            SMTP_PORT,
            timeout=20,
        ) as smtp:

            smtp.ehlo()

            smtp.starttls(
                context=context
            )

            smtp.ehlo()

            smtp.login(
                SMTP_USERNAME,
                SMTP_PASSWORD,
            )

            smtp.send_message(message)

    except Exception as exc:
        raise WorkbenchNotificationError(
            f"Could not send review email: {exc}"
        ) from exc
