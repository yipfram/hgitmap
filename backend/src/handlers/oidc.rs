//! OpenID Connect login (authorization code flow + PKCE), e.g. with Pocket ID.
//!
//! We never trust an unverified ID token: the code is exchanged server-to-server with the
//! provider's token endpoint over TLS, then the user is identified through the userinfo
//! endpoint using the resulting access token.

use actix_web::{web, HttpRequest, HttpResponse, Responder};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{Duration, Utc};
use rand::{distributions::Alphanumeric, Rng};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, PaginatorTrait,
    QueryFilter, Set, Statement,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::models::{user, user_setting};
use crate::utils::auth::create_jwt;
use crate::utils::config::{Config, OidcConfig};

#[derive(Serialize)]
struct PublicAuthConfig {
    password_login: bool,
    oidc_enabled: bool,
    oidc_name: Option<String>,
}

/// Public: tells the frontend which login methods to show.
pub async fn auth_config(config: web::Data<Config>) -> impl Responder {
    HttpResponse::Ok().json(PublicAuthConfig {
        password_login: config.password_login_enabled,
        oidc_enabled: config.oidc.is_some(),
        oidc_name: config.oidc.as_ref().map(|o| o.display_name.clone()),
    })
}

#[derive(Deserialize)]
struct Discovery {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    userinfo_endpoint: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct UserInfo {
    sub: String,
    preferred_username: Option<String>,
    email: Option<String>,
}

fn http_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
}

async fn discover(oidc: &OidcConfig) -> Result<Discovery, String> {
    let url = format!("{}/.well-known/openid-configuration", oidc.issuer_url);
    let client = http_client().map_err(|e| e.to_string())?;
    let doc: Discovery = client
        .get(&url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("OIDC discovery failed: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Invalid OIDC discovery document: {}", e))?;
    if doc.issuer.trim_end_matches('/') != oidc.issuer_url {
        return Err("OIDC issuer mismatch in discovery document".to_string());
    }
    Ok(doc)
}

fn random_string(len: usize) -> String {
    rand::thread_rng().sample_iter(&Alphanumeric).take(len).map(char::from).collect()
}

fn callback_url(config: &Config) -> String {
    format!("{}/auth/oidc/callback", config.base_url.trim_end_matches('/'))
}

fn redirect(location: String) -> HttpResponse {
    HttpResponse::Found().append_header(("Location", location)).finish()
}

fn login_error(config: &Config, message: &str) -> HttpResponse {
    log::warn!("OIDC login failed: {}", message);
    redirect(format!(
        "{}/login?error={}",
        config.frontend_url.trim_end_matches('/'),
        urlencoding::encode(message)
    ))
}

pub async fn oidc_login(
    req: HttpRequest,
    db: web::Data<DatabaseConnection>,
    config: web::Data<Config>,
) -> impl Responder {
    if let Err(e) = crate::utils::rate_limit::check(&req, "oidc_login", 20, 300) {
        return e.error_response();
    }
    let Some(oidc) = config.oidc.as_ref() else {
        return HttpResponse::NotFound().finish();
    };
    let disco = match discover(oidc).await {
        Ok(d) => d,
        Err(e) => return login_error(&config, &e),
    };

    let state = random_string(48);
    let verifier = random_string(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));

    let stored = db
        .execute(Statement::from_sql_and_values(
            db.get_database_backend(),
            "DELETE FROM oidc_states WHERE expires_at < now()",
            [],
        ))
        .await
        .and(
            db.execute(Statement::from_sql_and_values(
                db.get_database_backend(),
                "INSERT INTO oidc_states (state, pkce_verifier, expires_at) VALUES ($1, $2, $3)",
                [
                    state.clone().into(),
                    verifier.into(),
                    (Utc::now() + Duration::minutes(10)).into(),
                ],
            ))
            .await,
        );
    if let Err(e) = stored {
        log::error!("Failed to store OIDC state: {}", e);
        return login_error(&config, "Internal error");
    }

    let sep = if disco.authorization_endpoint.contains('?') { '&' } else { '?' };
    redirect(format!(
        "{}{}response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
        disco.authorization_endpoint,
        sep,
        urlencoding::encode(&oidc.client_id),
        urlencoding::encode(&callback_url(&config)),
        urlencoding::encode(&oidc.scopes),
        state,
        challenge,
    ))
}

