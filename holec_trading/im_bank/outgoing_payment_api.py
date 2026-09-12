"""
I&M Bank Treasury Integration — Third-party OUTGOING payment API
--------------------------------------------------------------------------
App: apps/holec_trading/holec_trading/im_bank/outgoing_payment_api.py

WHAT THIS IS
-------------
A whitelisted endpoint a third-party system calls to trigger an outgoing
payment, mirroring your existing incoming-webhook pattern but for money
going OUT. It creates a Payment Approval Queue document from the request,
submits it (which hands off to the existing treasury.py flow via the
on_submit hook), and returns the bank's result to the caller.

    POST /api/method/holec_trading.im_bank.outgoing_payment_api.create_outgoing_payment

REQUIRED PRE-WORK — DO THIS BEFORE USING THIS FILE
-----------------------------------------------------
1. Change "Payment Approval Queue" -> "payee" from Data to a Link field
   pointed at Supplier (Customize Form -> Payment Approval Queue). Your
   current free-text payee ("Jenisha") won't satisfy this — any existing
   documents with non-matching payee text will not be readable as a
   Supplier link after the fieldtype change, so audit existing records
   first if this doctype already has production data in it.

2. Add a new custom field to "Payment Approval Queue" for idempotency:
       custom_external_reference    Data, Unique
   Third parties WILL retry webhook calls on timeout. Without a
   unique idempotency key, a retried call creates a second real
   payment for the same underlying transaction. This field is what
   prevents that.

3. Revert the "Payment Approval Queue" doc_event hook from "validate"
   back to "on_submit" in hooks.py:
       "Payment Approval Queue": {
           "on_submit": "holec_trading.im_bank.treasury.submit_payment_to_bank"
       }
   This endpoint explicitly calls doc.submit() to trigger the bank
   call — if the hook is still on "validate", the bank call fires
   during doc.insert() below (before company/approval logic in
   .submit() has even run), and doc.submit() will then also try to
   run through submission a second time. Get the hook back on
   on_submit before wiring this up.

4. Add the idempotency guard to submit_payment_to_bank() we discussed
   earlier:
       if doc.get("status") in ("Completed", "Failed"):
           return
   Belt-and-suspenders alongside the external_reference dedupe below.

5. Create a dedicated integration User (e.g. "im-bank-outgoing-api@yourcompany.com")
   with ONLY the role created in step 6 — do not reuse an admin/existing
   user's API key for this. Generate an API key/secret for that user under
   User -> Settings -> API Access -> Generate Keys. The third party
   authenticates by sending:
       Authorization: token <api_key>:<api_secret>
   as a request header. This is Frappe's standard, built-in API-key
   auth — no custom token-checking code is needed for this part, but
   the ROLE CHECK below is still required, since API-key auth alone
   just proves *a* valid ERPNext user is calling, not that they're
   allowed to move money.

6. Create a Role called "Outgoing Payment API" (Setup -> Role), assign
   it ONLY to the integration user from step 5, and grant that role
   Create + Submit permission on Payment Approval Queue and Read-only
   permission on Supplier and Bank Account. Do not grant it permissions
   on anything else — this user's credentials will live outside your
   infrastructure, on the third party's system.

DESIGN NOTE WORTH CONFIRMING
-------------------------------
This endpoint auto-submits the Payment Approval Queue document the
moment it's created — there is no human-in-the-loop approval step
between the third party's call and money leaving via I&M Bank. Given
the doctype is literally named "Approval Queue," it's worth explicitly
confirming this is the intended design (fully automated, no review)
versus a design where this endpoint should create the document as a
Draft and a human still has to open and submit it. The code below
implements the fully-automated version per the steps you described;
swap doc.submit() for a plain doc.insert() further down if you want
the human-review version instead.

DEPENDENCIES
-------------
None beyond what treasury.py already needs.
"""

import frappe
from frappe import _

REQUIRED_ROLE = "Outgoing Payment API"

# Same mapping treasury.py uses — keep in sync, or better, import it
# directly from treasury.py once you're ready (from holec_trading.im_bank.treasury
# import ENABLED_PAYMENT_TYPES, _map_payment_type) instead of duplicating it here.
from holec_trading.im_bank.treasury import ENABLED_PAYMENT_TYPES, _map_payment_type


def _authorize():
    """Confirms the calling user authenticated (via API key/secret) AND
    holds the dedicated role for this integration. API-key auth alone
    only proves *some* valid user is calling — the role check is what
    actually limits who that can be.
    """
    if frappe.session.user == "Guest":
        frappe.throw(_("Authentication required."), frappe.AuthenticationError)

    if REQUIRED_ROLE not in frappe.get_roles(frappe.session.user):
        frappe.throw(
            _("User '{0}' is not permitted to call this endpoint.").format(frappe.session.user),
            frappe.PermissionError,
        )


