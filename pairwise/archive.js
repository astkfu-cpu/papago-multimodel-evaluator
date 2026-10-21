import {backupOf,parseBackup,matchesFilter} from './backup.js';
const DB_NAME='papago-pairwise-assistant-archive';
let opening;
function database() {
  if(!opening)opening=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{const store=request.result.createObjectStore('records',{keyPath:'id'});store.createIndex('createdAt','createdAt');};
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
    request.onerror=()=>{opening=null;reject(request.error);};
  });
  return opening;
}
export async function saveRecord(snapshot,result,applied=false) {
  const id=result.archiveId || crypto.randomUUID();const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');const existing=store.get(id);
    existing.onsuccess=()=>{
      const old=existing.result;const time=new Date().toISOString();
      store.put({id,schema:'papago_pairwise_assistant_record/v1',createdAt:old?.createdAt || time,updatedAt:time,sheetId:snapshot.sheetId,evaluator:snapshot.evaluator,scope:snapshot.scope,pairId:snapshot.pairId,index:snapshot.index,total:snapshot.total,languagePair:snapshot.languagePair,pageURL:snapshot.url,images:snapshot.images.map(x=>({...x})),applied:Boolean(applied || old?.applied),result:{...result,archiveId:id}});
    };
    tx.oncomplete=()=>resolve(id);
    tx.onerror=()=>reject(new Error('长期归档保存失败：'+(tx.error?.message || '浏览器存储错误')));
    tx.onabort=()=>reject(new Error('长期归档写入中断；已暂停，避免继续丢失记录'));
  });
}
export async function records(filter=null) {
  const all=[];let after=null;
  do {const page=await recordPage(filter || {},{after,limit:500});all.push(...page.rows);after=page.next;}while(after);
  return all.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
// A primary-key cursor avoids getAll() and bounds each message/export batch.
export async function recordPage(filter={}, {after=null,limit=500}={}) {
  limit=Math.max(1,Math.min(500,Math.floor(Number(limit))||500));const db=await database();
  return new Promise((resolve,reject)=>{
    const rows=[],tx=db.transaction('records','readonly');
    const req=tx.objectStore('records').openCursor(after?IDBKeyRange.lowerBound(after,true):null);
    let next=null;
    req.onsuccess=()=>{const c=req.result;if(!c)return;if(matchesFilter(c.value,filter)){if(rows.length===limit){next=rows.at(-1).id;return;}rows.push(c.value);}c.continue();};
    tx.oncomplete=()=>resolve({rows,next});tx.onerror=()=>reject(tx.error);
  });
}
export async function exportBatch(filter,after,limit,format,version) {
  const page=await recordPage(filter,{after,limit});
  return {count:page.rows.length,next:page.next,...(format==='json'?{json:backupOf(page.rows,version)}:{html:offlineReport(page.rows)})};
}
export async function restoreBackup(backup,commit=false) {
  const incoming=parseBackup(backup),db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('records',commit?'readwrite':'readonly'),store=tx.objectStore('records');
    const summary={total:incoming.length,added:0,existing:0,conflicts:0};
    for(const row of incoming){const req=store.get(row.id);req.onsuccess=()=>{
      if(req.result){summary.existing++;if(JSON.stringify(backupOf([req.result],'').records[0])!==JSON.stringify(row))summary.conflicts++;}
      else {summary.added++;if(commit)store.add(row);}
    };}
    tx.oncomplete=()=>resolve({...summary,committed:commit});tx.onerror=()=>reject(new Error('归档恢复失败，未完成的事务已回滚'));tx.onabort=()=>reject(new Error('归档恢复已回滚'));
  });
}
export async function archiveInfo() {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('records','readonly'),store=tx.objectStore('records');
    const countRequest=store.count(),cursorRequest=store.index('createdAt').openCursor(null,'prev');const recent=[];
    cursorRequest.onsuccess=()=>{const cursor=cursorRequest.result;if(cursor && recent.length<8){recent.push(cursor.value);cursor.continue();}};
    tx.oncomplete=()=>resolve({count:countRequest.result,recent});tx.onerror=()=>reject(tx.error);
  });
}
export function escapeHTML(value) {return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function offlineReport(rows) {
  const e=escapeHTML;const winner=x=>({A:'A 胜',tie:'平局',B:'B 胜'})[x] || '待人工判断';
  const link=image=>{try{const u=new URL(image.url);return u.protocol==='file:'?`<a href="${e(u.href)}">${e(({src:'原图',a:'A图',b:'B图'})[image.side] || image.side)}</a>`:'';}catch{return '';}};
  const articles=rows.map(row=>`<article><h2>${e(row.evaluator)} · ${e(row.languagePair)} · 第 ${e(row.index)}/${e(row.total)} 项</h2><p class="meta">题目 ID ${e(row.pairId)} · ${row.applied?'原表两项已保存':'仅分析，未由插件填入'} · ${row.result.needs_review?'需人工复核':'分析完成'}<br>任务 ${e(row.sheetId)}<br>分析 ${e(row.createdAt)} · 更新 ${e(row.updatedAt)} · 模型 ${e(row.result.model || '')} · 模型自评置信度（非正确率） ${e(Math.round(row.result.confidence*100))}%</p><table><thead><tr><th>维度</th><th>建议</th><th>具体依据</th></tr></thead><tbody><tr><td>翻译</td><td>${e(winner(row.result.translation))}</td><td>${e(row.result.translation_reason)}</td></tr><tr><td>渲染</td><td>${e(winner(row.result.rendering))}</td><td>${e(row.result.rendering_reason)}</td></tr></tbody></table><p><b>原图内容：</b>${e(row.result.source_summary)}</p><p><b>A 的证据：</b>${e(row.result.a_evidence)}</p><p><b>B 的证据：</b>${e(row.result.b_evidence)}</p>${row.result.review_reason?`<p class="notice">复核原因：${e(row.result.review_reason)}</p>`:''}<p>${row.images.map(link).join('')}</p><p class="meta">完整图片读取：${(row.result.imageInfo || []).map(x=>e(`${x.label} 原始 ${x.originalWidth}×${x.originalHeight} → 完整送评 ${x.width}×${x.height}`)).join('；')}<br>规则 ${e(row.result.ruleVersion)} · ${row.result.refined?'已进行整图放大复核':'常规整图分析'} · ${row.result.cached?'复用了相同输入缓存':'模型请求'}<br>request_id ${e(row.result.requestId || '未提供')}<br>本地图片链接依赖原任务包位置；本报告不嵌入图片，也不包含 API Key。</p></article>`).join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Papago 成对评价插件离线记录</title><style>body{font-family:"Microsoft YaHei",sans-serif;margin:32px auto;padding:0 24px;max-width:1180px;color:#253348;background:#f8fafc;line-height:1.7}h1{font-size:24px}h2{font-size:18px}article{background:white;border:1px solid #d7dfe9;margin:20px 0;padding:20px;border-radius:8px}.meta{font-size:12px;color:#64748b;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{padding:12px;border:1px solid #d7dfe9;vertical-align:top;text-align:left;overflow-wrap:anywhere}th{background:#edf2f8}th:first-child{width:70px}td:nth-child(2){width:95px}a{color:#245e9b;margin-right:12px}p{overflow-wrap:anywhere}button{padding:8px 14px;border:1px solid #bfcbd9;border-radius:5px;background:white;cursor:pointer}.notice{color:#92400e}@media print{body{background:white;margin:0}article{break-inside:avoid}button{display:none}}</style><h1>Papago 成对评价插件离线记录</h1><p>导出时间：${e(new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))}（北京时间） · 共 ${rows.length} 条分析记录 · ${rows.filter(x=>x.applied).length} 条已由原表保存。</p><p class="notice">此文件用于本机核对分析依据，属于插件记录。正式提交结果请使用原评估表的“결과 내보내기”导出，保留其文件名和内容。分析记录数量不等于原表完成数量。</p><button onclick="window.print()">打印或另存 PDF</button>${articles}<footer class="meta">Papago 成对评价助手 · 长期浏览器归档的离线副本</footer></html>`;
}
