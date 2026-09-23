-- An account holds a **set** of roles, so that managing and hosting can cumulate
-- (RG-14): `{}` is a participant, `{host}` runs its own bank, `{admin}` reads and
-- administers the instance, `{admin,host}` does both.
ALTER TABLE "user" ADD COLUMN "roles" "user_role"[] NOT NULL DEFAULT '{}';
ALTER TABLE "user" ADD COLUMN "assigned_roles" "user_role"[] NOT NULL DEFAULT '{}';

-- Nobody loses a capability on upgrade: an `admin` could host until now, so it
-- keeps hosting. Make it a pure manager with `user:set-role <sub> admin`.
UPDATE "user" SET "roles" = CASE
  WHEN "role" = 'admin' THEN ARRAY['admin', 'host']::"user_role"[]
  WHEN "role" = 'host' THEN ARRAY['host']::"user_role"[]
  ELSE '{}'::"user_role"[]
END;
UPDATE "user" SET "assigned_roles" = CASE
  WHEN "assigned_role" = 'admin' THEN ARRAY['admin', 'host']::"user_role"[]
  WHEN "assigned_role" = 'host' THEN ARRAY['host']::"user_role"[]
  ELSE '{}'::"user_role"[]
END;

ALTER TABLE "user" DROP COLUMN "role";
ALTER TABLE "user" DROP COLUMN "assigned_role";