def _respond(http_status_code, payload):
    frappe.local.response.http_status_code = http_status_code
    return payload


@frappe.whitelist(methods=["POST"])
def create_outgoing_payment(
    supplier=None,
    amount=None,
    currency=None,
    bank_account=None,
    payer_mobile_number=None,
    company=None,
    payment_type="M-PESA",
    narration=None,
    external_reference=None,
):
    """
    Creates and submits a Payment Approval Queue document from a
    third-party request, then returns the outcome of the outgoing
    payment attempt (which happens synchronously, inline, during this
    request — see the timeout note below).

    Required params: supplier, amount, currency, bank_account,
    payer_mobile_number, company, external_reference.

    external_reference is REQUIRED (not optional) — it's the caller's
    idempotency key. Reusing the same value on retry returns the
    original result instead of creating a duplicate payment.

    Returns a JSON body with: reference (Payment Approval Queue name),
    status (Completed / Failed), gateway_response, payment_entry (if
    one was created), and duplicate (true if this external_reference
    was already processed and no new payment was attempted).
    """
    _authorize()

    # ---- required-field validation --------------------------------
    missing = [
        name for name, val in (
            ("supplier", supplier),
            ("amount", amount),
            ("currency", currency),
            ("bank_account", bank_account),
            ("payer_mobile_number", payer_mobile_number),
            ("company", company),
            ("external_reference", external_reference),
        ) if not val
    ]
    if missing:
        return _respond(400, {
            "error": f"Missing required field(s): {', '.join(missing)}"
        })

    mapped_payment_type = _map_payment_type(payment_type)
    if mapped_payment_type not in ENABLED_PAYMENT_TYPES:
        return _respond(400, {
            "error": f"Payment type '{payment_type}' is not enabled. "
                     f"Supported: {sorted(ENABLED_PAYMENT_TYPES)}"
        })

    if not frappe.db.exists("Supplier", supplier):
        return _respond(404, {"error": f"Supplier '{supplier}' not found."})

    if not frappe.db.exists("Bank Account", bank_account):
        return _respond(404, {"error": f"Bank Account '{bank_account}' not found."})

    try:
        amount = float(amount)
    except (TypeError, ValueError):
        return _respond(400, {"error": f"Invalid amount: {amount!r}"})
    if amount <= 0:
        return _respond(400, {"error": "amount must be greater than zero."})

    # ---- idempotency: has this external_reference been seen before? ----
    existing_name = frappe.db.get_value(
        "Payment Approval Queue",
        {"custom_external_reference": external_reference},
        "name",
    )
    if existing_name:
        existing = frappe.get_doc("Payment Approval Queue", existing_name)
        return _respond(200, {
            "reference": existing.name,
            "status": existing.get("status"),
            "gateway_response": existing.get("gateway_response"),
            "payment_entry": existing.get("payment_entry"),
            "duplicate": True,
        })

    # ---- create + submit ------------------------------------------
    # NOTE: I&M Bank's MakePayment call happens synchronously inside
    # doc.submit() (via the on_submit hook), so this HTTP request stays
    # open for as long as that bank call takes. If I&M Bank is slow or
    # the third party's own HTTP client times out before the bank
    # responds, the third party may see a timeout even though the
    # payment succeeded (or is still processing) on ERPNext's side —
    # they should always poll GET-style by external_reference (you'd
    # need a small companion lookup endpoint for that) rather than
    # assume a timeout means failure. Consider moving the bank call to
    # a background job (frappe.enqueue) and having this endpoint return
    # immediately with a "Pending" status if that risk matters for your
    # third party's integration.
    try:
        doc = frappe.new_doc("Payment Approval Queue")
        doc.company = company
        doc.payee = supplier  # requires payee to be Link -> Supplier; see file docstring
        doc.payment_type = payment_type
        doc.amount = amount
        doc.currency = currency
        doc.account = bank_account
        doc.payer_mobile_number = payer_mobile_number
        doc.narration = narration or f"Third-party initiated payment ({external_reference})"
        doc.custom_external_reference = external_reference

        doc.insert(ignore_permissions=True)
        doc.submit()  # triggers submit_payment_to_bank() via on_submit hook
        doc.reload()

    except frappe.ValidationError as e:
        frappe.log_error(frappe.get_traceback(), "Outgoing Payment API - validation error")
        return _respond(400, {"error": str(e)})

    except Exception:
        frappe.log_error(frappe.get_traceback(), "Outgoing Payment API - unexpected error")
        return _respond(500, {"error": "Unexpected error creating the payment. Check Error Log."})

    status_code = 201 if doc.get("status") == "Completed" else 200
    return _respond(status_code, {
        "reference": doc.name,
        "status": doc.get("status"),
        "gateway_response": doc.get("gateway_response"),
        "payment_entry": doc.get("payment_entry"),
        "duplicate": False,
    })