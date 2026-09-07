import base64
import hashlib
import json
import logging
import time
import rsa
import rsa.core
import requests
from cryptography.hazmat.primitives.serialization import load_pem_public_key

logger = logging.getLogger(__name__)

SERVICE_BASE_URL = "https://api.imbank.com/KEPaymentGatewayService/1.0"
TOKEN_URL = "https://api.imbank.com/KEOAuthTokenService/1.0/GetToken"

def _generate_ref_num() -> str:
    return str(int(time.time() * 1000))[-12:]

def _generate_checksum(service_name, channel_id, ref_num, sender_account_no, tran_amount, tran_ccy, public_key_pem) -> str:
    data_str = service_name + channel_id + ref_num + sender_account_no + tran_amount + tran_ccy
    data_bytes = data_str.encode("utf-8")
    crypto_key = load_pem_public_key(public_key_pem.encode("utf-8"))
    pub_numbers = crypto_key.public_numbers()
    n, e, key_size_bytes = pub_numbers.n, pub_numbers.e, crypto_key.key_size // 8
    
    padded = b"\x00" * (key_size_bytes - len(data_bytes)) + data_bytes
    encrypted_int = rsa.core.encrypt_int(int.from_bytes(padded, "big"), e, n)
    encrypted_bytes = encrypted_int.to_bytes(max((encrypted_int.bit_length() + 7) // 8, key_size_bytes), "big")
    
    b64_str = base64.b64encode(encrypted_bytes).decode("utf-8")
    return hashlib.sha256(b64_str.encode("utf-8")).hexdigest()

class IMBankClient:
    def __init__(self, bank_account_doc):
        self.bank_account = bank_account_doc
        self.channel_id = bank_account_doc.get("custom_channel_id") or ""
        raw_creds = bank_account_doc.get("custom_auth_credentials") or "{}"
        self.credentials = json.loads(raw_creds) if isinstance(raw_creds, str) else raw_creds
        self._session = requests.Session()
        self._session.headers.update({"Content-Type": "application/json"})
        self._access_token = None
        self._token_expires_at = 0.0

    def _get_valid_token(self) -> str:
        if self._access_token is None or time.time() >= self._token_expires_at:
            resp = requests.post(TOKEN_URL, data={
                "grant_type": "client_credentials",
                "client_id": self.credentials.get("client_id"),
                "client_secret": self.credentials.get("client_secret"),
            }, timeout=30)
            resp.raise_for_status()
            token_data = resp.json()
            self._access_token = token_data["access_token"]
            self._token_expires_at = time.time() + token_data.get("expires_in", 3600) - 60
        return self._access_token

    def transfer_rtgs(self, sender_account, sender_name, receiver_account, receiver_name, receiver_bic, amount) -> dict:
        ref_num = _generate_ref_num()
        service_name = "RTGSPayment"
        payload = {
            "sender": {"senderAccountNo": sender_account, "senderName": sender_name},
            "receiver": {"receiverAccountNo": receiver_account, "receiverAccountFullName": receiver_name, "receiverBankBICCode": receiver_bic},
            "trandetails": {"transAmount": str(amount), "tranCCY": "KES", "eventID": "FBILL_OUT_RTGS_COMM"}
        }
        headers = {
            "Authorization": f"Bearer {self._get_valid_token()}",
            "serviceName": service_name,
            "requestRefNum": ref_num,
            "initChannelID": self.channel_id,
            "checkSum": _generate_checksum(service_name, self.channel_id, ref_num, sender_account, str(amount), "KES", self.credentials.get("public_key", ""))
        }
        resp = self._session.post(f"{SERVICE_BASE_URL}/MakePayment", json=payload, headers=headers, timeout=30)
        resp.raise_for_status()
        return resp.json()