-- The unique constraint already owns a B-tree on (contractId, date):
-- HireLog_contractId_date_key. The non-unique index on those exact columns is
-- therefore redundant and only adds write, WAL, vacuum, and storage overhead.
--
-- This intentionally drops only the redundant index, never the unique
-- constraint or its backing index. It is idempotent for fresh environments.
DROP INDEX IF EXISTS public."HireLog_contractId_date_idx";
