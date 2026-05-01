CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'krytz_app') THEN
    CREATE ROLE krytz_app
      LOGIN
      PASSWORD 'krytz_app_dev_password'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE;
  ELSE
    ALTER ROLE krytz_app
      WITH LOGIN
      PASSWORD 'krytz_app_dev_password'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE "Krytz" TO krytz_app;
GRANT USAGE, CREATE ON SCHEMA public TO krytz_app;
ALTER SCHEMA public OWNER TO krytz_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO krytz_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO krytz_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO krytz_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO krytz_app;

DO $$
DECLARE
  obj record;
BEGIN
  FOR obj IN
    SELECT schemaname, tablename
      FROM pg_tables
     WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO krytz_app', obj.schemaname, obj.tablename);
  END LOOP;

  FOR obj IN
    SELECT sequence_schema, sequence_name
      FROM information_schema.sequences
     WHERE sequence_schema = 'public'
  LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO krytz_app', obj.sequence_schema, obj.sequence_name);
  END LOOP;

  IF to_regprocedure('public.current_user_id()') IS NOT NULL THEN
    ALTER FUNCTION public.current_user_id() OWNER TO krytz_app;
  END IF;
END
$$;
