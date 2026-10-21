import { canAutoApply, settingsOf } from './shared.js';
const $=id=>document.getElementById(id);
let tabId=null,config,working=false,lastState,archiveUpdate='';
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
function showState(state) {
  lastState=state;status(state.message || '尚未开始');working=Boolean(state.running);
  for(const id of ['analyze','continuous','reanalyze','test-api'])$(id).disabled=working;
  $('stop').disabled=!working;
  $('settings-form').querySelectorAll('input,select,button').forEach(el=>el.disabled=working);
  $('checkpoint').hidden=state.phase!=='checkpoint';
  const result=state.result;$('result-section').hidden=!result;
  $('apply').disabled=working || !['ready','review'].includes(state.phase) || !canAutoApply(result,config);
  if(!result)return;
  const names={A:'A 胜',tie:'平局',B:'B 胜'};
  $('translation').textContent=names[result.translation] || '待人工判断';$('rendering').textContent=names[result.rendering] || '待人工判断';
  $('translation-reason').textContent=result.translation_reason;$('rendering-reason').textContent=result.rendering_reason;
  $('confidence').textContent=`证据置信度 ${Math.round(result.confidence*100)}%${result.cached?' · 缓存':''}`;
  $('review-note').hidden=canAutoApply(result,config);
  $('review-note').textContent=result.review_reason || '证据置信度低于阈值。请在原表人工判断，或重新分析。';
  $('source-summary').textContent='原图：'+result.source_summary;$('a-evidence').textContent='A：'+result.a_evidence;$('b-evidence').textContent='B：'+result.b_evidence;
  $('image-info').textContent=(result.imageInfo || []).map(x=>`${x.label}: 原始 ${x.originalWidth}×${x.originalHeight}，完整送评 ${x.width}×${x.height}`).join('\n')+(result.refined?'\n已结合完整图片和覆盖整图的放大分块复核。':'');
  if(state.snapshot)$('context').textContent=`${state.snapshot.evaluator} · ${state.snapshot.languagePair.replace('_',' → ')}\n当前第 ${state.snapshot.index}/${state.snapshot.total} 项 · 已完成 ${state.snapshot.done}/${state.snapshot.total}`;
}
async function poll() {
  if(!Number.isInteger(tabId) || !config)return;
  try {
    const state=(await call('PW_STATUS')).status;showState(state);
    if(archiveUpdate!==state.updatedAt){archiveUpdate=state.updatedAt;await updateArchive();}
  } catch(error){notice(error.message);}
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
async function exportArchive(current=false) {
  const filter=current?(await call('PW_CONTEXT')).snapshot:null;
  const reply=await call('PW_EXPORT_ARCHIVE',{filter:filter?{sheetId:filter.sheetId,evaluator:filter.evaluator}:null});
  const url=URL.createObjectURL(new Blob([reply.html],{type:'text/html;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;
  const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  link.download=`Papago成对评价_插件离线记录_${date}_${current?'当前任务':'全部'}.html`;
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  notice('离线报告已导出。它包含两项理由和保存状态；正式提交请另用原表导出。');
}
$('export-records').onclick=()=>action(()=>exportArchive());
$('export-current').onclick=()=>action(()=>exportArchive(true));
$('refresh').onclick=()=>action(context);
$('analyze').onclick=()=>action(()=>call('PW_START',{continuous:false}));
$('reanalyze').onclick=()=>action(()=>call('PW_START',{continuous:false,force:true}));
$('continuous').onclick=()=>action(async()=>{
  if(!confirm('开始本批连续评价？三张完整图片会发送给千问；证据充分时会通过原表按钮填入并自动换题。遇到疑难或约25%进度会暂停。'))return;
  await call('PW_START',{continuous:true});
});
$('stop').onclick=()=>action(()=>call('PW_STOP'));
$('apply').onclick=()=>action(async()=>{if(confirm('确认翻译、渲染两项建议并填入原表？原表保存后会自动切到下一项。'))await call('PW_APPLY');});
$('checkpoint').onclick=()=>action(async()=>{
  if(confirm('确认已通过原表导出并收到任务方阶段性反馈？确认后仅解除阶段性暂停，需要另行点击开始连续评价。'))await call('PW_ACK_CHECKPOINT');
});
$('settings-form').onsubmit=event=>{event.preventDefault();action(async()=>{
  await call('PW_SAVE_SETTINGS',{settings:{apiKey:$('api-key').value,model:$('model').value.trim(),endpoint:$('endpoint').value.trim(),effort:$('effort').value,batchLimit:Number($('batch-limit').value),confidenceThreshold:Number($('threshold').value),commentMode:$('comment-mode').value}});
  $('api-key').value='';await readSettings();notice('设置已保存。');
});};
$('test-api').onclick=()=>action(async()=>{notice('正在测试千问接口…');const reply=await call('PW_TEST_API');notice(reply.message);});
chrome.tabs.onActivated.addListener(()=>context().catch(error=>status(error.message)));
chrome.tabs.onUpdated.addListener((id,change)=>{if(id===tabId && change.status==='complete')context().catch(error=>status(error.message));});
await readSettings();await context();await updateArchive();setInterval(poll,1500);
