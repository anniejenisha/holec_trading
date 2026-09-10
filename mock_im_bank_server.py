"""
Mock I&M Bank server — for LOCAL dummy testing of the ERPNext outgoing
payment flow only. This is NOT the real I&M Bank API.
"""

from flask import Flask, request, jsonify
import time

app = Flask(__name__)


@app.route("/KEOAuthTokenService/1.0/GetToken", methods=["POST"])
def get_token():
    print("=== GetToken request ===")
    print("form:", dict(request.form))
    return jsonify({
        "access_token": "dummy-test-access-token-12345",
        "token_type": "Bearer",
        "expires_in": 3600,
    }), 200


@app.route("/MakePayment", methods=["POST"])
def make_payment():
    print("=== MakePayment request ===")
    print("headers:", dict(request.headers))
    print("body:", request.get_json(silent=True))

    auth = request.headers.get("Authorization", "")
    checksum = request.headers.get("checkSum")
    channel = request.headers.get("initChannelID")
    ref_num = request.headers.get("requestRefNum")

    if not auth.startswith("Bearer "):
        return jsonify({"error": "missing/invalid Authorization header"}), 401
    if not checksum:
        return jsonify({"error": "missing checkSum header"}), 400
    if not channel:
        return jsonify({"error": "missing initChannelID header"}), 400

    return jsonify({
        "responseCode": "0",
        "responseMessage": "Success (MOCK - not a real bank response)",
        "transactionId": f"MOCKTXN{int(time.time())}",
        "requestRefNum": ref_num,
    }), 200


if __name__ == "__main__":
    print("Mock I&M Bank server running on http://0.0.0.0:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)
