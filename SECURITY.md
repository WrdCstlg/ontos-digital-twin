# Security Policy

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub's private vulnerability reporting:
open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a
public issue.

Include what you found, how to reproduce it, and the impact you believe it has. You should
receive an acknowledgement within five business days. We will keep you informed while a fix
is prepared and credit you in the release notes unless you prefer otherwise.

## Supported versions

Ontos is maintained on a single line of development. Security fixes land on `master`; there
are no separately maintained release branches.

## Development-mode defaults — intentional, and disabled in production

Several conveniences make local development frictionless. They are gated on
`NODE_ENV !== "production"`, and each has been checked to be inert in the production build
and the Docker stack. They are documented here so nobody mistakes them for a leak.

| Behaviour | Where | In production |
|---|---|---|
| A fixed fallback JWT signing secret is used when `APP_SECRET` is unset | `app/api/lib/env.ts` | Startup fails unless `APP_SECRET` is set |
| An account with no stored password hash accepts the password `ontos2026!` or `password123` on first login, then stores a real hash | `app/api/auth/service.ts` | Such accounts are rejected outright |
| One-click persona login (Admin, Ontologist, Editor, Viewer) with no password | `app/api/auth-router.ts` | Refused unless `ALLOW_DEMO_LOGIN=true` |
| Persona accounts are created with a hash of the password `ontos2026!` | `app/api/auth/service.ts` | Only reachable when persona login is enabled |
| Localhost origins pass CORS and CSRF checks | `app/api/boot.ts` | Only origins listed in `ALLOWED_ORIGINS` pass |

**`ALLOW_DEMO_LOGIN=true` is a deliberate hole.** It lets anyone who can reach the server
sign in as any role, admin included, without a password. The server logs a warning at
startup whenever it is on. Use it for local demos only, never on a reachable network.

## Hardening already in place

- Session JWTs: HS256, issuer-pinned, unique JTI, 7-day expiry, `HttpOnly` and
  `SameSite=Strict` cookies, `__Host-` prefixed and `Secure` on real hostnames.
- Passwords: `node:crypto` scrypt, 128-bit salts, constant-time comparison.
- Every tRPC procedure is behind a role-checked procedure builder; the only unauthenticated
  routes are login, persona login (gated as above), `ping` and `/health`.
- `/api/sparql` requires a session, is rate-limited, and accepts only read-only query forms.
- User records pass through a field allowlist before serialization; password hashes never
  reach a client.
- Security headers, explicit-origin CORS, CSRF origin checks, a 2 MB body limit, and
  sliding-window rate limits on authentication, NLQ, SPARQL and graph scans.
- Containers run as non-root users; the engine's filesystem is read-only; `.env` files are
  excluded from the Docker build context; every upstream image is pinned by digest.

## Known limitations with security relevance

These are documented rather than hidden. Reports that restate them are welcome if you can
show an impact beyond what is described here.

- **Rate limits are per process and in memory.** They reset on restart and are not shared
  between replicas, so they slow down a single attacker against a single instance but are
  not a distributed defence.
- **The semantic engine is shared across workspaces.** Every operation clears and reloads
  one in-memory triple store, so there is no tenant isolation inside the engine, and
  concurrent operations can interfere with one another.
- **The engine's HTTP API is unauthenticated by default.** In the compose stack it is not
  published to the host, but any container on the compose network can reach it. Set
  `OPEN_ONTOLOGIES_TOKEN` on both sides to require a bearer token.
- **SHACL validation fails open.** When the engine is unreachable, validation reports
  conformance with an explanatory message instead of failing.
- **`/health` is unauthenticated** and reports the engine's internal URL and version.
