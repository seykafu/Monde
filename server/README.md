# monde-mind

From the repository root, install dependencies with `npm install`, then run
`npm run dev -w @monde/server`. No services or API key are required for startup.
Configuration is read from process environment variables; local .env files are
not loaded automatically.

- `PORT`: 8080
- `NODE_ENV`: development, test, or production (default development)
- `MONDE_ENV`: dev, staging, or production (default dev)
- `LOG_LEVEL`: pino level (default info)
- `GIT_SHA`: version returned by both routes (default dev)
- `DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`: optional

`GET /v1/health` always returns HTTP 200 while the process is responsive.
Configured but unavailable services set `ok` to false; absent services are off.
`GET /v1/version` returns `{ "version": "<GIT_SHA or dev>" }`.

## Migrations

Set `DATABASE_URL` and run `npm run db:migrate -w @monde/server`.
Without it, migrations print a skip message and exit successfully.
After changing the schema, run `npm run db:generate -w @monde/server`.
The compiled equivalent is `node server/dist/db/migrate.js`, used by Fly's
release command. Migration paths are resolved relative to the module, so both
entrypoints work regardless of the working directory.

## Deployment handoff

Build from the repository root: `docker build -f server/Dockerfile .`.
Use the repository root as Fly's build context and `server/fly.toml` as its
configuration. Provision services separately and set DATABASE_URL, REDIS_URL,
and eventually ANTHROPIC_API_KEY as Fly secrets. Supply GIT_SHA as a build
argument or runtime environment variable. The container runs as the node user.

## Initial implementation verification limitation

The implementation environment could not resolve registry.npmjs.org and had
no cached copies of the new packages. Dependency versions in package.json are
requested ranges, not verified installed versions; the root lockfile still
needs an npm install. The initial SQL, journal, and snapshot were authored
manually in Drizzle format because drizzle-kit could not be installed.
After installation, run db:generate to verify the snapshot matches the schema
(no schema changes expected), then run typecheck, tests, lint, build, and a live
health request before deployment. Docker was unavailable in that environment.
