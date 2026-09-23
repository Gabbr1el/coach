CREATE ROLE coach_migrator LOGIN PASSWORD 'coach_migrator_local' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE coach_runtime LOGIN PASSWORD 'coach_runtime_local' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE DATABASE coach_test OWNER coach_migrator;
GRANT CONNECT ON DATABASE coach TO coach_migrator, coach_runtime;
GRANT CONNECT ON DATABASE coach_test TO coach_migrator, coach_runtime;
ALTER DATABASE coach OWNER TO coach_migrator;
\connect coach
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION postgres;
