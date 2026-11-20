use anyhow::{anyhow, Result};
use url::Url;

/// Validate that a string is a valid URL with http or https scheme
#[allow(dead_code)]
pub fn validate_url(url_str: &str) -> Result<Url> {
    let url = Url::parse(url_str)
        .map_err(|e| anyhow!("Invalid URL format: {}", e))?;

    // Only allow http and https schemes
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(anyhow!(
            "URL must use http or https scheme, got: {}",
            url.scheme()
        ));
    }

    // Must have a host
    if url.host_str().is_none() {
        return Err(anyhow!("URL must have a host"));
    }

    Ok(url)
}

/// Validate that a URL is a valid instance URL for self-hosted platforms
/// Returns the normalized base URL (no trailing slash, no path)
#[allow(dead_code)]
pub fn validate_instance_url(url_str: &str) -> Result<String> {
    let url = validate_url(url_str)?;

    // Normalize: remove trailing slash and path
    let normalized = format!(
        "{}://{}{}",
        url.scheme(),
        url.host_str().unwrap(),
        url.port()
            .map(|p| format!(":{}", p))
            .unwrap_or_default()
    );

    Ok(normalized)
}

/// Validate username (alphanumeric, hyphens, underscores, 1-39 chars for GitHub compatibility)
#[allow(dead_code)]
pub fn validate_username(username: &str) -> Result<()> {
    if username.is_empty() || username.len() > 39 {
        return Err(anyhow!(
            "Username must be between 1 and 39 characters"
        ));
    }

    // Allow alphanumeric, hyphens, and underscores
    if !username
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(anyhow!(
            "Username can only contain alphanumeric characters, hyphens, and underscores"
        ));
    }

    Ok(())
}

/// Validate that a platform type is supported
pub fn validate_platform(platform: &str) -> Result<()> {
    match platform {
        "github" | "gitlab" | "gitea" => Ok(()),
        _ => Err(anyhow!(
            "Unsupported platform '{}'. Supported: github, gitlab, gitea",
            platform
        )),
    }
}

fn is_blocked_ip(ip: std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v4) => {
            v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                || v4.octets()[0] == 0
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 64) // CGNAT
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_blocked_ip(IpAddr::V4(v4));
            }
            let seg0 = v6.segments()[0];
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (seg0 & 0xfe00) == 0xfc00 // unique local
                || (seg0 & 0xffc0) == 0xfe80 // link local
        }
    }
}

/// SSRF protection: reject instance URLs that point at loopback/private/link-local
/// addresses (checked on every address the host resolves to).
/// Set ALLOW_PRIVATE_INSTANCE_URLS=true to allow self-hosted instances on a LAN.
pub async fn ensure_public_instance_url(url_str: &str) -> Result<()> {
    if std::env::var("ALLOW_PRIVATE_INSTANCE_URLS")
        .map(|v| v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        return Ok(());
    }
    let url = validate_url(url_str)?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(anyhow!("URL must not contain credentials"));
    }
    let host = url.host_str().ok_or_else(|| anyhow!("URL must have a host"))?;
    let port = url.port_or_known_default().unwrap_or(443);
    let addrs: Vec<_> = tokio::net::lookup_host((host.trim_matches(|c| c == '[' || c == ']'), port))
        .await
        .map_err(|_| anyhow!("Could not resolve instance host"))?
        .collect();
    if addrs.is_empty() || addrs.iter().any(|a| is_blocked_ip(a.ip())) {
        return Err(anyhow!("Instance URL must resolve to a public address"));
    }
    Ok(())
}

/// Heatmap file names: `<slug>.<svg|png|jpg|jpeg|webp>`, no path separators.
pub fn is_safe_heatmap_filename(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else { return false };
    !stem.is_empty()
        && stem.len() <= 100
        && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && matches!(ext, "svg" | "png" | "jpg" | "jpeg" | "webp")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_url() {
        assert!(validate_url("https://github.com").is_ok());
        assert!(validate_url("http://localhost:3000").is_ok());
        assert!(validate_url("ftp://example.com").is_err());
        assert!(validate_url("not-a-url").is_err());
    }

    #[test]
    fn test_validate_instance_url() {
        assert_eq!(
            validate_instance_url("https://gitlab.com/foo/bar").unwrap(),
            "https://gitlab.com"
        );
        assert_eq!(
            validate_instance_url("https://gitlab.com/").unwrap(),
            "https://gitlab.com"
        );
        assert_eq!(
            validate_instance_url("http://localhost:3000").unwrap(),
            "http://localhost:3000"
        );
    }

    #[test]
    fn test_validate_username() {
        assert!(validate_username("octocat").is_ok());
        assert!(validate_username("my-user_123").is_ok());
        assert!(validate_username("").is_err());
        assert!(validate_username(&"a".repeat(40)).is_err());
        assert!(validate_username("user@example").is_err());
    }

    #[test]
    fn test_validate_platform() {
        assert!(validate_platform("github").is_ok());
        assert!(validate_platform("gitlab").is_ok());
        assert!(validate_platform("gitea").is_ok());
        assert!(validate_platform("bitbucket").is_err());
    }
}
