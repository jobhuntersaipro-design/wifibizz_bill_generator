"""
Read OTP from Gmail using Gmail API
Handles forwarded SMS like: "Unifi: Your OTP is 641776"
"""

import base64
import os
import re
import time

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
ALLOW_BROWSER_AUTH = os.getenv("GMAIL_ALLOW_BROWSER", "0") == "1"

# How long a wait may stay completely silent — no mail for us at all — before
# we stop and say the portal probably never sent a code. Observed live: the
# portal answered genCaptcha with 200 and sent nothing, and the user watched a
# countdown for five minutes. 0 disables the check.
GMAIL_OTP_SILENT_AFTER_SECONDS = int(
    os.getenv("GMAIL_OTP_SILENT_AFTER_SECONDS", "120")
)

# Successful Gmail queries required before silence is blamed on the portal.
# One empty result proves nothing: Gmail could be erroring, or the very first
# poll can land before the mail does.
SILENT_MIN_POLLS = 3


class OtpNeverSent(Exception):
    """No mail arrived at all — the portal accepted the request and sent
    nothing, so waiting out the rest of the window cannot help.

    Distinct from returning None (waited, mail may have come but held no
    usable code) because the two need opposite advice: None means "type the
    code by hand", this means "nothing is coming — try again later"."""


