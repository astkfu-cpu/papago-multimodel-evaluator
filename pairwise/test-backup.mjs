import test from 'node:test';
import assert from 'node:assert/strict';
import {backupOf,parseBackup,matchesFilter} from './backup.js';
const sample=()=>({id:'sample-id',schema:'papago_pairwise_assistant_record/v1',createdAt:'2026-10-20T16:00:00.000Z',updatedAt:'2026-10-21T00:00:00.000Z',sheetId:'DEMO',evaluator:'DEMO-USER',scope:['EN_JA'],pairId:'p1',index:1,total:8,languagePair:'EN_JA',pageURL:'file:///demo/index.html',images:[{side:'src',url:'file:///demo/src/a.jpg',width:900,height:1400,rotation:0}],applied:false,result:{translation:'A',rendering:'B',translation_reason:'A 更准确',rendering_reason:'B 布局更接近',source_summary:'图中文字',a_evidence:'A 的依据',b_evidence:'B 的依据',a_state:'normal',b_state:'normal',confidence:0.9,needs_review:false,review_reason:''}});
test('backup round trip retains reasons/status and excludes settings/private reasoning',()=>{
 const row=sample();row.apiKey='DUMMY-SECRET';row.result.reasoning_content='PRIVATE-REASONING';row.result.apiKey='DUMMY-SECRET';
 const backup=backupOf([row],'1.1.0');assert.equal(parseBackup(backup)[0].result.rendering_reason,row.result.rendering_reason);
 assert(!JSON.stringify(backup).includes('DUMMY-SECRET'));assert(!JSON.stringify(backup).includes('PRIVATE-REASONING'));
});
test('official results, unknown schemas, duplicate IDs and corrupt records fail before write',()=>{
 assert.throws(()=>parseBackup({judgments:{}}),/不是插件/);
 const b=backupOf([sample()],'1.1.0');assert.throws(()=>parseBackup({...b,schema:'future/v2'}));
 assert.throws(()=>parseBackup({...b,records:[b.records[0],b.records[0]]}),/重复/);
 const broken=structuredClone(b);broken.records[0].result.confidence=2;assert.throws(()=>parseBackup(broken));
 const remote=sample();remote.images[0].url='https://example.com/private';assert.throws(()=>backupOf([remote],'1.1.0'),/本地/);
});
test('Beijing day boundaries and current task/account filters',()=>{
 const row=sample(),range={from:'2026-10-20T16:00:00.000Z',to:'2026-10-21T16:00:00.000Z'};
 assert(matchesFilter(row,range));assert(!matchesFilter({...row,createdAt:range.to},range));
 assert(!matchesFilter(row,{sheetId:'OTHER'}));assert(!matchesFilter(row,{evaluator:'OTHER'}));assert(matchesFilter(row,{sheetId:'DEMO',evaluator:'DEMO-USER'}));
});
