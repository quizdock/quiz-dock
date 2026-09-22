-- `host` becomes an assignable role (RG-14): `assigned_role` records what the
-- operator granted through the CLI, `role` stays the effective role recomputed
-- on every request (the grant, or what the claims / the seat derive). Existing
-- admins were operator grants — today's stickiness — so they are carried over;
-- `host` was only ever derived, hence left null.
ALTER TABLE "user" ADD COLUMN "assigned_role" "user_role";

UPDATE "user" SET "assigned_role" = 'admin' WHERE "role" = 'admin';
