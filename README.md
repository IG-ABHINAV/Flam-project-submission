# QueueCTL

A production-minded Node.js background-job queue, delivered as a clean CLI. It persists jobs in SQLite, runs multiple detached worker processes, retries failures with exponential backoff, and moves exhausted jobs to a Dead Letter Queue (DLQ).

It also implements every bonus feature from the brief: job timeouts, priority queues, scheduled jobs (`run_at`), persisted command output/attempt logs, execution metrics, and a small Express monitoring dashboard.

## Stack and setup

- Node.js 20+
- SQLite through `better-sqlite3` (no external service required)
- Commander CLI and Express dashboard

```bash
npm install
npm link                 # makes the `queuectl` command available globally
# Or, without linking: node bin/queuectl.js --help
```

The local database defaults to `.queuectl/queuectl.sqlite` and is deliberately excluded from Git. Set `QUEUECTL_DB` to use another path.

## CLI usage

```bash
# Configure defaults (per-job max_retries can override this)
queuectl config set max-retries 3
queuectl config set backoff-base 2

# Basic job
queuectl enqueue '{"id":"hello","command":"node -e \"console.log(\u0027Hello World\u0027)\""}'

# Bonus: priority, delayed scheduling, timeout
queuectl enqueue '{"id":"important","command":"node report.js","max_retries":4}' --priority 10 --timeout 30
queuectl enqueue '{"id":"later","command":"echo scheduled"}' --run-at 2026-12-31T23:00:00Z

# Background workers; each receives a unique worker record
queuectl worker start --count 3
queuectl status
queuectl list --state pending
queuectl logs hello

# Gracefully finishes any in-flight job, then exits workers
queuectl worker stop

# DLQ inspection and requeue
queuectl dlq list
queuectl dlq retry failed-job-id
```

All commands output readable JSON, making them practical for scripts as well as manual review. `queuectl --help` and each subcommand's `--help` document the available options.

## Dashboard

```bash
npm run dashboard
# Open http://localhost:3000
```

The lightweight Express page refreshes queue totals, active workers, and runtime configuration every two seconds. The underlying `GET /api/status` is also useful for integrations.

## Architecture

```text
CLI -> SQLite (WAL mode) <- Workers (one Node process each)
          |                    |
          +-> jobs / attempts  +-> shell command child process
          +-> workers/settings      -> output, exit code, retry or DLQ
                         |
                    Express status API
```

### Lifecycle and safety

`pending -> processing -> completed`

On a non-zero exit code (including an invalid command or a timeout), a job becomes `failed` and is scheduled for `base ^ attempts` seconds later. When `attempts > max_retries`, it becomes `dead`. This means `max_retries: 3` permits the initial run plus three retries.

SQLite WAL mode allows concurrent readers and writers. A worker claims a job inside an immediate transaction, changing its state to `processing` before execution; this prevents two workers from receiving the same job. Worker stop sets a durable shutdown flag: workers do not take another job but finish their current command first.

### Data model

Each job contains the required fields (`id`, `command`, `state`, `attempts`, `max_retries`, `created_at`, `updated_at`) plus `priority`, `run_at`, `timeout_seconds`, result metadata, and command output. The `attempt_logs` table preserves a record of every execution.

## Testing and verification

```bash
npm test
npm run demo
```

The automated tests cover DLQ/backoff, priority/scheduling selection, and the state-transition property that prevents a duplicate claim. For a live concurrency check, enqueue several `sleep`/`setTimeout` jobs, start multiple workers, and inspect `queuectl logs <id>`: each job has one log record per attempt and exactly one worker ID per attempt.

## Assumptions and trade-offs

- Commands intentionally use the operating system shell because the assignment examples are shell commands. In a multi-tenant deployment, commands must be validated or replaced by an allow-listed handler registry.
- SQLite is ideal for a single-machine CLI assignment: it is durable, simple to demo, and safely handles this worker concurrency model. A distributed deployment would replace claim logic with a shared database or message broker.
- A worker killed ungracefully during a command leaves a `processing` job. Production systems commonly add a lease/reaper; this focused implementation prioritizes the required graceful shutdown path and duplicate-safe claims.

## Submission checklist

- [x] Working Node CLI and clean help text
- [x] Durable storage across restarts
- [x] Multiple workers with atomic claims
- [x] Exponential backoff, retries, DLQ, and DLQ retry
- [x] Configurable retry/backoff settings
- [x] Timeout, priority, scheduling, logs, metrics, dashboard
- [x] Tests, demo script, architecture documentation

For the final interview submission, record a short terminal demo showing enqueue, worker start, status, a failed job reaching `dlq list`, and `dlq retry`; add the recording link here before pushing the public repository.

# Flam-project-submission
