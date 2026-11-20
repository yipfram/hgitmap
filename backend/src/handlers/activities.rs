use actix_web::{web, HttpResponse, Responder};
use sea_orm::sea_query::{Expr, Func};
use sea_orm::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::{activity, git_platform_account, user, user_setting};

#[derive(Debug, Deserialize)]
pub struct ActivitiesQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
    pub platform: Option<String>,
    pub account_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ActivityResponse {
    pub id: String,
    pub activity_type: String,
    pub date: String,
    pub metadata: serde_json::Value,
    pub repository_name: Option<String>,
    pub repository_url: Option<String>,
    pub is_private: bool,
    pub count: i32,
    pub primary_language: Option<String>,
    pub organization_name: Option<String>,
    pub organization_avatar_url: Option<String>,
    // Platform information for generating correct URLs
    pub platform: String,
    pub platform_username: String,
    pub platform_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ActivitiesResponse {
    pub activities: Vec<ActivityResponse>,
    pub total: i32,
    pub has_more: bool,
}

/// GET /api/activities
/// Get the authenticated user's own activity timeline (always the owner)
pub async fn get_activities(
    db: web::Data<DatabaseConnection>,
    user_claims: web::ReqData<crate::middleware::auth::Claims>,
    query: web::Query<ActivitiesQuery>,
) -> Result<impl Responder, actix_web::Error> {
    let user_id = Uuid::parse_str(&user_claims.sub)
        .map_err(|e| actix_web::error::ErrorBadRequest(format!("Invalid user ID: {}", e)))?;
    fetch_activities(db.as_ref(), user_id, &query, true).await
}

/// Build API responses. For non-owners, activities on private repositories are
/// fully redacted and aggregated per month/account into a single
/// "PrivateContribution" item, so nothing about the repository leaks.
fn build_responses(
    activities: Vec<activity::Model>,
    accounts_map: &std::collections::HashMap<Uuid, &git_platform_account::Model>,
    is_owner: bool,
    hide_private_repo_names: bool,
) -> Vec<ActivityResponse> {
    let mut out: Vec<ActivityResponse> = Vec::new();
    let mut private_index: std::collections::HashMap<(String, Uuid), usize> =
        std::collections::HashMap::new();

    for a in activities {
        let account = match accounts_map.get(&a.git_platform_account_id) {
            Some(acc) => acc,
            None => continue,
        };
        let platform = format!("{:?}", account.platform_type).to_lowercase();

        if a.is_private_repo && !is_owner {
            let month = a.activity_date.format("%Y-%m").to_string();
            let key = (month.clone(), a.git_platform_account_id);
            if let Some(&idx) = private_index.get(&key) {
                out[idx].count += a.count.max(1);
            } else {
                private_index.insert(key, out.len());
                out.push(ActivityResponse {
                    id: format!("private-{}-{}", month, a.git_platform_account_id),
                    activity_type: "PrivateContribution".to_string(),
                    date: a.activity_date.format("%Y-%m-%d").to_string(),
                    metadata: serde_json::json!({}),
                    repository_name: None,
                    repository_url: None,
                    is_private: true,
                    count: a.count.max(1),
                    primary_language: None,
                    organization_name: None,
                    organization_avatar_url: None,
                    platform,
                    platform_username: account.platform_username.clone(),
                    platform_url: account.platform_url.clone(),
                });
            }
            continue;
        }

        let hide = a.is_private_repo && hide_private_repo_names;
        let repository_name = if hide { None } else { a.repository_name };
        let metadata = if hide {
            let mut m = a.metadata.clone();
            if let Some(repos) = m.get_mut("repositories").and_then(|r| r.as_array_mut()) {
                for repo in repos.iter_mut() {
                    if let Some(o) = repo.as_object_mut() {
                        o.insert("name".to_string(), serde_json::json!("Private Repository"));
                    }
                }
            }
            m
        } else {
            a.metadata
        };

        out.push(ActivityResponse {
            id: a.id.to_string(),
            activity_type: format!("{:?}", a.activity_type),
            date: a.activity_date.format("%Y-%m-%d").to_string(),
            metadata,
            repository_name,
            repository_url: a.repository_url,
            is_private: a.is_private_repo,
            count: a.count,
            primary_language: a.primary_language,
            organization_name: a.organization_name,
            organization_avatar_url: a.organization_avatar_url,
            platform,
            platform_username: account.platform_username.clone(),
            platform_url: account.platform_url.clone(),
        });
    }
    out
}

/// Shared implementation. `is_owner` is true only when the authenticated
/// requester is the profile owner.
async fn fetch_activities(
    db: &DatabaseConnection,
    user_id: Uuid,
    query: &ActivitiesQuery,
    is_owner: bool,
) -> Result<HttpResponse, actix_web::Error> {
    // Get user settings for privacy filtering
    let settings = user_setting::Entity::find()
        .filter(user_setting::Column::UserId.eq(user_id))
        .one(db)
        .await
        .map_err(|e| {
            log::error!("Database error: {}", e);
            actix_web::error::ErrorInternalServerError("Database error")
        })?;

    let show_private_contributions = settings
        .as_ref()
        .map(|s| s.show_private_contributions)
        .unwrap_or(true);

    let hide_private_repo_names = settings
        .as_ref()
        .map(|s| s.hide_private_repo_names)
        .unwrap_or(true);

    // Get all active platform accounts for this user
    let mut accounts_query = git_platform_account::Entity::find()
        .filter(git_platform_account::Column::UserId.eq(user_id))
        .filter(git_platform_account::Column::IsActive.eq(true));

    // Filter by account id (preferred) or platform type
    accounts_query = match crate::handlers::contributions::filter_accounts(
        accounts_query,
        query.platform.as_deref(),
        query.account_id.as_deref(),
    ) {
        Ok(q) => q,
        Err(msg) => {
            return Ok(HttpResponse::BadRequest().json(serde_json::json!({ "error": msg })));
        }
    };

    let accounts = accounts_query.all(db).await.map_err(|e| {
        log::error!("Database error: {}", e);
        actix_web::error::ErrorInternalServerError("Database error")
    })?;

    if accounts.is_empty() {
        return Ok(HttpResponse::Ok().json(ActivitiesResponse {
            activities: vec![],
            total: 0,
            has_more: false,
        }));
    }

    let account_ids: Vec<Uuid> = accounts.iter().map(|a| a.id).collect();

    // Create a HashMap for quick platform account lookups
    let accounts_map: std::collections::HashMap<Uuid, &git_platform_account::Model> =
        accounts.iter().map(|a| (a.id, a)).collect();

    // Build query for activities
    let mut activity_query = activity::Entity::find()
        .filter(activity::Column::GitPlatformAccountId.is_in(account_ids))
        .order_by_desc(activity::Column::ActivityDate);

    // Apply privacy filter
    if !show_private_contributions {
        activity_query = activity_query.filter(activity::Column::IsPrivateRepo.eq(false));
    }

    // Apply date range if provided
    if let Some(from_str) = &query.from {
        if let Ok(from_date) = chrono::NaiveDate::parse_from_str(from_str, "%Y-%m-%d") {
            activity_query = activity_query.filter(activity::Column::ActivityDate.gte(from_date));
        }
    }

    if let Some(to_str) = &query.to {
        if let Ok(to_date) = chrono::NaiveDate::parse_from_str(to_str, "%Y-%m-%d") {
            activity_query = activity_query.filter(activity::Column::ActivityDate.lte(to_date));
        }
    }

    // Count total activities before pagination
    let total = activity_query
        .clone()
        .count(db)
        .await
        .map_err(|e| {
            log::error!("Database error: {}", e);
            actix_web::error::ErrorInternalServerError("Database error")
        })?;

    // Apply pagination
    let limit = query.limit.unwrap_or(50).min(100) as u64;
    let offset = query.offset.unwrap_or(0).max(0) as u64;

    activity_query = activity_query.limit(limit).offset(offset);

    let activities = activity_query.all(db).await.map_err(|e| {
        log::error!("Database error: {}", e);
        actix_web::error::ErrorInternalServerError("Database error")
    })?;

    let has_more = (offset + limit) < total;

    let activity_responses =
        build_responses(activities, &accounts_map, is_owner, hide_private_repo_names);

    Ok(HttpResponse::Ok().json(ActivitiesResponse {
        activities: activity_responses,
        total: total as i32,
        has_more,
    }))
}

/// GET /api/users/:username/activities
/// Public endpoint to get user's activity timeline by username
pub async fn get_user_activities(
    db: web::Data<DatabaseConnection>,
    path: web::Path<String>,
    query: web::Query<ActivitiesQuery>,
) -> Result<impl Responder, actix_web::Error> {
    let username = path.into_inner();

    // Find user by username (case-insensitive)
    let user_model = user::Entity::find()
        .filter(
            Expr::expr(Func::lower(Expr::col(user::Column::Username))).eq(username.to_lowercase()),
        )
        .one(db.as_ref())
        .await
        .map_err(|e| {
            log::error!("Database error: {}", e);
            actix_web::error::ErrorInternalServerError("Database error")
        })?;

    let user_model = match user_model {
        Some(u) => u,
        None => {
            return Ok(HttpResponse::NotFound().json(serde_json::json!({
                "error": "User not found"
            })));
        }
    };

    // Public endpoint: the requester is never treated as the owner.
    fetch_activities(db.as_ref(), user_model.id, &query, false).await
}
