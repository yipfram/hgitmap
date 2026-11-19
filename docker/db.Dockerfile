FROM postgres:16-alpine
COPY backend/db_schema/schema.sql /docker-entrypoint-initdb.d/01-schema.sql
