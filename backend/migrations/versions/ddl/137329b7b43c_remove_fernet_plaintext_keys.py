"""remove_fernet_plaintext_keys

Revision ID: 137329b7b43c
Revises: 0a3b2c1d4e5f
Create Date: 2026-07-27

This migration:
1. Renames api_secrets.encrypted_key → api_key (plaintext storage)
2. Drops api_secrets.key_suffix (derivable from api_key[-4:])
3. Drops unique constraint uq_api_secret_key
4. Renames voice_configs.api_key_enc → api_key
5. Drops voice_configs.api_key_suffix
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "137329b7b43c"
down_revision: Union[str, None] = "ms39fseglx7c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # api_secrets: drop unique constraint on (encrypted_key, key_suffix)
    op.drop_constraint("uq_api_secret_key", "api_secrets", type_="unique")

    # api_secrets: rename encrypted_key → api_key
    op.alter_column(
        "api_secrets",
        "encrypted_key",
        new_column_name="api_key",
        existing_type=sa.Text(),
        nullable=False,
    )

    # api_secrets: drop key_suffix
    op.drop_column("api_secrets", "key_suffix")

    # voice_configs: rename api_key_enc → api_key
    op.alter_column(
        "voice_configs",
        "api_key_enc",
        new_column_name="api_key",
        existing_type=sa.Text(),
        nullable=False,
        existing_server_default=sa.text("''::text"),
    )

    # voice_configs: drop api_key_suffix
    op.drop_column("voice_configs", "api_key_suffix")


def downgrade() -> None:
    # Reverse: re-add suffix columns, rename back, restore constraint.
    # Note: original encrypted values cannot be recovered — plaintext is kept as-is.
    # This is acceptable for dev/test rollback only.

    # voice_configs: re-add api_key_suffix
    op.add_column(
        "voice_configs",
        sa.Column("api_key_suffix", sa.String(8), server_default="", nullable=False),
    )

    # voice_configs: rename api_key → api_key_enc
    op.alter_column(
        "voice_configs",
        "api_key",
        new_column_name="api_key_enc",
        existing_type=sa.Text(),
        nullable=False,
    )

    # api_secrets: re-add key_suffix
    op.add_column(
        "api_secrets",
        sa.Column("key_suffix", sa.String(8), server_default="", nullable=False),
    )

    # api_secrets: rename api_key → encrypted_key
    op.alter_column(
        "api_secrets",
        "api_key",
        new_column_name="encrypted_key",
        existing_type=sa.Text(),
        nullable=False,
    )

    # api_secrets: restore unique constraint
    op.create_unique_constraint(
        "uq_api_secret_key", "api_secrets", ["encrypted_key", "key_suffix"]
    )
