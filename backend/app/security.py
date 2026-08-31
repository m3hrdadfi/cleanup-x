import base64
import hashlib
import secrets
from pathlib import Path
from urllib.parse import urlencode

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException, Request

from .config import get_settings


def _key() -> bytes:
    configured = get_settings().encryption_key.strip()
    if configured:
        try:
            Fernet(configured.encode())
            return configured.encode()
        except (ValueError, TypeError):
            return base64.urlsafe_b64encode(hashlib.sha256(configured.encode()).digest())
    key_path = Path(__file__).resolve().parents[2] / "data" / ".encryption-key"
    if key_path.exists():
        return key_path.read_bytes().strip()
    key_path.parent.mkdir(parents=True, exist_ok=True)
    generated = Fernet.generate_key()
    key_path.write_bytes(generated + b"\n")
    key_path.chmod(0o600)
    return generated


def encrypt(value: str) -> str:
    return Fernet(_key()).encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    try:
        return Fernet(_key()).decrypt(value.encode()).decode()
    except InvalidToken as exc:
        raise RuntimeError(
            "Stored credential cannot be decrypted. Check APP_ENCRYPTION_KEY."
        ) from exc


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


async def require_csrf(request: Request) -> None:
    if get_settings().is_testing:
        return
    cookie = request.cookies.get("cleanup_csrf")
    header = request.headers.get("X-CSRF-Token")
    if not cookie or not header or not secrets.compare_digest(cookie, header):
        raise HTTPException(status_code=403, detail="Missing or invalid CSRF token")


def create_pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    )
    return verifier, challenge


def oauth_authorize_url(state: str, challenge: str, credentials=None) -> str:
    settings = credentials or get_settings()
    query = urlencode(
        {
            "response_type": "code",
            "client_id": settings.x_client_id,
            "redirect_uri": settings.x_callback_url,
            "scope": "tweet.read tweet.write users.read offline.access",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    return f"https://x.com/i/oauth2/authorize?{query}"
