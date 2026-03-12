#!/usr/bin/env python3
"""
Generate secure secrets for authentication and encryption.
Run this script and add the output to your .env file.
"""

import secrets
from cryptography.fernet import Fernet

if __name__ == "__main__":
    jwt_secret = secrets.token_hex(32)
    encryption_key = Fernet.generate_key().decode()

    print("=" * 70)
    print("GENERATED SECRETS FOR YOUR .ENV FILE")
    print("=" * 70)
    print("\n# JWT Token Secret (for authentication)")
    print(f"JWT_SECRET_KEY={jwt_secret}\n")
    print("# API Key Encryption Key (for storing user API keys)")
    print(f"API_KEY_ENCRYPTION_KEY={encryption_key}\n")
    print("=" * 70)
    print("⚠️  IMPORTANT: Keep these secrets secure and never commit them to Git!")
    print("=" * 70)
    print("\nCopy the lines above to your .env file")
    print("=" * 70)
