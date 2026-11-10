# Agent notes

## Tests

Run the app suite from `openbot/`, not the repository root. From the root, happy-dom is not registered and about 143 DOM tests fail for that reason alone.

App tests:

```sh
cd openbot
TEST_DATABASE_URL=postgres://openbot:openbot@127.0.0.1:5432/openbot_test bun test app/tests
```

Server tests, from the same directory. `ACADEMIC_OS_PRIVATE_DEMO=0` matters: `bun test` loads `openbot/.env`, and the dev script turns the private school pack on there. With that flag left on, school-service tests read the pack instead of their fixtures.

```sh
cd openbot
ACADEMIC_OS_PRIVATE_DEMO=0 TEST_DATABASE_URL=postgres://openbot:openbot@127.0.0.1:5432/openbot_test bun test server/tests
```

`bash scripts/academic-os-dev.sh` migrates `openbot_test` before those commands. Lint, typecheck, and build also run from `openbot/`: `bun run lint`, `bun run typecheck`, `bun run build`.
