# Neon PostgreSQL

Provision a project and database in a region close to Railway. Copy the direct PostgreSQL connection string into Railway as `DATABASE_URL` with `sslmode=require` or a verified stronger TLS setting. No browser configuration carries the URL. The application translates the scheme for psycopg 3 and applies migration 001 on startup. SQLAlchemy uses NullPool so idle connections do not prevent sleeping.

For production separation, apply `infra/001_documents.sql` with an administrator and provision a least-privilege application role. For backups use Neon restore capabilities according to the configured retention policy and periodically export with `pg_dump` to approved storage. Verify restoration against a separate database before relying on it.
