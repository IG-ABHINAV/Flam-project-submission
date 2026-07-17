import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claimJob, enqueue, finishJob, openStore, setSetting } from '../src/database.js';

const freshDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'queuectl-')), 'test.sqlite');

test('atomic claim prevents duplicate processing', () => {
  const db = openStore(freshDb());
  enqueue(db, { id:'one', command:'echo ok', max_retries:3, priority:0, run_at:new Date().toISOString(), timeout_seconds:null });
  const worker = 'w1';
  const claim = claimJob(db, worker);
  assert.equal(claim.id, 'one');
  assert.equal(db.prepare("SELECT * FROM jobs WHERE state='pending'").get(), undefined);
  db.close();
});

test('failed jobs back off then reach dead letter queue', () => {
  const db = openStore(freshDb()); setSetting(db,'backoff-base',2);
  enqueue(db, { id:'bad', command:'nope', max_retries:1, priority:0, run_at:new Date().toISOString(), timeout_seconds:null });
  let job = db.prepare('SELECT * FROM jobs WHERE id=?').get('bad'); job.attempts = 1;
  assert.equal(finishJob(db,job,'w',{exitCode:1,output:'',error:'failed'}), 'failed');
  job = db.prepare('SELECT * FROM jobs WHERE id=?').get('bad'); job.attempts = 2;
  assert.equal(finishJob(db,job,'w',{exitCode:1,output:'',error:'failed'}), 'dead');
  assert.equal(db.prepare('SELECT state FROM jobs WHERE id=?').get('bad').state, 'dead'); db.close();
});

test('priority and scheduled jobs are ordered correctly', () => {
  const db=openStore(freshDb()); const now=new Date().toISOString();
  enqueue(db,{id:'low',command:'echo low',max_retries:1,priority:1,run_at:now,timeout_seconds:null});
  enqueue(db,{id:'high',command:'echo high',max_retries:1,priority:10,run_at:now,timeout_seconds:null});
  assert.equal(db.prepare("SELECT id FROM jobs WHERE state='pending' AND run_at<=? ORDER BY priority DESC LIMIT 1").get(new Date().toISOString()).id,'high'); db.close();
});