class GmailOTPReader:
    def __init__(self):
        self.service = self._get_gmail_service()

    def _get_gmail_service(self):
        """Authenticate and return Gmail service"""
        creds = None

        if os.path.exists("config/gmail_token.json"):
            creds = Credentials.from_authorized_user_file(
                "config/gmail_token.json", SCOPES
            )

        refresh_error = None
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                try:
                    creds.refresh(Request())
                except Exception as e:  # noqa: BLE001
                    # The token is deliberately NOT deleted here.
                    #
                    # Deleting it is what turned one expiry into a dead feature:
                    # on a server `ALLOW_BROWSER_AUTH` is off, so there is no way
                    # to write a replacement, and removing the file makes the
                    # failure permanent AND destroys the evidence of what went
                    # wrong. A refresh can also fail for reasons that pass on
                    # their own — a network blip, a 5xx from Google — and those
                    # must not cost the credential.
                    #
                    # Keep the file, carry the reason, and let the caller say so.
                    refresh_error = f"{type(e).__name__}: {e}"
                    print(f"⚠️ Gmail token refresh failed: {refresh_error}")
                    print("   Keeping config/gmail_token.json — a refresh failure "
                          "is not proof the token is unusable.")
                    creds = None

            if not creds or not creds.valid:
                # Need fresh authentication
                if not os.path.exists("config/gmail_credentials.json"):
                    print("ERROR: config/gmail_credentials.json not found!")
                    print("Please set up Gmail API credentials first.")
                    return None

                if not ALLOW_BROWSER_AUTH:
                    raise RuntimeError(
                        "Gmail auto-read is unavailable: "
                        + (f"refreshing the saved token failed ({refresh_error}). "
                           if refresh_error else
                           "config/gmail_token.json is missing or invalid. ")
                        + "Browser sign-in is disabled here, so a token cannot be "
                        "created on this machine. Regenerate it where a browser is "
                        "available with `GMAIL_ALLOW_BROWSER=1 python -c \"from "
                        "gmail_otp_reader import GmailOTPReader; GmailOTPReader()\"` "
                        "and copy config/gmail_token.json across, then restart "
                        "api_server."
                    )

                print("🔐 Opening browser for Gmail authentication...")
                flow = InstalledAppFlow.from_client_secrets_file(
                    "config/gmail_credentials.json", SCOPES
                )
                creds = flow.run_local_server(port=0)

            with open("config/gmail_token.json", "w") as token:
                token.write(creds.to_json())
            print("✅ Gmail token saved")

        return build("gmail", "v1", credentials=creds)

    def get_latest_otp(
        self, sender_filter="@forward-sms.com", wait_seconds=60, max_wait=1800,
        to_filter=None, silent_after=None,
    ):
        """
        Read latest OTP from email

        Args:
            sender_filter: Email sender pattern (e.g. '@forward-sms.com')
            wait_seconds: Initial wait time
            max_wait: Maximum wait time (30 minutes = 1800 seconds)
            to_filter: Original recipient to match (e.g. the dealer account's
                registered email, like 'nexion.eform@gmail.com'). Gmail's
                auto-forwarding preserves the original To header, so this
                disambiguates between multiple accounts forwarding OTPs into
                the same shared inbox at the same time — without it, two
                concurrent logins could cross-match each other's codes.
            silent_after: Give up early (raising OtpNeverSent) after this many
                seconds with no mail for us at all. None/0 waits out max_wait
                as before.

        Returns:
            OTP code as string, or None if not found

        Raises:
            OtpNeverSent: nothing arrived at all — see the class docstring for
                why that is not the same as returning None.
        """
        print(f"Waiting for OTP email from {sender_filter}" +
              (f" to {to_filter}" if to_filter else "") + "...")
        print(f"Will check for up to {max_wait} seconds (timeout for delays)...")

        start_time = time.time() - 60
        # The silent-detection clock is deliberately NOT start_time: that is
        # backdated 60s to also catch mail that landed just before the wait
        # began, so measuring against it would trip every threshold a full
        # minute early.
        wait_began = time.time()
        check_count = 0
        successful_polls = 0
        saw_fresh_mail = False

        while time.time() - start_time < max_wait:
            try:
                check_count += 1

                # Search for forwarded SMS from any forward-sms.com mailer
                query = f"from:{sender_filter} newer_than:5m"
                if to_filter:
                    query += f" to:{to_filter}"

                results = (
                    self.service.users()
                    .messages()
                    .list(userId="me", q=query, maxResults=5)
                    .execute()
                )

                messages = results.get("messages", [])
                # Counted only once the query itself came back. A Gmail outage
                # or an auth failure raises below and must never be mistaken
                # for "the portal sent nothing".
                successful_polls += 1

                if messages:
                    # Check each message for OTP
                    for msg_data in messages:
                        msg_id = msg_data["id"]
                        message = (
                            self.service.users()
                            .messages()
                            .get(userId="me", id=msg_id, format="full")
                            .execute()
                        )

                        # Check message timestamp
                        msg_timestamp = int(message.get("internalDate", 0)) / 1000

                        # Only accept emails received AFTER we started waiting
                        if msg_timestamp < start_time:
                            print(
                                f"  Skipping old email (from {int(time.time() - msg_timestamp)}s ago)"
                            )
                            continue

                        # Something arrived for us. Whatever happens next, the
                        # portal is not silent, so the silent check stands down.
                        saw_fresh_mail = True

                        # Get subject and body
                        subject = self._get_header(message, "Subject")
                        body = self._get_message_body(message)

                        # Debug: Print what we found
                        print(f"  Checking email - Subject: {subject[:50]}...")
                        print(f"  Body preview: {body[:100]}...")

                        full_text = f"{subject} {body}"

                        # Extract OTP
                        otp = self._extract_otp(full_text)

                        if otp:
                            print(
                                f"✓ Found OTP: {otp} (after {int(time.time() - start_time)}s, check #{check_count})"
                            )
                            return otp

                # Nothing has arrived and enough real polls have run to trust
                # that. Checked AFTER the scan above so a code landing in this
                # same poll always wins over the accusation.
                if (
                    silent_after
                    and not saw_fresh_mail
                    and successful_polls >= SILENT_MIN_POLLS
                    and time.time() - wait_began >= silent_after
                ):
                    quiet = int(time.time() - wait_began)
                    print(f"✗ No OTP email at all after {quiet}s — portal likely sent none")
                    raise OtpNeverSent(
                        f"The portal accepted the request but no code arrived in {quiet}s. "
                        "It is most likely rate-limiting OTP requests for this account — "
                        "wait a while before asking for another code."
                    )

                # Progress indicator
                elapsed = int(time.time() - start_time)
                if elapsed % 30 == 0 and elapsed > 0:
                    print(
                        f"Still waiting... ({elapsed}s elapsed, check #{check_count})"
                    )

                # Wait before next check (exponential backoff)
                if elapsed < 60:
                    time.sleep(3)  # Check every 3 seconds for first minute
                elif elapsed < 300:
                    time.sleep(10)  # Every 10 seconds for first 5 minutes
                else:
                    time.sleep(30)  # Every 30 seconds after that

            except OtpNeverSent:
                # Deliberate signal, not a read failure — the generic handler
                # below would swallow it and silently defeat the detection.
                raise
            except Exception as e:
                print(f"Error reading email: {e}")
                time.sleep(5)

        print(f"✗ OTP not found after {max_wait} seconds")
        return None

    def check_now(self, sender_filter="@forward-sms.com", to_filter=None, lookback_minutes=10):
        """One-shot search — a single Gmail query, no wait/poll loop. For a
        manual "check now" retry after the user says the email has already
        arrived, so it doesn't have to wait through get_latest_otp()'s
        multi-minute polling window just to look once.

        Unlike get_latest_otp(), this has no "must have arrived after I
        started waiting" cutoff — it just looks at the last `lookback_minutes`
        of matching mail and returns the newest OTP found, or None.
        """
        query = f"from:{sender_filter} newer_than:{lookback_minutes}m"
        if to_filter:
            query += f" to:{to_filter}"

        results = (
            self.service.users()
            .messages()
            .list(userId="me", q=query, maxResults=5)
            .execute()
        )

        for msg_data in results.get("messages", []):
            message = (
                self.service.users()
                .messages()
                .get(userId="me", id=msg_data["id"], format="full")
                .execute()
            )
            subject = self._get_header(message, "Subject")
            body = self._get_message_body(message)
            otp = self._extract_otp(f"{subject} {body}")
            if otp:
                return otp

        return None

    def _get_header(self, message, header_name):
        """Extract header value from email"""
        headers = message["payload"].get("headers", [])
        for header in headers:
            if header["name"].lower() == header_name.lower():
                return header["value"]
        return ""

    def _get_message_body(self, message):
        """Extract text from email message (handles HTML and nested parts)"""

        def get_text_from_parts(parts):
            text = ""
            for part in parts:
                mime_type = part.get("mimeType", "")
                # Grab BOTH plain text AND HTML text
                if mime_type in ["text/plain", "text/html"]:
                    data = part.get("body", {}).get("data", "")
                    if data:
                        text += (
                            base64.urlsafe_b64decode(data).decode(
                                "utf-8", errors="ignore"
                            )
                            + " "
                        )
                # If there are nested parts, dig deeper
                elif "parts" in part:
                    text += get_text_from_parts(part["parts"])
            return text

        try:
            payload = message.get("payload", {})

            # Handle multipart messages (including nested ones)
            if "parts" in payload:
                return get_text_from_parts(payload["parts"])

            # Handle simple messages
            data = payload.get("body", {}).get("data", "")
            if data:
                return base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")

        except Exception as e:
            print(f"Error extracting body: {e}")

        return ""

    def _extract_otp(self, text):
        """Clean HTML and extract the 6-digit OTP"""
        import re

        # 1. Strip all HTML tags out so we just have raw text
        clean_text = re.sub(r"<[^>]+>", " ", text)

        # 2. Extract the OTP
        patterns = [
            r"proceed\s+(\d{6})",  # Matches "proceed 655631"
            r"OTP.*?(\d{6})",  # Matches "OTP... 655631"
            r"\b(\d{6})\b",  # Fallback: Matches ANY standalone 6 digits
        ]

        for pattern in patterns:
            match = re.search(pattern, clean_text, re.IGNORECASE)
            if match:
                otp = match.group(1)
                # Verify it's actually 6 digits
                if len(otp) == 6 and otp.isdigit():
                    return otp

        return None


# Standalone function for easy import
def get_latest_otp(sender_filter="@unifi.com.my", max_age_seconds=1800, to_filter=None,
                   silent_after=GMAIL_OTP_SILENT_AFTER_SECONDS):
    reader = GmailOTPReader()
    return reader.get_latest_otp(
        sender_filter=sender_filter, wait_seconds=60, max_wait=max_age_seconds,
        to_filter=to_filter, silent_after=silent_after,
    )


def check_now_otp(sender_filter="@unifi.com.my", to_filter=None, lookback_minutes=10):
    reader = GmailOTPReader()
    return reader.check_now(
        sender_filter=sender_filter, to_filter=to_filter, lookback_minutes=lookback_minutes
    )


# Test function
if __name__ == "__main__":
    reader = GmailOTPReader()
    otp = reader.get_latest_otp(
        sender_filter="@forward-sms.com", wait_seconds=60, max_wait=120
    )
    if otp:
        print(f"SUCCESS: OTP = {otp}")
    else:
        print("FAILED: No OTP found")
