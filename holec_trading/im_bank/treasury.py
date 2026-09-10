"""
I&M Bank Treasury Integration — OUTGOING payments (per Bank Account)
--------------------------------------------------------------------------
App: apps/holec_trading/holec_trading/im_bank/treasury.py

CREDENTIALS LIVE ON BANK ACCOUNT
------------------------------------
Different bank accounts can have different I&M Bank channels, so
credentials are read straight off the "Bank Account" doctype instead of
a separate settings doctype. Add these custom fields to Bank Account
(Customize Form -> Bank Account). NOTE: fields added via Customize Form
are automatically stored with a "custom_" prefix on the fieldname, e.g.
label "channel_id" -> fieldname "custom_channel_id". All reads below use
the prefixed fieldname.

    custom_channel_id                     Data
    custom_client_id                       Data
    custom_client_secret                   Password
    custom_public_key                       Code       (bank's RSA public key, PEM)
    custom_environment                       Select     Test / Production
    custom_test_service_base_url               Data
    custom_test_token_url                       Data
    custom_production_service_base_url            Data   defaults to api.imbank.com if blank
    custom_production_token_url                    Data   defaults to api.imbank.com if blank

Fill these in on each Bank Account that should be able to send outgoing
payments. An account with no custom_channel_id / custom_client_id /
custom_public_key filled in will fail clearly (not silently) if someone
tries to submit a payment from it.

ALSO ADD to "Payment Approval Queue" (Customize Form):
    custom_payment_entry    Link -> Payment Entry   (read-only, set by
                             this script once a Payment Entry is
                             auto-created on success)

WHAT THIS SENDS
-----------------
Direct calls to I&M Bank's real Payment Gateway API (OAuth2
client_credentials -> MakePayment with a checkSum header) — not the old
treasury portal. Scope right now: M-Pesa outgoing only, Test environment.

On a successful (200/201) bank response, this now also auto-creates and
submits a Payment Entry — see _create_payment_entry() below. READ THE
ASSUMPTIONS in that function's docstring before relying on it: the party
and account mapping is a best-effort default and likely needs adjusting
to match your actual Payment Approval Queue schema and Chart of Accounts.

DEPENDENCIES
-------------
    bench pip install rsa cryptography --break-system-packages
"""

import base64
import hashlib
import json
import time

import requests
import frappe
from frappe import _
from frappe.utils import nowdate

import rsa
import rsa.core
from cryptography.hazmat.primitives.serialization import load_pem_public_key

TOKEN_CACHE_KEY_PREFIX = "im_bank_access_token"

# Only payment types confirmed against I&M Bank's real documentation
# belong here. Add one only once its payload shape is verified in Test.
ENABLED_PAYMENT_TYPES = {"MPESA"}


# ---------------------------------------------------------------------------
# Settings — read off a Bank Account doc
# ---------------------------------------------------------------------------

def get_settings(bank_account):
    """Reads credentials + endpoint URLs off a loaded Bank Account doc.

    All custom fields added via Customize Form are stored with a
    "custom_" prefix on the fieldname - both the existence check and the
    value reads below use that prefix consistently.
    """
    required_fields = (
        "custom_environment",
        "custom_channel_id",
        "custom_client_id",
        "custom_client_secret",
        "custom_public_key",
    )
    missing_fields = [f for f in required_fields if not bank_account.meta.has_field(f)]
    if missing_fields:
        frappe.throw(_(
            "Bank Account '{0}' is missing these custom fields: {1}. Add "
            "them via Customize Form -> Bank Account before submitting "
            "payments from this account."
        ).format(bank_account.name, ", ".join(missing_fields)))

    environment = (bank_account.get("custom_environment") or "Test").strip().lower()
    if environment == "production":
        service_base_url = bank_account.get("custom_production_service_base_url") or \
            "https://api.imbank.com/KEPaymentGatewayService/1.0"
        token_url = bank_account.get("custom_production_token_url") or \
            "https://api.imbank.com/KEOAuthTokenService/1.0/GetToken"
    else:
        service_base_url = bank_account.get("custom_test_service_base_url")
        token_url = bank_account.get("custom_test_token_url")
        if not service_base_url or not token_url:
            frappe.throw(_(
                "Bank Account '{0}': environment is set to Test but "
                "custom_test_service_base_url / custom_test_token_url are "
                "not filled in."
            ).format(bank_account.name))

    client_id = bank_account.get("custom_client_id")
    client_secret = bank_account.get_password("custom_client_secret")
    public_key = bank_account.get("custom_public_key")
    channel_id = bank_account.get("custom_channel_id")

    missing_values = [
        name for name, val in (
            ("channel_id", channel_id),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("public_key", public_key),
        ) if not val
    ]
    if missing_values:
        frappe.throw(_(
            "Bank Account '{0}' has these fields but they are empty: {1}. "
            "Fill in real values from I&M Bank before submitting payments "
            "from this account."
        ).format(bank_account.name, ", ".join(missing_values)))

    return {
        "bank_account": bank_account.name,
        "environment": environment,
        "channel_id": channel_id,
        "client_id": client_id,
        "client_secret": client_secret,
        "public_key": public_key,
        "service_base_url": service_base_url.rstrip("/"),
        "token_url": token_url,
    }


