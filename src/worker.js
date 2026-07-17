import { exec } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import {
  claimJob,
  dbPath,
  finishJob,
  getSetting,
  isoNow,
  openStore,
} from "./database.js";

const execAsync = promisify(exec);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function execute(job) {
  try {
    const { stdout, stderr } = await execAsync(job.command, {
      shell: true,
      timeout: job.timeout_seconds ? job.timeout_seconds * 1000 : undefined,
      maxBuffer: 1024 * 1024,
    });
    return { exitCode: 0, output: `${stdout}${stderr}`, error: null };
  } catch (error) {
    const timeout = error.killed && error.signal === "SIGTERM";
    return {
      exitCode: timeout ? 124 : (error.code ?? 1),
      output: `${error.stdout || ""}${error.stderr || ""}`,
      error: timeout
        ? `Timed out after ${job.timeout_seconds} seconds`
        : `Command failed: ${error.message}`,
    };
  }
}

export async function runWorker(file = dbPath()) {
  const db = openStore(file);
  const id = `worker-${crypto.randomUUID().slice(0, 8)}`;
  const time = isoNow();
  db.prepare(
    "INSERT INTO workers(id,pid,state,started_at,heartbeat_at) VALUES (?,?,'running',?,?)",
  ).run(id, process.pid, time, time);
  let stopping = false;
  const requestStop = () => {
    stopping = true;
  };
  process.on("SIGTERM", requestStop);
  process.on("SIGINT", requestStop);
  try {
    while (!stopping && getSetting(db, "shutdown") !== "1") {
      db.prepare("UPDATE workers SET heartbeat_at=? WHERE id=?").run(
        isoNow(),
        id,
      );
      const job = claimJob(db, id);
      if (!job) {
        await wait(Number(process.env.QUEUECTL_POLL_MS || 250));
        continue;
      }
      // Current job poora hone do, then graceful shutdown applies.
      finishJob(db, job, id, await execute(job));
    }
  } finally {
    db.prepare(
      "UPDATE workers SET state='stopped', stopped_at=?, heartbeat_at=? WHERE id=?",
    ).run(isoNow(), isoNow(), id);
    db.close();
  }
}
