import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {backupOf} from '../pairwise/backup.js';
import {summarizeBackup, inspectBackup} from './inspect-backup.mjs';

const sample = id => ({id, schema:'papago_pairwise_assistant_record/v1',createdAt:'2026-10-20T16:00:00.000Z',updatedAt:'2026-10-21T00:00:00.000Z',sheetId:'SYNTHETIC-TASK',evaluator:'SYNTHETIC-ALIAS',scope:['EN_JA'],pairId:id,index:1,total:8,languagePair:'EN_JA',pageURL:'file:///synthetic/index.html',images:[],applied:false,result:{translation:null,rendering:null,translation_reason:'synthetic reason',rendering_reason:'synthetic reason',source_summary:'synthetic',a_evidence:'synthetic',b_evidence:'synthetic',a_state:'uncertain',b_state:'normal',confidence:0.5,needs_review:true,review_reason:'synthetic review'}});
const script = fileURLToPath(new URL('./inspect-backup.mjs', import.meta.url));
const invoke = args => spawnSync(process.execPath, [script, ...args], {encoding:'utf8'});

async function fixture(run) {
  const root=mkdtempSync(join(tmpdir(),'papago-backup-inspection-'));
  try { await run(join(root,'合成 backup.json')); }
  finally { assert(resolve(root).startsWith(resolve(tmpdir())+sep+'papago-backup-inspection-')); rmSync(root,{recursive:true,force:true}); }
}

test('counts applied and review independently without exposing identities or mutating evidence',()=>{
  const a=sample('one'),b=sample('two'),c=sample('three');
  a.applied=true; b.result.needs_review=false; c.sheetId='OTHER'; c.evaluator='OTHER';
  const value=backupOf([a,b,c],'1.1.0'),before=JSON.stringify(value);
  assert.deepEqual(summarizeBackup(value),{records:3,applied:1,notApplied:2,needsReview:2,tasks:2,evaluators:2});
  assert.equal(JSON.stringify(value),before);
  assert(!JSON.stringify(summarizeBackup(value)).includes('SYNTHETIC'));
});

test('empty plugin backup has zero counts',()=>{
  assert.deepEqual(summarizeBackup(backupOf([],'1.1.0')),{records:0,applied:0,notApplied:0,needsReview:0,tasks:0,evaluators:0});
});

test('official-like JSON, duplicate IDs and corrupt records are rejected by existing validation',()=>{
  assert.throws(()=>summarizeBackup({judgments:{}}));
  const b=backupOf([sample('same')],'1.1.0');
  assert.throws(()=>summarizeBackup({...b,records:[b.records[0],b.records[0]]}));
  b.records[0].result.confidence=2; assert.throws(()=>summarizeBackup(b));
});

test('BOM file and CLI with spaces stay read-only and print counts only',()=>fixture(async path=>{
  writeFileSync(path,'\uFEFF'+JSON.stringify(backupOf([sample('id')],'1.1.0')));
  const before=readFileSync(path);
  const expected=await inspectBackup(path),result=invoke([path]);
  assert.equal(result.status,0,result.stderr); assert.deepEqual(JSON.parse(result.stdout),expected);
  assert(!result.stdout.includes('SYNTHETIC-ALIAS')); assert.deepEqual(readFileSync(path),before);
}));

test('CLI failure does not echo input excerpts or paths',()=>fixture(async path=>{
  writeFileSync(path,'{"private-EXAMPLE-marker": broken');
  const result=invoke([path]); assert.equal(result.status,1); assert(!result.stderr.includes('private-EXAMPLE-marker')); assert(!result.stderr.includes(path));
  assert.equal(invoke([path+'.missing']).status,1);
}));

test('help succeeds and missing arguments fail',()=>{
  for(const flag of ['--help','-h']) { const result=invoke([flag]); assert.equal(result.status,0); assert.match(result.stdout,/Read-only counts/); }
  assert.equal(invoke([]).status,1);
});