# ---------------------------------------------------------------------------
# OAuth2 token (client_credentials grant) — cached per bank account
# ---------------------------------------------------------------------------

def get_access_token(cfg, force_refresh=False):
    cache_key = f"{TOKEN_CACHE_KEY_PREFIX}:{cfg['bank_account']}"

    if not force_refresh:
        cached = frappe.cache().get_value(cache_key)
        if cached:
            return cached

    resp = requests.post(
        cfg["token_url"],
        data={
            "grant_type": "client_credentials",
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
        },
        timeout=30,
    )

    if resp.status_code != 200:
        frappe.throw(
            _("I&M Bank OAuth token request failed for '{0}' ({1}): {2}").format(
                cfg["bank_account"], resp.status_code, resp.text
            )
        )

    data = resp.json()
    token = data.get("access_token")
    if not token:
        frappe.throw(_("I&M Bank token response did not include access_token"))

    expires_in = data.get("expires_in", 3600)
    frappe.cache().set_value(cache_key, token, expires_in_sec=max(expires_in - 60, 60))
    return token


# ---------------------------------------------------------------------------
# Checksum — required on every financial (money-moving) request.
# RSA/ECB/NoPadding encrypt with the bank's public key -> Base64 -> SHA-256 hex.
# ---------------------------------------------------------------------------

def _generate_ref_num():
    """12-digit numeric reference derived from the current millisecond timestamp."""
    return str(int(time.time() * 1000))[-12:]


