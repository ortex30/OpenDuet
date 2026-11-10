# Private school pack

Academic OS can run the demo on a real class list. That export stays on this machine. It is not committed.

Unzip the pack so one of these files exists:

- `data/private/classes.json`
- `data/private/academic-os-data/classes.json`

The pack needs `classes.json`, `assignments_and_tests.json`, and a `materials/` folder next to `classes.json`.

Then start the app:

```sh
bash scripts/academic-os-dev.sh
```

The script turns the pack on (`ACADEMIC_OS_PRIVATE_DEMO=1`) and greets the student as Viren. Today's plan, the calendar, Learn, and study guides use the current-term classes. Rows under `historical_unconfirmed_spring_2026` are counted and left out. They are not live deadlines.

Without the pack, the same command keeps the generic Jordan Rivera week.

To fill study memory again after the app has been opened once:

```sh
cd openbot/server && bun --env-file=../.env scripts/seed-study-demo.ts --pack --reset
```

The generic memory seed is the same command without `--pack`.
