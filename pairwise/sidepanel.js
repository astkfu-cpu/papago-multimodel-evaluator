import { canAutoApply, settingsOf } from './shared.js';
const $=id=>document.getElementById(id);
let tabId=null,config,working=false,lastState,archiveUpdate='',pollEpoch=0,pendingBackup=null,exportAfter=null,exportPart=1,exportSpec='';
async function call(type,extra={}) {
  const result=await chrome.runtime.sendMessage({type,tabId,...extra});
  if(!result?.ok)throw new Error(result?.error || '扩展后台未响应');
  return result;
}
function status(text){$('status').textContent=text;}
function notice(text){$('notice').textContent=text;$('notice').hidden=!text;}
async function readSettings() {
  const reply=await call('PW_SETTINGS');config=settingsOf(reply.settings);
  $('version').textContent='v'+reply.version;
  for(const [id,key] of [['model','model'],['endpoint','endpoint'],['effort','effort'],['batch-limit','batchLimit'],['threshold','confidenceThreshold'],['comment-mode','commentMode']])$(id).value=config[key];
  $('api-key').placeholder=reply.hasKey?'已保存，留空保留原密钥':'请输入百炼 API Key';
  if(!reply.hasKey)$('settings').open=true;
}
async function context() {
  const tabs=await chrome.tabs.query({active:true,currentWindow:true});tabId=tabs[0]?.id;
  if(!Number.isInteger(tabId))throw new Error('未找到当前标签页');
  try {
    const s=(await call('PW_CONTEXT')).snapshot;
    $('context').textContent=`${s.evaluator} · ${s.languagePair.replace('_',' → ')}\n当前第 ${s.index}/${s.total} 项 · 已完成 ${s.done}/${s.total}`;
  } catch(error) {$('context').textContent=error.message;}
  await poll();
}
function invalidateSuggestion(){pollEpoch++;$('result-section').hidden=true;$('apply').disabled=true;}
function showState(state,snapshot,contextError='') {
  lastState=state;status(state.message || '尚未开始');working=Boolean(state.running);
  for(const id of ['analyze','continuous','reanalyze','test-api'])$(id).disabled=working;
  $('stop').disabled=!working;
  $('restore-confirm').disabled=working || !pendingBackup;
  $('settings-form').querySelectorAll('input,select,button').forEach(el=>el.disabled=working);
  const matching=Boolean(snapshot && snapshot.key===state.snapshot?.key && !snapshot.complete && !snapshot.partial);
  const result=matching?state.result:null;$('result-section').hidden=!result;
  $('apply').disabled=!matching || working || !['ready','review'].includes(state.phase) || !canAutoApply(result,config);
  if(snapshot)$('context').textContent=`${snapshot.evaluator} · ${snapshot.languagePair.replace('_',' → ')}\n当前第 ${snapshot.index}/${snapshot.total} 项 · 已完成 ${snapshot.done}/${snapshot.total}`;
  else $('context').textContent=contextError || '当前页面不可用';
  if(state.result && !matching)status(contextError || '当前题目已变化，请重新分析。');
  if(!result)return;
  const names={A:'A 胜',tie:'平局',B:'B 胜'};
  $('translation').textContent=names[result.translation] || '待人工判断';$('rendering').textContent=names[result.rendering] || '待人工判断';
  $('translation-reason').textContent=result.translation_reason;$('rendering-reason').textContent=result.rendering_reason;
  $('confidence').textContent=`模型自评置信度 ${Math.round(result.confidence*100)}%${result.cached?' · 缓存':''}`;
  $('review-note').hidden=canAutoApply(result,config);
  $('review-note').textContent=result.review_reason || '模型自评置信度低于阈值。请在原表人工判断，或重新分析。';
  $('source-summary').textContent='原图：'+result.source_summary;$('a-evidence').textContent='A：'+result.a_evidence;$('b-evidence').textContent='B：'+result.b_evidence;
  $('image-info').textContent=(result.imageInfo || []).map(x=>`${x.label}: 原始 ${x.originalWidth}×${x.originalHeight}，完整送评 ${x.width}×${x.height}`).join('\n')+(result.refined?'\n已结合完整图片和覆盖整图的放大分块复核。':'');
}
async function poll() {
  if(!Number.isInteger(tabId) || !config)return;
  try {
    const epoch=++pollEpoch,target=tabId;
    const [reply,contextReply]=await Promise.all([call('PW_STATUS'),call('PW_CONTEXT').catch(error=>({error:error.message}))]);
    if(epoch!==pollEpoch || target!==tabId)return;
    const state=reply.status;showState(state,contextReply.snapshot,contextReply.error);
    if(archiveUpdate!==state.updatedAt){archiveUpdate=state.updatedAt;await updateArchive();}
  } catch(error){invalidateSuggestion();notice(error.message);}
}
async function action(fn) {try{notice('');await fn();await poll();}catch(error){notice(error.message);}}
async function updateArchive() {
  const info=await call('PW_ARCHIVE_INFO');$('archive-count').textContent=`${info.count} 条`;
  const container=$('recent-records');container.replaceChildren();
  for(const row of info.recent) {
    const item=document.createElement('details');item.style.marginTop='12px';
    const summary=document.createElement('summary');summary.textContent=`${row.evaluator} · ${row.languagePair} · ${row.index} · ${row.applied?'已填入':'仅分析'}`;item.appendChild(summary);
    for(const text of [`翻译 ${row.result.translation || '待判断'}：${row.result.translation_reason}`,`渲染 ${row.result.rendering || '待判断'}：${row.result.rendering_reason}`,`${row.createdAt} · ${row.result.needs_review?'需复核':'分析完成'}`]){const p=document.createElement('p');p.textContent=text;item.appendChild(p);}
    container.appendChild(item);
  }
}
function downloadArchive(content,filename,type){
  const url=URL.createObjectURL(new Blob([content],{type}));const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function exportArchive(current=false) {
  const filter=current?(await call('PW_CONTEXT')).snapshot:null;
  const reply=await call('PW_EXPORT_BATCH',{filter:filter?{sheetId:filter.sheetId,evaluator:filter.evaluator}:null,limit:500,format:'html'});
  const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  downloadArchive(reply.html,`Papago成对评价_插件离线记录_${date}_${current?'当前任务':'全部'}_第1批.html`,'text/html;charset=utf-8');
  notice(`已导出 ${reply.count} 条。${reply.next?'超过 500 条，请使用下方分批导出，逐批保留。':''}正式提交请另用原表导出。`);
}
async function selectedFilter(){
  const filter=$('archive-scope').value==='current'?(await call('PW_CONTEXT')).snapshot:{};
  const from=$('archive-from').value,to=$('archive-to').value;
  if(from && to && from>to)throw new Error('开始日期不能晚于结束日期');
  return {...(filter.sheetId?{sheetId:filter.sheetId,evaluator:filter.evaluator}:{}),...(from?{from:new Date(from+'T00:00:00+08:00').toISOString()}:{}),...(to?{to:new Date(Date.parse(to+'T00:00:00+08:00')+86400000).toISOString()}:{})};
}
async function exportPage(){
  const filter=await selectedFilter(),format=$('archive-format').value,spec=JSON.stringify([filter,format]);
  if(spec!==exportSpec){exportSpec=spec;exportAfter=null;exportPart=1;}
  const page=await call('PW_EXPORT_BATCH',{filter,format,after:exportAfter,limit:500});
  if(!page.count){$('export-progress').textContent='该范围没有记录';return;}
  downloadArchive(format==='json'?JSON.stringify(page.json,null,2):page.html,`插件归档_${new Date().toISOString().replace(/[:.]/g,'-')}_第${exportPart}.${format}`,format==='json'?'application/json':'text/html;charset=utf-8');
  $('export-progress').textContent=`第 ${exportPart} 批：${page.count} 条。${page.next?'仍有记录，请继续导出下一批。':'该范围导出完成。'}`;
  exportAfter=page.next;exportPart++;if(!page.next)exportSpec='';
}
$('export-batch').onclick=()=>action(exportPage);
$('archive-reset').onclick=()=>{exportSpec='';exportAfter=null;exportPart=1;$('export-progress').textContent='已重置，下一次从第一批开始';};
$('restore-file').onchange=()=>action(async()=>{
  pendingBackup=null;$('restore-confirm').disabled=true;const file=$('restore-file').files[0];if(!file)return;
  if(file.size>25*1024*1024)throw new Error('文件超过 25 MB，请选择原始分批插件备份');
  const backup=JSON.parse(await file.text()),reply=await call('PW_RESTORE_PREVIEW',{backup});pendingBackup=reply.preview.added?backup:null;
  $('restore-preview').textContent=`共 ${reply.preview.total} 条，可补入 ${reply.preview.added} 条，已有 ${reply.preview.existing} 条（内容不同 ${reply.preview.conflicts} 条，均保留现有版本）。不修改原表进度和设置。`;
  $('restore-confirm').disabled=working || !reply.preview.added;
});
$('restore-confirm').onclick=()=>action(async()=>{
  if(!pendingBackup || !confirm('仅补入缺失的插件归档？已有记录不会覆盖；不会恢复客户原表进度。'))return;
  const reply=await call('PW_RESTORE_COMMIT',{backup:pendingBackup});pendingBackup=null;$('restore-confirm').disabled=true;
  $('restore-preview').textContent=`已补入 ${reply.restored.added} 条；跳过已有 ${reply.restored.existing} 条。`;await updateArchive();
});
$('export-records').onclick=()=>action(()=>exportArchive());
$('export-current').onclick=()=>action(()=>exportArchive(true));
$('refresh').onclick=()=>action(context);
$('analyze').onclick=()=>action(()=>call('PW_START',{continuous:false}));
$('reanalyze').onclick=()=>action(()=>call('PW_START',{continuous:false,force:true}));
$('continuous').onclick=()=>action(async()=>{
  if(!confirm('开始本批连续评价？三张完整图片会发送给千问；证据充分时会通过原表按钮填入并自动换题。按设置的每批数量运行，25%进度不再强制暂停；疑难或异常仍会暂停。'))return;
  await call('PW_START',{continuous:true});
});
$('stop').onclick=()=>action(()=>call('PW_STOP'));
$('apply').onclick=()=>action(async()=>{if(confirm('确认翻译、渲染两项建议并填入原表？原表保存后会自动切到下一项。'))await call('PW_APPLY');});
$('settings-form').onsubmit=event=>{event.preventDefault();action(async()=>{
  await call('PW_SAVE_SETTINGS',{settings:{apiKey:$('api-key').value,model:$('model').value.trim(),endpoint:$('endpoint').value.trim(),effort:$('effort').value,batchLimit:Number($('batch-limit').value),confidenceThreshold:Number($('threshold').value),commentMode:$('comment-mode').value}});
  $('api-key').value='';await readSettings();notice('设置已保存。');
});};
$('test-api').onclick=()=>action(async()=>{notice('正在测试千问接口…');const reply=await call('PW_TEST_API');notice(reply.message);});
chrome.runtime.onMessage.addListener((message,sender)=>{if(sender.id===chrome.runtime.id && sender.tab?.id===tabId && message.type==='PW_PAGE_CHANGED'){invalidateSuggestion();status('页面发生变化，正在核对当前题目…');void poll();}});
chrome.tabs.onActivated.addListener(()=>{invalidateSuggestion();context().catch(error=>status(error.message));});
chrome.tabs.onUpdated.addListener((id,change)=>{if(id===tabId && change.status==='complete')context().catch(error=>status(error.message));});
await readSettings();await context();await updateArchive();setInterval(poll,1500);
