"""The SQLAlchemy declarative Base, on its own.

Importing this module has NO side effects: it does not read configuration, open a database
connection, create tables or seed data. That is what lets Alembic (and the schema checks) load every
model's metadata safely. `backend.app.database` re-exports `Base` from here for existing imports.
"""
from sqlalchemy.orm import declarative_base

Base = declarative_base()
