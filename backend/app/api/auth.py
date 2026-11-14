from fastapi import APIRouter, HTTPException, status, Depends
from app.schemas.auth import RegisterRequest, LoginRequest, TokenResponse
from app.core.security import hash_password, verify_password, create_access_token, get_current_user
from app.core.database import get_supabase_admin
import uuid

router = APIRouter(prefix="/api/auth", tags=["Auth"])


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(body: RegisterRequest):
    db = get_supabase_admin()

    # Check email uniqueness
    existing = db.table("users").select("id").eq("email", body.email).execute()
    if existing.data:
        raise HTTPException(status_code=409, detail="Email already registered")

    user_id = str(uuid.uuid4())
    pw_hash = hash_password(body.password)

    result = db.table("users").insert({
        "id": user_id,
        "email": body.email,
        "password_hash": pw_hash,
        "full_name": body.full_name,
        "if_threshold": 70,
    }).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create account")

    token = create_access_token({"sub": user_id, "email": body.email})
    return TokenResponse(
        access_token=token,
        user_id=user_id,
        email=body.email,
        full_name=body.full_name,
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    db = get_supabase_admin()

    result = db.table("users").select("id,email,password_hash,full_name").eq("email", body.email).execute()
    if not result.data:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user = result.data[0]
    if not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token({"sub": user["id"], "email": user["email"]})
    return TokenResponse(
        access_token=token,
        user_id=user["id"],
        email=user["email"],
        full_name=user.get("full_name"),
    )


@router.post("/logout", status_code=204)
async def logout(user: dict = Depends(get_current_user)):
    # Stateless JWT — client simply discards the token.
    # Future: maintain a token blocklist in Redis.
    return None


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user_id": user["sub"], "email": user["email"]}
