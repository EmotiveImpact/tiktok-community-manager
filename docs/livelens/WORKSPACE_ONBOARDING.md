# Invited workspace accounts

The optional persisted browser mode adds real administrator-issued join links
to **Workspace & access → Members**. An owner or administrator chooses the
operator name, role, expiry and an audit reason, then privately shares the link.
The recipient sets a password of at least 12 characters and joins the issuing
workspace. No email is sent and no public signup or payment flow is provided.
If an operator name exists in multiple workspaces, fill the optional Workspace
field when signing in. The service refuses an ambiguous name instead of choosing
a workspace; invitation redemption already binds the recipient to its issuer.

Set `LIVELENS_BROWSER_AUTH=persisted` with the existing browser origin, bundle,
bootstrap user and workspace membership configuration. Governance is required.
The initial owner's member subject must match their configured username.
`browser: {authMode: "persisted", ...}` selects the same mode when embedding the
server. The console demonstration opts into this mode using fictional accounts.
Static configured-user authentication remains the default for other installations.

Bootstrap configuration inserts an absent account; it never overwrites a changed
password, reset state or revoked account after restart. Passwords are salted and
hashed with scrypt. Credentials and invitation digests persist in the same pilot
database as workspace membership. Cookie sessions remain bounded and in memory;
restart requires signing in again. Each request rechecks credential version,
current membership and role scope limits, including `/console/session`.

Links carry a 256-bit token in the URL fragment. The browser submits that token
only to same-origin inspection/redemption endpoints. The service persists its
SHA-256 digest and metadata, not the raw token. A link expires, can be revoked,
and can be redeemed only once. Redemption atomically writes the credentials,
membership, token consumption and audit record. The issued role, workspace and
scopes are fixed by the administrator and rechecked against their current grants.
The interface removes the fragment and mounts fresh resources after redemption.

Administrators can issue a password reset link or revoke an account. Reset
invalidates the old password and all existing cookies immediately; only the new
link can set a replacement password. Revocation also removes workspace access.
Reset cannot restore a revoked membership. The service protects the last owner
against membership revocation. Administrative reasons enter the workspace audit
trail; password and token values do not. Share links privately and keep runtime
databases and configured bootstrap credentials outside Git.

The administrator API requires both `workspace:admin` and an active administrative
membership. Metadata list routes never return raw tokens.

| Route | Behavior |
|---|---|
| `GET /v1/workspace/accounts` | List workspace account metadata |
| `GET /v1/workspace/invitations` | List invitation/reset metadata |
| `POST /v1/workspace/invitations` | Issue `{username, role, scopes?, expiresInHours?, reason}`; return one-time link |
| `POST /v1/workspace/invitations/:id/revoke` | Revoke an unused link with `{reason}` |
| `POST /v1/workspace/accounts/:username/reset` | Invalidate credentials and issue reset link with `{reason, expiresInHours?}` |
| `POST /v1/workspace/accounts/:username/revoke` | Revoke account and membership with `{reason}` |
| `POST /console/invitations/inspect` | Public same-origin inspection with `{token}` |
| `POST /console/invitations/redeem` | Public same-origin redemption with `{token, password}` and cookie issuance |

Invite lifetimes are 1–168 hours; resets are 1–24 hours. Authentication and public
token endpoints are rate limited and password hashing concurrency is bounded.
This is invited pilot onboarding, not a production capacity claim. Payment
integration, public signup, external delivery, distributed session infrastructure
and production deployment remain separate work.

After building, run `python3 scripts/validation/onboarding_smoke.py` with
Playwright 1.62 and Chromium. Its isolated real HTTP fixture exercises joining,
scopes, live role/revocation checks, expiry/reuse, reset and database restart.
See [VALIDATION.md](VALIDATION.md) for executed results; a documented command is
not itself a validation receipt.