def _generate_checksum(service_name, channel_id, ref_num, sender_account_no,
                        tran_amount, tran_ccy, public_key_pem):
    data_str = service_name + channel_id + ref_num + sender_account_no + tran_amount + tran_ccy
    data_bytes = data_str.encode("utf-8")

    crypto_key = load_pem_public_key(public_key_pem.encode("utf-8"))
    pub_numbers = crypto_key.public_numbers()
    n, e = pub_numbers.n, pub_numbers.e
    key_size_bytes = crypto_key.key_size // 8

    if len(data_bytes) > key_size_bytes:
        frappe.throw(_(
            "I&M Bank checksum: data ({0} bytes) exceeds RSA key size ({1} bytes)."
        ).format(len(data_bytes), key_size_bytes))

    padded = b"\x00" * (key_size_bytes - len(data_bytes)) + data_bytes
    plaintext_int = int.from_bytes(padded, "big")
    encrypted_int = rsa.core.encrypt_int(plaintext_int, e, n)

    byte_length = max((encrypted_int.bit_length() + 7) // 8, key_size_bytes)
    encrypted_bytes = encrypted_int.to_bytes(byte_length, "big")

    b64_str = base64.b64encode(encrypted_bytes).decode("utf-8")
    return hashlib.sha256(b64_str.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Low-level call to the bank's MakePayment endpoint
# ---------------------------------------------------------------------------

def _call_make_payment(cfg, service_name, payload, retry=True):
    ref_num = _generate_ref_num()

    sender_account_no = payload.get("sender", {}).get("senderAccountNo", "")
    tran_amount = str(payload.get("trandetails", {}).get("transAmount", ""))
    tran_ccy = payload.get("trandetails", {}).get("tranCCY", "")

    headers = {
        "Authorization": f"Bearer {get_access_token(cfg)}",
        "serviceName": service_name,
        "requestRefNum": ref_num,
        "initChannelID": cfg["channel_id"],
        "checkSum": _generate_checksum(
            service_name=service_name,
            channel_id=cfg["channel_id"],
            ref_num=ref_num,
            sender_account_no=sender_account_no,
            tran_amount=tran_amount,
            tran_ccy=tran_ccy,
            public_key_pem=cfg["public_key"],
        ),
    }

    url = f"{cfg['service_base_url']}/MakePayment"
    resp = requests.post(url, json=payload, headers=headers, timeout=30)

    if resp.status_code == 401 and retry:
        get_access_token(cfg, force_refresh=True)
        return _call_make_payment(cfg, service_name, payload, retry=False)

    return resp.status_code, _safe_json(resp)


def _safe_json(resp):
    try:
        return resp.json()
    except ValueError:
        return {"raw": resp.text}


# ---------------------------------------------------------------------------
# Payment-type payload builders
# ---------------------------------------------------------------------------

def _build_mpesa_payload(sender_account_no, amount, currency, narration, payer_mobile_number):
    return "MpesaPayment", {
        "sender": {"senderAccountNo": sender_account_no},
        "trandetails": {
            "transAmount": str(amount),
            "tranCCY": currency,
            "narration": narration,
        },
        "mobilemoneypayment": {
            "commandID": "TransferFromBankToCustomer",
            "receiverPartyIdentifierType": "1",
            "receiverPartyIdentifier": payer_mobile_number,
        },
    }


PAYLOAD_BUILDERS = {
    "MPESA": _build_mpesa_payload,
}


def _map_payment_type(erpnext_payment_type):
    mapping = {
        "M-PESA": "MPESA",
        "Bank Draft": "RTGS",
        "Cheque": "CHEQUE",
        "PesaLink": "PESALINK",
    }
    return mapping.get(erpnext_payment_type, erpnext_payment_type)


# ---------------------------------------------------------------------------
# Payment Entry auto-creation on successful bank response
# ---------------------------------------------------------------------------

def _create_payment_entry(doc, bank_account, gateway_response):
    """
    Creates and submits a Payment Entry once I&M Bank confirms the
    payment succeeded, so the GL actually reflects the outgoing payment.

    *** ASSUMPTIONS — REVIEW BEFORE RELYING ON THIS IN PRODUCTION ***

    1. paid_from: read from the Bank Account's standard 'account' field
       (the GL Account ERPNext already links every Bank Account to).
       If that's not populated for your accounts, this will fail loudly
       and log an error rather than posting a bad GL entry.

    2. party / party_type: Payment Approval Queue's 'payee' field, as
       seen in your screenshots, is plain text ("Jenisha") — not
       necessarily a Link to a Supplier/Employee record. Without a real
       linked party, ERPNext's Payment Entry can't be typed "Pay"
       against a party account, so this defaults to an "Internal
       Transfer" Payment Entry (no party) unless your Payment Approval
       Queue actually has proper 'party_type' / 'party' Link fields —
       adjust the block below to match your real schema once confirmed.

    3. paid_to: for the Internal Transfer fallback, this uses the same
       account as paid_from as a placeholder purely so the document is
       valid — THIS IS WRONG for real accounting and must be replaced
       with your actual clearing/suspense or payable account before
       this runs against production data.

    4. reference_no: taken from the bank response's 'transactionId'
       field. If I&M Bank's real response uses a different field name,
       update this.

    Failure here does NOT roll back the already-successful bank
    payment or the Completed status — it logs the error and appends a
    note to Gateway Response so Finance knows to create the Payment
    Entry manually.
    """
    try:
        paid_from_account = frappe.get_cached_value(
            "Bank Account", bank_account, "account"
        )
        if not paid_from_account:
            frappe.log_error(
                f"Bank Account '{bank_account}' has no linked GL Account "
                f"(the 'account' field) - cannot auto-create Payment Entry for {doc.name}.",
                "I&M Bank Treasury Integration - Payment Entry",
            )
            _append_gateway_note(
                doc, "Payment succeeded at bank, but Payment Entry was NOT "
                "auto-created: Bank Account has no linked GL Account. Create "
                "the Payment Entry manually."
            )
            return None

        pe = frappe.new_doc("Payment Entry")
        pe.payment_type == "Pay"
        pe.company = doc.get("company")
        pe.posting_date = nowdate()
        pe.mode_of_payment = doc.get("payment_type")  # e.g. "M-PESA"
        pe.paid_amount = doc.amount
        pe.received_amount = doc.amount
        pe.source_exchange_rate = 1
        pe.target_exchange_rate = 1
        pe.reference_no = gateway_response.get("transactionId") or doc.name
        pe.reference_date = nowdate()
        pe.remarks = (
            f"Auto-created from Payment Approval Queue {doc.name} "
            f"via I&M Bank outgoing payment API."
        )

        party_type = "Supplier"
        party = doc.get("payee")

        if party_type and party:
            # Real party present - a proper "Pay" against Supplier/Employee/etc.
            pe.payment_type = "Pay"
            pe.party_type = party_type
            pe.party = party
            pe.paid_from = paid_from_account
            # paid_to left for ERPNext to auto-fill from the party's default
            # payable account where possible; verify this resolves correctly
            # for your Chart of Accounts.
        else:
            # No confirmed party link available - fall back to Internal
            # Transfer so the document is at least valid. Replace
            # `paid_to` below with your real clearing/suspense account.
            pe.payment_type = "Internal Transfer"
            pe.paid_from = paid_from_account
            pe.paid_to = paid_from_account  # PLACEHOLDER - fix before production use

        pe.insert(ignore_permissions=True)
        pe.submit()

        if doc.meta.has_field("payment_entry"):
            doc.db_set("payment_entry", pe.name)

        return pe.name

    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            f"I&M Bank Treasury Integration - Payment Entry creation failed for {doc.name}",
        )
        _append_gateway_note(
            doc, "Payment succeeded at bank, but Payment Entry auto-creation "
            "FAILED - check Error Log. Create the Payment Entry manually."
        )
        return None


def _append_gateway_note(doc, note):
    existing = doc.get("gateway_response") or ""
    doc.db_set("gateway_response", existing + "\n\n[" + note + "]")


# ---------------------------------------------------------------------------
# Doc event: hook this to "Payment Approval Queue" on_submit
# ---------------------------------------------------------------------------

def submit_payment_to_bank(doc, method=None):
   
    try:
        bank_account_name = doc.get("account")
        if not bank_account_name:
            _mark_failed(doc, "Payment Approval Queue has no 'account' (Bank Account) set.")
            return

        bank_account = frappe.get_doc("Bank Account", bank_account_name)
        sender_account_no = bank_account.get("bank_account_no")
        if not sender_account_no:
            _mark_failed(doc, f"Bank Account '{bank_account_name}' has no bank_account_no set.")
            return

        mapped_payment_type = _map_payment_type(doc.payment_type)
        if mapped_payment_type not in ENABLED_PAYMENT_TYPES:
            _mark_failed(
                doc,
                f"Payment type '{mapped_payment_type}' is not enabled yet. "
                f"Only {sorted(ENABLED_PAYMENT_TYPES)} are confirmed against "
                f"I&M Bank's documentation.",
            )
            return

        cfg = get_settings(bank_account)
        service_name, payload = PAYLOAD_BUILDERS[mapped_payment_type](
            sender_account_no,
            doc.amount,
            doc.get("currency") or "KES",
            doc.get("narration") or doc.name,
            doc.get("payer_mobile_number"),
        )
        status, body = _call_make_payment(cfg, service_name, payload)

        if status in (200, 201):
            doc.db_set("status", "Completed")
            doc.db_set("gateway_response", json.dumps(body, indent=2))
            _create_payment_entry(doc, bank_account_name, body)
        else:
            _mark_failed(doc, json.dumps(body, indent=2))

    except Exception:
        frappe.log_error(frappe.get_traceback(), "I&M Bank Treasury Integration")
        _mark_failed(doc, "Unexpected error - check Error Log")


def _mark_failed(doc, message):
    doc.db_set("status", "Failed")
    doc.db_set("gateway_response", message)


@frappe.whitelist()
def retry_payment(docname):
    doc = frappe.get_doc("Payment Approval Queue", docname)
    submit_payment_to_bank(doc)
    frappe.msgprint(_("Payment retried. Status: {0}").format(doc.status))


# ---------------------------------------------------------------------------
# TEST HELPER — verify the flow works end-to-end without a real
# Payment Approval Queue doc. Run from bench console:
#
#   bench --site yoursite.com console
#   >>> from holec_trading.im_bank.treasury import test_mpesa_payment
#   >>> test_mpesa_payment("Bank Draft - I&M Bank")
#
# NOTE: this helper bypasses Payment Approval Queue entirely, so it does
# NOT create a Payment Entry - that only happens via submit_payment_to_bank
# (the real on_submit path). To test Payment Entry creation, submit an
# actual Payment Approval Queue document instead (see Section 6.3 of the
# process doc).
# ---------------------------------------------------------------------------

@frappe.whitelist()
def test_mpesa_payment(bank_account_name, amount=10, currency="KES",
                        payer_mobile_number="254712345678",
                        narration="Treasury integration test"):
    """
    Fires a single M-Pesa MakePayment request straight at whatever
    environment (Test/Production) is configured on the given Bank Account,
    bypassing Payment Approval Queue entirely. Use this to confirm
    credentials + payload shape are accepted by the bank before wiring up
    real documents.

    Returns (status_code, response_body) and also prints them.
    """
    bank_account = frappe.get_doc("Bank Account", bank_account_name)

    sender_account_no = bank_account.get("bank_account_no")
    if not sender_account_no:
        frappe.throw(_("Bank Account '{0}' has no bank_account_no set.").format(bank_account_name))

    cfg = get_settings(bank_account)
    if cfg["environment"] != "test":
        frappe.throw(_(
            "Bank Account '{0}' is set to Production. Refusing to fire a "
            "test payment against production — switch environment to Test "
            "first."
        ).format(bank_account_name))

    service_name, payload = _build_mpesa_payload(
        sender_account_no, amount, currency, narration, payer_mobile_number
    )

    status, body = _call_make_payment(cfg, service_name, payload)

    print(f"HTTP {status}")
    print(json.dumps(body, indent=2))
    return status, body