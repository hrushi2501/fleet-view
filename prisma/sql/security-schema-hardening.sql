-- Additive owner-only performance change for the security hardening release.
--
-- Asset retirement uses the existing `decommissionedOn` column, so deployment
-- needs no Asset DDL. Telemetry's historical unique index remains a separate,
-- review-gated operation. This statement is idempotent and rewrites no rows.

CREATE INDEX IF NOT EXISTS "AuditEvent_entity_entityId_idx"
  ON "AuditEvent" ("entity", "entityId");
