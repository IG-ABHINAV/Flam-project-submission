import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { dbPath, enqueue, getSetting, isoNow, openStore, setSetting, settings } from './database.js';
import { runWorker } from './worker.js';

const json = value => console.log(JSON.stringify(value, null, 2));
const parseRunAt = value => {
  if (!value) return isoNow(); const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || !/[zZ]|[+-]\d\d:\d\d$/.test(value)) throw new Error('run-at must be ISO-8601 with timezone, e.g. 2026-01-01T12:00:00Z');
  return date.toISOString();
};
const rows = (db, state) => db.prepare(`SELECT * FROM jobs ${state ? 'WHERE state=?' : ''} ORDER BY priority DESC, created_at`).all(...(state ? [state] : []));

export function main(argv = process.argv) {
  const program = new Command().name('queuectl').description('Durable background job queue CLI').option('--db <path>', 'SQLite database path');
  const store = () => openStore(program.opts().db || dbPath());
  program.command('enqueue <job>').description('Add JSON job: {"id":"hello","command":"echo hi"}')
    .option('--priority <number>', 'higher values run first', Number).option('--run-at <time>', 'ISO-8601 scheduled time').option('--timeout <seconds>', 'job timeout', Number)
    .action((raw, options) => { let job; try { job = JSON.parse(raw); } catch { throw new Error('Invalid job JSON'); } if (!job.id || !job.command) throw new Error('Job requires id and command'); const db = store(); job.max_retries = job.max_retries ?? Number(getSetting(db, 'max-retries')); job.priority = options.priority ?? job.priority ?? 0; job.run_at = parseRunAt(options.runAt ?? job.run_at); job.timeout_seconds = options.timeout ?? job.timeout_seconds ?? null; if (job.max_retries < 0 || (job.timeout_seconds !== null && job.timeout_seconds <= 0)) throw new Error('Invalid retries or timeout'); enqueue(db, job); db.close(); json({ message: 'Job enqueued', id: job.id, state: 'pending', run_at: job.run_at }); });
  const worker = program.command('worker').description('Manage worker processes');
  worker.command('start').option('--count <number>', 'number of background workers', Number, 1).option('--foreground', 'run one worker in current terminal').action(async options => { const file = program.opts().db || dbPath(); if (options.foreground) return runWorker(file); if (!Number.isInteger(options.count) || options.count < 1) throw new Error('count must be at least 1'); const db = store(); setSetting(db, 'shutdown', 0); db.close(); const script = fileURLToPath(new URL('../bin/queuectl.js', import.meta.url)); const pids = []; for (let i=0;i<options.count;i++) { const child = spawn(process.execPath, [script, '--db', file, 'worker', 'start', '--foreground'], { detached: true, stdio: 'ignore' }); child.unref(); pids.push(child.pid); } json({ message: 'Workers started', pids }); });
  worker.command('stop').description('Finish current jobs then stop workers').action(() => { const db=store(); setSetting(db, 'shutdown', 1); const active=db.prepare("SELECT * FROM workers WHERE state='running'").all(); db.close(); json({message:'Graceful shutdown requested', active_workers:active.length}); });
  program.command('status').description('Show job totals, workers and configuration').action(() => { const db=store(); const totals=Object.fromEntries(db.prepare('SELECT state,COUNT(*) AS count FROM jobs GROUP BY state').all().map(x=>[x.state,x.count])); json({ jobs: totals, active_workers: db.prepare("SELECT * FROM workers WHERE state='running'").all(), config: settings(db) }); db.close(); });
  program.command('list').option('--state <state>', 'pending|processing|completed|failed|dead').description('List jobs').action(options=>{ const valid=['pending','processing','completed','failed','dead']; if(options.state&&!valid.includes(options.state)) throw new Error('Unknown state'); const db=store(); json(rows(db,options.state)); db.close(); });
  const dlq=program.command('dlq').description('Dead Letter Queue operations'); dlq.command('list').action(()=>{const db=store();json(rows(db,'dead'));db.close();}); dlq.command('retry <id>').action(id=>{const db=store(); const change=db.prepare("UPDATE jobs SET state='pending',attempts=0,run_at=?,updated_at=?,last_error=NULL WHERE id=? AND state='dead'").run(isoNow(),isoNow(),id);db.close();if(!change.changes)throw new Error('Dead job not found');json({message:'DLQ job returned to pending',id});});
  const config=program.command('config').description('Queue configuration'); config.command('list').action(()=>{const db=store();json(settings(db));db.close();}); config.command('set <key> <value>').action((key,value)=>{if(!['max-retries','backoff-base'].includes(key)||!Number.isInteger(Number(value))||Number(value)<1)throw new Error('Use max-retries/backoff-base with an integer >= 1');const db=store();setSetting(db,key,value);db.close();json({message:'Configuration updated',[key]:Number(value)});});
  program.command('logs <id>').description('Show durable execution logs').action(id=>{const db=store();json(db.prepare('SELECT * FROM attempt_logs WHERE job_id=? ORDER BY id').all(id));db.close();});
  program.parse(argv);
}
