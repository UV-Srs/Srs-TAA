import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Load environment variables from backend/.env or root .env
load_dotenv(BASE_DIR / ".env")
load_dotenv(BASE_DIR.parent / ".env")

UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Database Configuration
# Read individual parameters or direct connection string
DB_TYPE = os.getenv("DB_TYPE", "sqlite").lower()
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "taa_inspection")

raw_db_url = os.getenv("DATABASE_URL")

if raw_db_url:
    DATABASE_URL = raw_db_url
elif DB_TYPE == "postgresql" or DB_TYPE == "postgres":
    DATABASE_URL = f"postgresql+psycopg2://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
else:
    DATABASE_URL = f"sqlite:///{BASE_DIR}/taa_inspection.db"

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY environment variable is not set. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
    )
ALGORITHM = os.getenv("ALGORITHM", "HS256")
_ALLOWED_ALGORITHMS = {"HS256", "HS384", "HS512"}
if ALGORITHM not in _ALLOWED_ALGORITHMS:
    raise RuntimeError(
        f"ALGORITHM '{ALGORITHM}' is not allowed. Use one of: {', '.join(sorted(_ALLOWED_ALGORITHMS))}"
    )
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 60 * 24))
