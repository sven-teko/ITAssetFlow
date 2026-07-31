import logging

from supabase import Client, create_client

from config import (
    SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_URL,
    validate_config,
)


logger = logging.getLogger(__name__)

_client: Client | None = None


def get_supabase_client() -> Client:
    """Create and return the shared Supabase client."""
    global _client

    if _client is None:
        logger.info("Initializing Supabase client...")

        try:
            validate_config()

            _client = create_client(
                SUPABASE_URL,
                SUPABASE_PUBLISHABLE_KEY,
            )

            logger.info("Supabase client initialized successfully.")

        except Exception:
            logger.exception("Failed to initialize Supabase client.")
            raise

    return _client


def test_connection() -> bool:
    """Test the Supabase connection with a database request."""
    logger.info("Testing Supabase connection...")

    try:
        client = get_supabase_client()

        client.table("connection_test") \
            .select("id") \
            .limit(1) \
            .execute()

        logger.info("Supabase connection successful.")
        return True

    except Exception:
        logger.exception("Supabase connection failed.")
        return False