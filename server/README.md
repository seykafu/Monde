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

## World creation (M-01)

`POST /v1/worlds` accepts `{ "device_id": "...", "invite_code": "..." }` and
returns `{ "world_id": "...", "token": "..." }`. Each call creates a distinct
save, including when the device already exists. Device upsert, world, residents,
and directed relationships are committed together. The Day-1 template is parsed
and validated once per content directory, then cloned for each request.

`GET /v1/worlds/:w` returns `{ world_id, day, minute, residents }`. Send
`Authorization: Bearer <token>` on this and every nested world route. Tokens are
HMAC-SHA256 signatures bound to the world's stored device id.

- `MONDE_TOKEN_SECRET`: required in staging/production; set a strong random Fly
  secret. Changing it invalidates existing world tokens. Dev has a local fallback.
- `MONDE_INVITE_CODES`: comma-separated allowed codes; set as a Fly secret.
  Outside dev, an empty list denies world creation. Dev accepts any nonempty code.
- `MONDE_CONTENT_DIR`: optional content root containing `residents/*.yaml`.
  Defaults to the repository content directory relative to the server package.
  Docker sets `/app/content`, copied into the image without write permission.

Provision Postgres and set `DATABASE_URL` before enabling world creation. Fly's
existing release command applies the generated migrations. Redis and object
storage are not needed by these endpoints; snapshot storage must be provisioned
when snapshot operations are implemented. YAML is bundled from the already
installed package, so runtime installation needs no new dependency.

PGlite tests apply the real migration files. Verification for M-01 passed root
typecheck, tests and lint, plus the server build. Day-1 mood numbers are a
`GDD-GAP`: valence 0, energy 50, stress 0, content intensity 0. Needs start at 70
and stay at the requested placeholder 50 pending simulation computation.
