# Tests

Behavioral test suite for the AI Stock Analyzer worker.
Cases authored by **claude-helper**, runner by **Claude**.

## Run

```bash
node tests/run.mjs
```

Hits the live worker and asserts on **behavior** (not exact prices —
those move). Each case checks a rule: live price > 0, FX rate > 0,
greetings aren't tickers, Cyrillic company names resolve, unknown
tickers are rejected, historical price questions are answered, etc.

- `cases.json` — the test cases (add new ones here)
- `run.mjs` — the runner (paced to stay under the worker's rate limit)

Override the target with `WORKER_URL=... node tests/run.mjs`.
