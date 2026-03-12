"""
Authentication routes for user registration, login, logout, and profile management.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Depends, Header
from pydantic import BaseModel, Field, field_validator

from app.auth_db import (
    create_user,
    get_user_by_username,
    get_user_by_email,
    get_user_by_id,
    update_last_login,
    increment_failed_login,
    is_user_locked,
    create_session,
    get_session_by_token,
    invalidate_session,
    update_session_activity,
    get_user_search_history,
    get_user_preferences,
    update_user_preferences,
    save_user_api_key,
    get_user_api_key,
    get_user_api_keys,
    delete_user_api_key,
    list_user_providers,
)
from app.auth_utils import (
    hash_password,
    verify_password,
    validate_password_strength,
    validate_email,
    validate_username,
    create_access_token,
    verify_token,
    hash_token,
    sanitize_input,
    AppError,
)


router = APIRouter(prefix="/api/auth", tags=["authentication"])


# Pydantic models
class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=30)
    email: str = Field(..., max_length=100)
    password: str = Field(..., min_length=8, max_length=100)

    @field_validator("username")
    @classmethod
    def validate_username_field(cls, v: str) -> str:
        v = sanitize_input(v, max_length=30)
        valid, msg = validate_username(v)
        if not valid:
            raise ValueError(msg)
        return v

    @field_validator("email")
    @classmethod
    def validate_email_field(cls, v: str) -> str:
        v = sanitize_input(v, max_length=100)
        if not validate_email(v):
            raise ValueError("Invalid email format")
        return v.lower()

    @field_validator("password")
    @classmethod
    def validate_password_field(cls, v: str) -> str:
        valid, msg = validate_password_strength(v)
        if not valid:
            raise ValueError(msg)
        return v


class LoginRequest(BaseModel):
    username: str = Field(..., max_length=100)
    password: str = Field(..., max_length=100)

    @field_validator("username")
    @classmethod
    def sanitize_username(cls, v: str) -> str:
        return sanitize_input(v, max_length=100)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    created_at: str
    last_login: Optional[str]


class PreferencesUpdate(BaseModel):
    theme: Optional[str] = None
    default_provider: Optional[str] = None
    settings: Optional[dict] = None


# Dependency to get current user from token
async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """Get current authenticated user from JWT token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = authorization.split(" ")[1]

    try:
        # Verify JWT token
        payload = verify_token(token)
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")

        # Verify session exists
        token_hash_value = hash_token(token)
        session = get_session_by_token(token_hash_value)
        if not session:
            raise HTTPException(status_code=401, detail="Session not found")

        # Check if session expired
        expires_at = datetime.fromisoformat(session["expires_at"])
        if datetime.now(timezone.utc) > expires_at:
            invalidate_session(token_hash_value)
            raise HTTPException(status_code=401, detail="Session expired")

        # Get user
        user = get_user_by_id(user_id)
        if not user or not user["is_active"]:
            raise HTTPException(status_code=401, detail="User not found or inactive")

        # Update session activity
        update_session_activity(session["id"])

        return user
    except AppError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        raise HTTPException(status_code=401, detail="Authentication failed")


