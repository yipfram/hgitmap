//! Minimal in-memory fixed-window rate limiter keyed by (bucket, client IP).
//!
//! Client IP: the LAST entry of X-Forwarded-For (appended by our own reverse proxy,
//! so it cannot be spoofed by the client), falling back to the peer address.
//! Only meaningful when the backend is reachable exclusively through the proxy.

use actix_web::HttpRequest;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

static STORE: OnceLock<Mutex<HashMap<(String, String), (u32, Instant)>>> = OnceLock::new();

fn client_ip(req: &HttpRequest) -> String {
    req.headers()
        .get("x-forwarded-for")
        .and_then(|h| h.to_str().ok())
        .and_then(|v| v.rsplit(',').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| req.peer_addr().map(|a| a.ip().to_string()))
        .unwrap_or_else(|| "unknown".to_string())
}

/// Allow at most `max` hits per `window_secs` for this bucket+IP, else 429.
pub fn check(
    req: &HttpRequest,
    bucket: &str,
    max: u32,
    window_secs: u64,
) -> Result<(), actix_web::Error> {
    let window = Duration::from_secs(window_secs);
    let now = Instant::now();
    let mut map = STORE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    if map.len() > 10_000 {
        map.retain(|_, (_, start)| now.duration_since(*start) < window);
    }

    let entry = map
        .entry((bucket.to_string(), client_ip(req)))
        .or_insert((0, now));
    if now.duration_since(entry.1) >= window {
        *entry = (0, now);
    }
    entry.0 += 1;
    if entry.0 > max {
        return Err(actix_web::error::ErrorTooManyRequests("Too many requests"));
    }
    Ok(())
}
