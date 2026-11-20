# Single sign-on with OpenID Connect (Pocket ID)

hgitmap can authenticate users through any OIDC provider (Pocket ID, Authentik, Keycloak, ...).

## 1. Create the client in Pocket ID

- **Callback URL**: `<BASE_URL>/auth/oidc/callback` (e.g. `https://api.example.com/auth/oidc/callback`)
- Scopes used: `openid profile email`
- PKCE is always used. A client secret is optional (leave it out for a public client).

## 2. Configure hgitmap

```env
OIDC_ISSUER_URL=https://id.example.com
OIDC_CLIENT_ID=<client id>
OIDC_CLIENT_SECRET=<client secret, optional>
OIDC_DISPLAY_NAME=Pocket ID
PASSWORD_LOGIN_ENABLED=false   # disables username/password login and registration
```

`PASSWORD_LOGIN_ENABLED=false` requires `OIDC_ISSUER_URL`, otherwise the backend refuses to start.
The database is upgraded automatically at startup (`users.password_hash` becomes nullable, tables
`user_identities` and `oidc_states` are created).

## Account matching

1. An identity already linked (`issuer` + `sub`) logs into its account.
2. Otherwise, an existing hgitmap account with the same username as the provider's
   `preferred_username` is linked automatically (the provider is trusted: make sure users cannot
   choose arbitrary usernames there).
3. Otherwise a new account is created (if `ALLOW_REGISTRATION=true`). The first account is admin.
