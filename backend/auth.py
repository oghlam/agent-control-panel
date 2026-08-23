from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.transport import requests
from google.oauth2 import id_token

from .config import settings


bearer = HTTPBearer(auto_error=False)


def require_google_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict[str, str]:
    if not settings.google_client_id:
        raise HTTPException(status_code=503, detail="GOOGLE_CLIENT_ID is not configured")
    if credentials is None:
        raise HTTPException(status_code=401, detail="Google sign-in required")
    try:
        claims = id_token.verify_oauth2_token(
            credentials.credentials,
            requests.Request(),
            settings.google_client_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid Google ID token") from exc
    email = str(claims.get("email", ""))
    admin_emails = {
        value.strip().lower()
        for value in settings.admin_emails.split(",")
        if value.strip()
    }
    return {
        "sub": str(claims["sub"]),
        "email": email,
        "name": str(claims.get("name", "")),
        "role": "admin" if email.lower() in admin_emails else "agent",
    }


def require_admin(user: dict[str, str] = Depends(require_google_user)) -> dict[str, str]:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Administrator role required")
    return user
