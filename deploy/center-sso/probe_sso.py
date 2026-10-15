# Sonda ASGI del SSO de Center (patrón del proyecto): router aislado, usuario y BD simulados.
# Se ejecuta dentro del contenedor del backend antes de activar el router.
import asyncio
import base64
import hashlib
import secrets
import uuid
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi import FastAPI

from app.api import sso
from app.core.database import get_db
from app.core.security import decode_token, get_current_user

user = SimpleNamespace(id=uuid.uuid4(), name="Prueba SSO", email="sso@test.local", role="admin", status="active")
app = FastAPI()
app.include_router(sso.router)
app.dependency_overrides[get_current_user] = lambda: user


async def fake_db():
    yield None


async def fake_load(db, uid):
    return user if uid == str(user.id) else None


app.dependency_overrides[get_db] = fake_db
sso._load_user = fake_load

RURI = "https://ringover.duckdns.org/auth/center/callback"


def pkce():
    v = secrets.token_urlsafe(48)
    return v, base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b"=").decode()


def ok(cond, msg):
    print(("OK  " if cond else "FALLO ") + msg)


async def main():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/auth/sso/clients/ringover")
        ok(r.status_code == 200 and r.json()["name"].startswith("Llamadas"), "nombre de la app")
        v, ch = pkce()
        base = {"client_id": "ringover", "redirect_uri": RURI, "state": "st4te", "code_challenge": ch}
        r = await c.post("/api/auth/sso/authorize", json={**base, "redirect_uri": "https://malo.test/cb"})
        ok(r.status_code == 400, "rechaza URL de vuelta no registrada")
        r = await c.post("/api/auth/sso/authorize", json={**base, "code_challenge": "corto"})
        ok(r.status_code == 400, "exige PKCE")
        r = await c.post("/api/auth/sso/authorize", json=base)
        ok(r.status_code == 200, "autoriza con sesión")
        q = parse_qs(urlparse(r.json()["redirect"]).query)
        code = q["code"][0]
        ok(r.json()["redirect"].startswith(RURI) and q["state"] == ["st4te"], "vuelve a la app con code y state")
        tb = {"client_id": "ringover", "redirect_uri": RURI, "code": code, "code_verifier": v}
        r = await c.post("/api/auth/sso/token", json=tb, headers={"X-Real-IP": "1.2.3.4"})
        ok(r.status_code == 403, "canje bloqueado desde internet (vía nginx)")
        r = await c.post("/api/auth/sso/token", json={**tb, "code_verifier": pkce()[0]})
        ok(r.status_code == 400, "rechaza verifier incorrecto")
        r = await c.post("/api/auth/sso/token", json=tb)
        d = r.json()
        ok(r.status_code == 200 and d["user"]["email"] == "sso@test.local", "canje correcto devuelve el usuario")
        ok(decode_token(d["access_token"])["sub"] == str(user.id), "token de Center válido para /me")
        r = await c.post("/api/auth/sso/token", json=tb)
        ok(r.status_code == 400 and "usado" in r.text, "código de un solo uso")
        r = await c.post("/api/auth/sso/token", json={**tb, "code": code + "x"})
        ok(r.status_code == 400, "rechaza código manipulado")


asyncio.run(main())