#[derive(Deserialize)]
pub struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

pub async fn oidc_callback(
    req: HttpRequest,
    db: web::Data<DatabaseConnection>,
    config: web::Data<Config>,
    query: web::Query<CallbackQuery>,
) -> impl Responder {
    if let Err(e) = crate::utils::rate_limit::check(&req, "oidc_callback", 30, 300) {
        return e.error_response();
    }
    let Some(oidc) = config.oidc.as_ref() else {
        return HttpResponse::NotFound().finish();
    };
    if let Some(err) = &query.error {
        return login_error(&config, &format!("Provider returned an error: {}", err));
    }
    let (Some(code), Some(state)) = (query.code.as_ref(), query.state.as_ref()) else {
        return login_error(&config, "Missing code or state");
    };

    // Consume the state (single use) and retrieve the PKCE verifier.
    let row = db
        .query_one(Statement::from_sql_and_values(
            db.get_database_backend(),
            "DELETE FROM oidc_states WHERE state = $1 AND expires_at > now() RETURNING pkce_verifier",
            [state.clone().into()],
        ))
        .await;
    let verifier: String = match row {
        Ok(Some(r)) => match r.try_get("", "pkce_verifier") {
            Ok(v) => v,
            Err(_) => return login_error(&config, "Internal error"),
        },
        Ok(None) => return login_error(&config, "Invalid or expired login attempt, please retry"),
        Err(e) => {
            log::error!("OIDC state lookup failed: {}", e);
            return login_error(&config, "Internal error");
        }
    };

    let disco = match discover(oidc).await {
        Ok(d) => d,
        Err(e) => return login_error(&config, &e),
    };
    let client = match http_client() {
        Ok(c) => c,
        Err(_) => return login_error(&config, "Internal error"),
    };

    let mut form = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code.clone()),
        ("redirect_uri", callback_url(&config)),
        ("client_id", oidc.client_id.clone()),
        ("code_verifier", verifier),
    ];
    if let Some(secret) = &oidc.client_secret {
        form.push(("client_secret", secret.clone()));
    }
    let token: TokenResponse = match client.post(&disco.token_endpoint).form(&form).send().await {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(t) => t,
            Err(_) => return login_error(&config, "Invalid token response from provider"),
        },
        Ok(r) => {
            log::warn!("OIDC token exchange rejected: HTTP {}", r.status());
            return login_error(&config, "Token exchange rejected by provider");
        }
        Err(e) => {
            log::warn!("OIDC token exchange failed: {}", e);
            return login_error(&config, "Could not reach provider");
        }
    };

    let info: UserInfo = match client
        .get(&disco.userinfo_endpoint)
        .bearer_auth(&token.access_token)
        .send()
        .await
        .and_then(|r| r.error_for_status())
    {
        Ok(r) => match r.json().await {
            Ok(i) => i,
            Err(_) => return login_error(&config, "Invalid userinfo response"),
        },
        Err(e) => {
            log::warn!("OIDC userinfo failed: {}", e);
            return login_error(&config, "Could not fetch user info");
        }
    };

    let user = match find_or_create_user(db.get_ref(), &config, &oidc.issuer_url, &info).await {
        Ok(u) => u,
        Err(msg) => return login_error(&config, &msg),
    };

    let jwt = match create_jwt(user.id, &config.jwt_secret, config.jwt_expiration_hours) {
        Ok(t) => t,
        Err(_) => return login_error(&config, "Failed to generate token"),
    };

    // Fragment (not query) so the token never reaches server logs or Referer headers.
    redirect(format!(
        "{}/oidc/callback#token={}&user_id={}&username={}&is_admin={}",
        config.frontend_url.trim_end_matches('/'),
        jwt,
        user.id,
        urlencoding::encode(&user.username),
        user.is_admin
    ))
}

