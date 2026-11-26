"""Small append-only version store for SQLite or Neon PostgreSQL."""
import os
from pathlib import Path

from sqlalchemy import JSON, Column, Integer, MetaData, String, Table, create_engine, insert, select
from sqlalchemy.pool import NullPool

from .forecasting import ROOT

metadata = MetaData()
documents = Table(
    "documents", metadata,
    Column("kind", String(20), primary_key=True),
    Column("id", String(64), primary_key=True),
    Column("version", Integer, primary_key=True),
    Column("body", JSON, nullable=False),
)


class Store:
    def __init__(self, url: str | None = None):
        url = url or os.getenv("DATABASE_URL")
        if not url:
            target = Path(os.getenv("BOXBAY_STATE_DIR", str(ROOT / ".boxbay")))
            target.mkdir(parents=True, exist_ok=True)
            url = f"sqlite:///{target / 'state.sqlite3'}"
        for prefix in ("postgresql://", "postgres://"):
            if url.startswith(prefix):
                url = "postgresql+psycopg://" + url.removeprefix(prefix)
        self.engine = create_engine(url, poolclass=NullPool, hide_parameters=True)

    def migrate(self):
        with self.engine.begin() as conn:
            conn.exec_driver_sql((ROOT / "infra/001_documents.sql").read_text())

    def put(self, kind: str, id_: str, version: int, body: dict):
        with self.engine.begin() as conn:
            conn.execute(insert(documents).values(kind=kind, id=id_, version=version, body=body))

    def get(self, kind: str, id_: str, version: int | None = None) -> dict | None:
        query = select(documents.c.body).where(documents.c.kind == kind, documents.c.id == id_)
        if version is not None:
            query = query.where(documents.c.version == version)
        with self.engine.connect() as conn:
            return conn.execute(query.order_by(documents.c.version.desc()).limit(1)).scalar_one_or_none()

    def list(self, kind: str, offset: int, limit: int) -> list[dict]:
        with self.engine.connect() as conn:
            return [r[0] for r in conn.execute(
                select(documents.c.body).where(documents.c.kind == kind)
                .order_by(documents.c.id, documents.c.version.desc()).offset(offset).limit(limit),
            )]


if __name__ == "__main__":
    Store().migrate()
