use sea_orm::{Database, DatabaseConnection, DbErr};

pub async fn establish_connection(database_url: &str) -> Result<DatabaseConnection, DbErr> {
    Database::connect(database_url).await
}

/// Idempotent schema upgrade for OIDC support, so existing deployments need no manual migration.
pub async fn ensure_oidc_schema(db: &DatabaseConnection) -> Result<(), DbErr> {
    use sea_orm::ConnectionTrait;
    for sql in [
        "ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL",
        "CREATE TABLE IF NOT EXISTS user_identities (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            issuer VARCHAR(500) NOT NULL,
            subject VARCHAR(255) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (issuer, subject)
        )",
        "CREATE TABLE IF NOT EXISTS oidc_states (
            state VARCHAR(128) PRIMARY KEY,
            pkce_verifier VARCHAR(128) NOT NULL,
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL
        )",
    ] {
        db.execute_unprepared(sql).await?;
    }
    Ok(())
}
