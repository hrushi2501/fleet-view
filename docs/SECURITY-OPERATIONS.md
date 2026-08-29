# Security operations runbook

This document covers controls that need deployment or operator action. They are
not guaranteed merely because the application code has been merged.

## Before a production deployment

Set `AUTH_SECRET` to a unique random value (`openssl rand -base64 48`). Never
derive it from `DATABASE_URL`, put it in a `NEXT_PUBLIC_*` variable, or paste it
into a ticket. The production session cookie is `__Host-fv_session`; it is
Secure, host-only, and path-scoped to `/`. A deploy that adopts this name signs
out users holding the older `fv_session` cookie, by design.

Keep `.env.local`, dumps, and CI secret exports out of source control. The
repository ignores these paths, but this does not protect a copied shell log,
screen recording, or uploaded archive. Rotate any value exposed that way.

## Tata Fleet Edge webhook

Fleet Edge's Basic Push webhook has no signature or Authorization-header
mechanism. Configure a random `TATA_PUSH_URL_TOKEN` and register this exact
callback with Tata:

```text
https://YOUR_HOST/api/telematics/tata?token=YOUR_RANDOM_TOKEN
```

The app requires that token for non-empty telemetry pushes when configured. Do
not use `TATA_PUSH_TRUST_ANY` in production: the route rejects it there. Redact
the `token` query parameter from Vercel, CDN/WAF, reverse-proxy, and application
request logs; rotate it and update Tata's subscription when a URL is exposed.

If a URL token cannot be registered, the fallback is Tata's documented egress
IP allowlist. It is only trustworthy on Vercel or behind a reverse proxy that
removes client-provided `X-Forwarded-For` and then writes the real client IP.
For that self-hosted topology, set `TATA_PUSH_TRUSTED_PROXY=true` only after
testing the proxy configuration; preferably enforce the allowlist in the WAF or
security group as well.

## Database boundary and audit trail

The application audit log is append-only by application convention and records
security denials. It is not cryptographically immutable against a database
owner or a hosting administrator; a hash chain in the same database would not
change that trust boundary. For an independent compliance trail, export audit
events to a separately administered log/SIEM and limit production database
administrator access.

After every production `prisma db push` / migration, run:

```bash
npm run db:rls
```

That enables RLS, revokes `anon`/`authenticated` table access, and then runs a
failing verifier. It uses `DATABASE_URL_UNPOOLED` and must be executed against
the intended production database by a privileged operator. `npm run
db:rls:verify` is the read-only repeat check. The direct Prisma database owner
is intentionally not tested: it needs application access and bypasses RLS.

## Monitoring

Set `SECURITY_AUDIT_WEBHOOK_URL` to an approved HTTPS SIEM or alerting bridge to
receive `DENIED` and `LOGIN_FAILED` events. Treat its receiver as sensitive: the
payload includes audit metadata. Delivery is best-effort and times out after two
seconds, so it cannot replace the local database audit trail or a durable event
queue. Alert on the receiver's own failed-delivery/heartbeat signal too.

The dependency workflow runs `npm audit --omit=dev --audit-level=high` for pull
requests, main, and weekly. A failing audit must be triaged before release;
exceptions need a documented expiry and owner rather than a lower threshold.

## Backups and recovery

Run `npm run backup` on a protected scheduler at least daily and before schema
changes. The script writes a mode-700 local `backups/` directory, a SHA-256
checksum, and retains the newest 30 dumps. The filesystem location is not a
backup by itself: copy encrypted backups to a separate access-controlled
location and monitor the scheduler's exit status.

At least quarterly, restore a recent dump into an isolated, non-production
database, verify its checksum first (`shasum -a 256 -c FILE.sha256`), then check
row counts and a representative asset, fuel transaction, document, and audit
event. Record the restore date, operator, dump identifier, and result. Never
restore into the live database as a verification step.

## VAPID key rotation

VAPID key rotation invalidates browser push subscriptions by protocol design.
Plan it: generate the replacement pair, deploy both configured values, notify
users to reopen/subscribe, monitor new subscriptions, and only then retire the
old private key. There is no safe transparent key swap for existing browser
subscriptions.