fn sanitize_username(info: &UserInfo) -> String {
    let raw = info
        .preferred_username
        .clone()
        .or_else(|| info.email.as_ref().and_then(|e| e.split('@').next().map(String::from)))
        .unwrap_or_default();
    let cleaned: String = raw
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .take(30)
        .collect();
    if cleaned.is_empty() { "user".to_string() } else { cleaned }
}

async fn find_or_create_user(
    db: &DatabaseConnection,
    config: &Config,
    issuer: &str,
    info: &UserInfo,
) -> Result<user::Model, String> {
    let backend = db.get_database_backend();
    let internal = |e: sea_orm::DbErr| {
        log::error!("OIDC database error: {}", e);
        "Internal error".to_string()
    };

    // 1. Already linked identity.
    let linked = db
        .query_one(Statement::from_sql_and_values(
            backend,
            "SELECT user_id FROM user_identities WHERE issuer = $1 AND subject = $2",
            [issuer.into(), info.sub.clone().into()],
        ))
        .await
        .map_err(internal)?;
    if let Some(row) = linked {
        let user_id: Uuid = row.try_get("", "user_id").map_err(internal)?;
        return user::Entity::find_by_id(user_id)
            .one(db)
            .await
            .map_err(internal)?
            .ok_or_else(|| "Linked user no longer exists".to_string());
    }

    let link = |user_id: Uuid| {
        Statement::from_sql_and_values(
            backend,
            "INSERT INTO user_identities (user_id, issuer, subject) VALUES ($1, $2, $3)",
            [user_id.into(), issuer.into(), info.sub.clone().into()],
        )
    };

    // 2. Existing account with the same username: link it directly (provider is trusted),
    //    unless that account is already bound to a different identity from this issuer.
    let base = sanitize_username(info);
    if let Some(existing) = user::Entity::find()
        .filter(user::Column::Username.eq(&base))
        .one(db)
        .await
        .map_err(internal)?
    {
        let taken = db
            .query_one(Statement::from_sql_and_values(
                backend,
                "SELECT 1 AS x FROM user_identities WHERE user_id = $1 AND issuer = $2",
                [existing.id.into(), issuer.into()],
            ))
            .await
            .map_err(internal)?;
        if taken.is_none() {
            db.execute(link(existing.id)).await.map_err(internal)?;
            log::info!("Linked OIDC identity to existing user '{}'", existing.username);
            return Ok(existing);
        }
    }

    // 3. New account.
    if !config.allow_registration {
        return Err("Registration is disabled".to_string());
    }
    let mut username = base.clone();
    let mut n = 1;
    while user::Entity::find()
        .filter(user::Column::Username.eq(&username))
        .one(db)
        .await
        .map_err(internal)?
        .is_some()
    {
        n += 1;
        username = format!("{}-{}", base, n);
    }
    let is_first = user::Entity::find().count(db).await.map_err(internal)? == 0;

    let created = user::ActiveModel {
        id: Set(Uuid::new_v4()),
        username: Set(username),
        password_hash: Set(None),
        email: Set(info.email.clone()),
        is_admin: Set(is_first),
        created_at: Set(Utc::now()),
        updated_at: Set(Utc::now()),
    }
    .insert(db)
    .await
    .map_err(internal)?;

    db.execute(link(created.id)).await.map_err(internal)?;

    if let Err(e) = (user_setting::ActiveModel {
        id: Set(Uuid::new_v4()),
        user_id: Set(created.id),
        show_private_contributions: Set(true),
        hide_private_repo_names: Set(false),
        heatmap_color_scheme: Set("green".to_string()),
        heatmap_size: Set("medium".to_string()),
        dark_mode_enabled: Set(false),
        created_at: Set(Utc::now()),
        updated_at: Set(Utc::now()),
    })
    .insert(db)
    .await
    {
        log::error!("Failed to create default settings for OIDC user: {}", e);
    }
    Ok(created)
}
