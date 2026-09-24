# Refresh rotation operations

Production startup fails unless `AUTH_REFRESH_REUSE_INTERVAL_VERIFIED=true`,
`AUTH_REFRESH_REUSE_INTERVAL_SECONDS>=180`, and a 32+ character
`AUTH_REFRESH_RECEIPT_SECRET` are configured. The operator must verify that the
identity provider accepts reuse of the previous refresh token for exactly this
window. For self-hosted GoTrue, set
`GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL` to the same value.

The broker commits a user/tenant/app-session/hash-bound reservation before it
calls GoTrue and stores the encrypted result afterward. A crash in the external
call's ambiguous interval is reconciled by retrying the same request and old
refresh token inside the verified provider reuse window. Desktop intents expire
30 seconds before that window, leaving operational margin. Logout and session
revocation delete receipts.
