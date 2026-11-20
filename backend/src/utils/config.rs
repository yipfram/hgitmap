use serde::Deserialize;
use std::env;

#[derive(Clone, Debug, Deserialize)]
pub struct Config {
    pub database_url: String,
    pub host: String,
    pub port: u16,
    pub jwt_secret: String,
    pub jwt_expiration_hours: i64,
    pub allow_registration: bool,
    pub base_url: String,
    pub frontend_url: String,
    pub encryption_key: String,
    pub password_login_enabled: bool,
    pub oidc: Option<OidcConfig>,
}

/// OpenID Connect provider settings (e.g. Pocket ID). Enabled when OIDC_ISSUER_URL is set.
#[derive(Clone, Debug, Deserialize)]
pub struct OidcConfig {
    pub issuer_url: String,
    pub client_id: String,
    pub client_secret: Option<String>,
    pub display_name: String,
    pub scopes: String,
}

fn non_empty(name: &str) -> Option<String> {
    env::var(name).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

impl OidcConfig {
    fn from_env() -> Option<Self> {
        let issuer_url = non_empty("OIDC_ISSUER_URL")?;
        let client_id = non_empty("OIDC_CLIENT_ID").expect("OIDC_CLIENT_ID is required when OIDC_ISSUER_URL is set");
        Some(OidcConfig {
            issuer_url: issuer_url.trim_end_matches('/').to_string(),
            client_id,
            client_secret: non_empty("OIDC_CLIENT_SECRET"),
            display_name: non_empty("OIDC_DISPLAY_NAME").unwrap_or_else(|| "SSO".to_string()),
            scopes: non_empty("OIDC_SCOPES").unwrap_or_else(|| "openid profile email".to_string()),
        })
    }
}

impl Config {
    pub fn from_env() -> Result<Self, env::VarError> {
        dotenv::dotenv().ok();

        let config = Config {
            database_url: env::var("DATABASE_URL")?,
            host: env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            port: env::var("PORT")
                .unwrap_or_else(|_| "8080".to_string())
                .parse()
                .expect("PORT must be a number"),
            jwt_secret: env::var("JWT_SECRET")?,
            jwt_expiration_hours: env::var("JWT_EXPIRATION_HOURS")
                .unwrap_or_else(|_| "24".to_string())
                .parse()
                .expect("JWT_EXPIRATION_HOURS must be a number"),
            allow_registration: env::var("ALLOW_REGISTRATION")
                .unwrap_or_else(|_| "true".to_string())
                .parse()
                .expect("ALLOW_REGISTRATION must be true or false"),
            base_url: env::var("BASE_URL")?,
            frontend_url: env::var("FRONTEND_URL")
                .unwrap_or_else(|_| "http://localhost:5173".to_string()),
            encryption_key: env::var("ENCRYPTION_KEY")?,
            password_login_enabled: env::var("PASSWORD_LOGIN_ENABLED")
                .unwrap_or_else(|_| "true".to_string())
                .parse()
                .expect("PASSWORD_LOGIN_ENABLED must be true or false"),
            oidc: OidcConfig::from_env(),
        };

        if !config.password_login_enabled && config.oidc.is_none() {
            panic!("PASSWORD_LOGIN_ENABLED=false requires OIDC_ISSUER_URL, otherwise nobody can log in");
        }

        Ok(config)
    }
}
