import express from 'express';
import { dbPath, openStore, settings } from './database.js';

const app = express(); const file = process.env.QUEUECTL_DB || dbPath();
app.get('/api/status', (_req,res) => { const db=openStore(file); const jobs=Object.fromEntries(db.prepare('SELECT state,COUNT(*) count FROM jobs GROUP BY state').all().map(x=>[x.state,x.count])); res.json({jobs, workers:db.prepare("SELECT * FROM workers WHERE state='running'").all(), config:settings(db)}); db.close(); });
app.get('/', (_req,res) => res.type('html').send(`<!doctype html><title>QueueCTL Monitor</title><style>body{font:16px system-ui;max-width:800px;margin:3rem auto;background:#101827;color:#e5e7eb}pre{background:#1f2937;padding:1rem;border-radius:8px}</style><h1>QueueCTL Monitor</h1><p>Auto-refreshing execution summary</p><pre id="data">Loading...</pre><script>async function load(){data.textContent=JSON.stringify(await (await fetch('/api/status')).json(),null,2)}load();setInterval(load,2000)</script>`));
app.listen(process.env.PORT || 3000, () => console.log(`QueueCTL dashboard: http://localhost:${process.env.PORT || 3000}`));
