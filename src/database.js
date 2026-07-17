import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const isoNow = () => new Date().toISOString();
export const dbPath = () =>
  process.env.QUEUECTL_DB || ".queuectl/queuectl.sqlite";

export function openStore(file = dbPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 15000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, command TEXT NOT NULL, state TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, max_retries INTEGER NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0, run_at TEXT NOT NULL,
      timeout_seconds INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      started_at TEXT, completed_at TEXT, worker_id TEXT, exit_code INTEGER,
      last_error TEXT, output TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS ready_jobs ON jobs(state, run_at, priority DESC, created_at);
    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY, pid INTEGER NOT NULL, state TEXT NOT NULL,
      started_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL, stopped_at TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attempt_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, attempt INTEGER NOT NULL,
      worker_id TEXT, started_at TEXT NOT NULL, finished_at TEXT, exit_code INTEGER,
      state TEXT NOT NULL, output TEXT NOT NULL DEFAULT '', error TEXT,
      FOREIGN KEY(job_id) REFERENCES jobs(id)
    );
  `);
  for (const [key, value] of Object.entries({
    "max-retries": "3",
    "backoff-base": "2",
    shutdown: "0",
  })) {
    db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)").run(
      key,
      value,
    );
  }
  return db;
}

export const getSetting = (db, key) =>
  db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value;
export const setSetting = (db, key, value) =>
  db
    .prepare(
      "INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(key, String(value));
export const settings = (db) =>
  Object.fromEntries(
    db
      .prepare("SELECT key,value FROM settings ORDER BY key")
      .all()
      .map((x) => [x.key, x.value]),
  );

export function enqueue(db, job) {
  const time = isoNow();
  db.prepare(
    `INSERT INTO jobs (id,command,state,attempts,max_retries,priority,run_at,timeout_seconds,created_at,updated_at)
    VALUES (@id,@command,'pending',0,@max_retries,@priority,@run_at,@timeout_seconds,@created_at,@updated_at)`,
  ).run({ ...job, created_at: time, updated_at: time });
}

export function claimJob(db, workerId) {
  // BEGIN IMMEDIATE makes the select-and-claim atomic: do workers same job nahi le sakte.
  const claim = db.transaction(() => {
    const job = db
      .prepare(
        `SELECT * FROM jobs WHERE state IN ('pending','failed') AND run_at <= ?
      ORDER BY priority DESC, run_at, created_at LIMIT 1`,
      )
      .get(isoNow());
    if (!job) return null;
    const time = isoNow();
    const result = db
      .prepare(
        `UPDATE jobs SET state='processing', attempts=attempts+1, worker_id=?, started_at=?, updated_at=?
      WHERE id=? AND state IN ('pending','failed')`,
      )
      .run(workerId, time, time, job.id);
    return result.changes
      ? db.prepare("SELECT * FROM jobs WHERE id=?").get(job.id)
      : null;
  });
  return claim.immediate();
}

export function finishJob(db, job, workerId, result) {
  const time = isoNow();
  const succeeded = result.exitCode === 0;
  const dead = !succeeded && job.attempts > job.max_retries;
  const state = succeeded ? "completed" : dead ? "dead" : "failed";
  const delayMs = Number(getSetting(db, "backoff-base")) ** job.attempts * 1000;
  const runAt =
    succeeded || dead ? time : new Date(Date.now() + delayMs).toISOString();
  db.prepare(
    `UPDATE jobs SET state=?,run_at=?,completed_at=?,updated_at=?,exit_code=?,last_error=?,output=?,worker_id=? WHERE id=?`,
  ).run(
    state,
    runAt,
    succeeded || dead ? time : null,
    time,
    result.exitCode,
    result.error,
    result.output,
    workerId,
    job.id,
  );
  db.prepare(
    `INSERT INTO attempt_logs(job_id,attempt,worker_id,started_at,finished_at,exit_code,state,output,error)
    VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    job.id,
    job.attempts,
    workerId,
    job.started_at || time,
    time,
    result.exitCode,
    state,
    result.output,
    result.error,
  );
  return state;
}