# Routes
@router.post("/register", response_model=UserResponse)
async def register(request: RegisterRequest, req: Request):
    """Register a new user."""
    try:
        # Check if user already exists
        if get_user_by_username(request.username):
            raise HTTPException(status_code=400, detail="Username already taken")
        if get_user_by_email(request.email):
            raise HTTPException(status_code=400, detail="Email already registered")

        # Hash password and create user
        password_hash = hash_password(request.password)
        user_id = create_user(request.username, request.email, password_hash)

        # Get created user
        user = get_user_by_id(user_id)
        if not user:
            raise HTTPException(status_code=500, detail="Failed to create user")

        return UserResponse(
            id=user["id"],
            username=user["username"],
            email=user["email"],
            created_at=user["created_at"],
            last_login=user.get("last_login"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Registration failed")


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest, req: Request):
    """Authenticate user and return JWT token."""
    try:
        # Get user
        user = get_user_by_username(request.username)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid credentials")

        # Check if account is locked
        if is_user_locked(user["id"]):
            raise HTTPException(status_code=403, detail="Account is temporarily locked due to multiple failed login attempts")

        # Verify password
        if not verify_password(request.password, user["password_hash"]):
            increment_failed_login(user["id"])
            raise HTTPException(status_code=401, detail="Invalid credentials")

        # Check if user is active
        if not user["is_active"]:
            raise HTTPException(status_code=403, detail="Account is inactive")

        # Create JWT token
        token_data = {"sub": user["id"], "username": user["username"]}
        access_token = create_access_token(token_data)

        # Create session
        token_hash_value = hash_token(access_token)
        expires_at = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        ip_address = req.client.host if req.client else None
        user_agent = req.headers.get("user-agent")

        create_session(user["id"], token_hash_value, expires_at, ip_address, user_agent)

        # Update last login
        update_last_login(user["id"])

        return LoginResponse(
            access_token=access_token,
            user={
                "id": user["id"],
                "username": user["username"],
                "email": user["email"],
                "created_at": user["created_at"],
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Login failed")


@router.post("/logout")
async def logout(authorization: Optional[str] = Header(None)):
    """Logout user and invalidate session."""
    try:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Not authenticated")

        token = authorization.split(" ")[1]
        token_hash_value = hash_token(token)

        invalidate_session(token_hash_value)

        return {"message": "Logged out successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Logout failed")


@router.get("/me", response_model=UserResponse)
async def get_current_user_profile(current_user: dict = Depends(get_current_user)):
    """Get current user profile."""
    return UserResponse(
        id=current_user["id"],
        username=current_user["username"],
        email=current_user["email"],
        created_at=current_user["created_at"],
        last_login=current_user.get("last_login"),
    )


@router.get("/history")
async def get_history(
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    """Get user's search history."""
    try:
        history = get_user_search_history(current_user["id"], limit)
        return {"history": history}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to fetch history")


@router.get("/preferences")
async def get_preferences(current_user: dict = Depends(get_current_user)):
    """Get user preferences."""
    try:
        prefs = get_user_preferences(current_user["id"])
        return {"preferences": prefs or {}}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to fetch preferences")


@router.put("/preferences")
async def update_preferences(
    prefs: PreferencesUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Update user preferences."""
    try:
        update_user_preferences(
            current_user["id"],
            theme=prefs.theme,
            default_provider=prefs.default_provider,
            settings=prefs.settings,
        )
        return {"message": "Preferences updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to update preferences")


@router.get("/verify")
async def verify_auth(current_user: dict = Depends(get_current_user)):
    """Verify authentication status."""
    return {"authenticated": True, "user": {"id": current_user["id"], "username": current_user["username"]}}


# API Key Management
class ApiKeyRequest(BaseModel):
    provider: str = Field(..., max_length=50)
    api_key: str = Field(..., max_length=500)

    @field_validator("provider")
    @classmethod
    def sanitize_provider(cls, v: str) -> str:
        return sanitize_input(v, max_length=50).lower()


@router.post("/api-keys")
async def save_api_key(
    request: ApiKeyRequest,
    current_user: dict = Depends(get_current_user)
):
    """Save or update user's API key for a provider."""
    try:
        save_user_api_key(current_user["id"], request.provider, request.api_key)
        return {"message": f"API key for {request.provider} saved successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to save API key")


@router.get("/api-keys")
async def get_api_keys(current_user: dict = Depends(get_current_user)):
    """Get all API keys for user (providers only, not the keys themselves)."""
    try:
        providers = list_user_providers(current_user["id"])
        return {"providers": providers}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to fetch API keys")


@router.get("/api-keys/{provider}")
async def get_api_key(
    provider: str,
    current_user: dict = Depends(get_current_user)
):
    """Get API key for a specific provider."""
    try:
        provider = sanitize_input(provider, max_length=50).lower()
        api_key = get_user_api_key(current_user["id"], provider)

        if not api_key:
            raise HTTPException(status_code=404, detail=f"No API key found for {provider}")

        # Mask the key for security (show only first 8 and last 4 chars)
        if len(api_key) > 12:
            masked_key = api_key[:8] + "..." + api_key[-4:]
        else:
            masked_key = "***"

        return {"provider": provider, "api_key": masked_key, "has_key": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to fetch API key")


@router.delete("/api-keys/{provider}")
async def delete_api_key(
    provider: str,
    current_user: dict = Depends(get_current_user)
):
    """Delete API key for a specific provider."""
    try:
        provider = sanitize_input(provider, max_length=50).lower()
        delete_user_api_key(current_user["id"], provider)
        return {"message": f"API key for {provider} deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to delete API key")
