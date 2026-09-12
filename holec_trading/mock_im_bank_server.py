"""
Mock I&M Bank server — for LOCAL TESTING ONLY
--------------------------------------------------
Stands in for I&M Bank's real OAuth + Payment Gateway API so you can
exercise apps/holec_trading/holec_trading/im_bank/treasury.py end-to-end
(token fetch + caching, checksum generation, MakePayment call, Payment
Entry auto-creation, 401-retry) without any real bank credentials.

It does NOT validate the checksum or the client secret — it just accepts
whatever is sent and returns a canned success response, matching the
shape treasury.py expects.

RUN
----
    pip install flask --break-system-packages
    python3 mock_im_bank_server.py

It listens on http://localhost:5000, matching the Bank Account's
Test Service Base Url / Test Token URL fields already configured
(http://localhost:5000 and http://localhost:5000/KEOAuthTokenService/1.0/GetToken).

Leave this running in a separate terminal/tab while you submit a
Payment Approval Queue doc or call test_mpesa_payment() from the
bench console.

WHAT IT LOGS
-------------
Every request is printed to stdout — headers (including checkSum,
requestRefNum, initChannelID) and body — so you can see exactly what
treasury.py sent, which is useful for confirming the payload shape
before you point this at the real bank.

TOGGLING FAILURE MODES
------------------------
Set these env vars before starting the server to test error paths:
    MOCK_IM_BANK_TOKEN_FAIL=1      -> token endpoint returns 401
    MOCK_IM_BANK_PAYMENT_FAIL=1    -> MakePayment returns 400 (failure)
    MOCK_IM_BANK_FORCE_401_ONCE=1  -> first MakePayment call returns 401
                                       (to exercise the token-refresh retry
                                       path), then succeeds on the retry
"""

import os
import time
import uuid

from flask import Flask, request, jsonify

app = Flask(__name__)

_state = {"seen_401_once": False}


@app.route("/KEOAuthTokenService/1.0/GetToken", methods=["POST"])
def get_token():
    print("\n=== GetToken request ===")
    print("form:", dict(request.form))

    if os.environ.get("MOCK_IM_BANK_TOKEN_FAIL"):
        print("-> simulating token failure (401)")
        return jsonify({"error": "invalid_client"}), 401

    token = "dummy-access-token-" + uuid.uuid4().hex[:8]
    print(f"-> issuing token {token}")
    return jsonify({
        "access_token": token,
        "token_type": "Bearer",
        "expires_in": 3600,
    }), 200


@app.route("/MakePayment", methods=["POST"])
def make_payment():
    print("\n=== MakePayment request ===")
    print("headers:", {
        "serviceName": request.headers.get("serviceName"),
        "requestRefNum": request.headers.get("requestRefNum"),
        "initChannelID": request.headers.get("initChannelID"),
        "checkSum": request.headers.get("checkSum"),
        "Authorization": request.headers.get("Authorization"),
    })
    print("body:", request.get_json(silent=True))

    if os.environ.get("MOCK_IM_BANK_FORCE_401_ONCE") and not _state["seen_401_once"]:
        _state["seen_401_once"] = True
        print("-> simulating one-time 401 to exercise token-refresh retry")
        return jsonify({"error": "token_expired"}), 401

    if os.environ.get("MOCK_IM_BANK_PAYMENT_FAIL"):
        print("-> simulating payment failure (400)")
        return jsonify({
            "responseCode": "99",
            "responseMessage": "Simulated failure for testing",
        }), 400

    txn_id = "MOCKTXN" + str(int(time.time() * 1000))[-10:]
    print(f"-> approving payment, transactionId={txn_id}")
    return jsonify({
        "responseCode": "00",
        "responseMessage": "Success",
        "transactionId": txn_id,
    }), 200


if __name__ == "__main__":
    print("Mock I&M Bank server listening on http://localhost:5000")
    print("Endpoints:")
    print("  POST /KEOAuthTokenService/1.0/GetToken")
    print("  POST /MakePayment")
    app.run(host="0.0.0.0", port=5000, debug=False)