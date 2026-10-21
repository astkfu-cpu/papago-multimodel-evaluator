import { RULE_VERSION, DEFAULTS, settingsOf, buildRequest, parseResult, canAutoApply, checkpointReached, isTransient } from './shared.js';
import {saveRecord,archiveInfo,records,offlineReport} from './archive.js';

let activeJob=null;
const statusWrites=new Map();
const STATUS_KEY=id=>`pw-status:${id}`;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});

async function settings() { return settingsOf((await chrome.storage.local.get('settings')).settings); }
async function savedStatus(tabId) {
  const key=STATUS_KEY(tabId); const state=(await chrome.storage.session.get(key))[key] || {phase:'idle',message:'先保存千问设置，再分析当前张。'};
  if (state.running && activeJob?.tabId!==tabId) {
    state.running=false; state.phase='paused'; state.message='后台任务中断，未自动重启。请核对原表进度后重新开始。';
    return setStatus(tabId,state);
  }
  return state;
}
function setStatus(tabId, values) {
  const previous=statusWrites.get(tabId) || Promise.resolve();
  const operation=previous.catch(()=>{}).then(async()=>{
    const key=STATUS_KEY(tabId); const old=(await chrome.storage.session.get(key))[key] || {};
    const next={...old,...values,updatedAt:new Date().toISOString()};
    await chrome.storage.session.set({[key]:next}); return next;
  });
  statusWrites.set(tabId,operation);
  const cleanup=()=>{if(statusWrites.get(tabId)===operation)statusWrites.delete(tabId);};
  operation.then(cleanup,cleanup);return operation;
}
async function pageCall(tabId,type,extra={}) {
  let reply;
  try {reply=await chrome.tabs.sendMessage(tabId,{type,...extra});}
  catch {throw new Error('无法连接离线表。请允许扩展访问文件网址，并刷新 index.html。');}
  if (!reply?.ok) throw new Error(reply?.error || '页面适配器未就绪');
  return reply.value;
}
function binding(s) {return JSON.stringify([s.url,s.sheetId,s.evaluator,s.scope,s.total]);}
function checkpointKey(s) {return 'checkpoint:'+binding(s);}
async function checkpointAcknowledged(s) {return Boolean((await chrome.storage.local.get(checkpointKey(s)))[checkpointKey(s)]);}
async function assertSingleSheet(tabId,snapshot) {
  const tabs=await chrome.tabs.query({url:'file:///*'});
  for (const tab of tabs) {
    if (tab.id===tabId || !/\/index\.html(?:[?#]|$)/i.test(tab.url || '')) continue;
    if (tab.url===snapshot.url) throw new Error('同一评估表已在另一个标签页/窗口打开，请关闭重复页面');
    try {
      const reply=await chrome.tabs.sendMessage(tab.id,{type:'PW_PAGE_IDENTITY'});
      if (reply?.value?.sheetId===snapshot.sheetId) throw new Error('同一评估表已多开，请关闭重复页面后继续');
    } catch (error) {if (error.message.includes('多开')) throw error;}
  }
}
async function guard(tabId,s,expected=null) {
  const tab=await chrome.tabs.get(tabId);
  if (tab.incognito) throw new Error('请使用正常窗口，隐私窗口不能可靠保存进度');
  if (tab.url!==s.url) throw new Error('任务页面地址已变化');
  if (expected && binding(s)!==expected) throw new Error('评估员、任务包或语言分配已变化，已暂停');
  await assertSingleSheet(tabId,s);
}
function alive(job) {if (activeJob!==job || job.controller.signal.aborted) throw new Error('已停止');}

async function blobData(blob) {
  const bytes=new Uint8Array(await blob.arrayBuffer()); let binary='';
  for(let i=0;i<bytes.length;i+=16384) binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}
async function encodedCanvas(bitmap, rotation=0, crop=null) {
  const source=crop || [0,0,bitmap.width,bitmap.height];
  const quarter=rotation%180!==0;
  const w=quarter?source[3]:source[2], h=quarter?source[2]:source[3];
  const factor=Math.min(1,4096/Math.max(w,h));
  const canvas=new OffscreenCanvas(Math.max(1,Math.round(w*factor)),Math.max(1,Math.round(h*factor)));
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(rotation*Math.PI/180);
  ctx.drawImage(bitmap,...source,-source[2]*factor/2,-source[3]*factor/2,source[2]*factor,source[3]*factor);
  return {data:await blobData(await canvas.convertToBlob({type:'image/jpeg',quality:0.96})),width:canvas.width,height:canvas.height};
}
async function fullImages(snapshot,job) {
  const images=[];
  for (const item of snapshot.images) {
    alive(job);
    let response;
    try {response=await fetch(item.url,{signal:job.controller.signal,cache:'no-store'});}
    catch {alive(job);throw new Error('无法读取完整本地图片。请在扩展详情开启“允许访问文件 URL”；不会改用不完整页面截图。');}
    if (!response.ok) throw new Error('完整图片读取失败，未进行模型评价');
    const blob=await response.blob();
    if (!blob.size || blob.size>50*1024*1024) throw new Error('图片为空或过大，需要人工检查');
    const bitmap=await createImageBitmap(blob);
    try {
      if (bitmap.width!==item.width || bitmap.height!==item.height) throw new Error('后台图片尺寸与页面资源不一致，未评价');
      const preserveOriginal=!item.rotation && Math.max(bitmap.width,bitmap.height)<=4096 && blob.size<=14*1024*1024 && /^image\/(jpeg|png|webp)$/.test(blob.type);
      const encoded=preserveOriginal?{data:await blobData(blob),width:bitmap.width,height:bitmap.height}:await encodedCanvas(bitmap,item.rotation);
      images.push({...encoded,label:({src:'Source',a:'A',b:'B'})[item.side]+' COMPLETE IMAGE',originalWidth:bitmap.width,originalHeight:bitmap.height,originalBlob:blob,rotation:item.rotation});
    } finally {bitmap.close();}
  }
  return images;
}
async function enlargedSections(images) {
  const sections=[];
  for (const image of images) {
    const blob=image.originalBlob || await (await fetch(image.data)).blob();
    let bmp=await createImageBitmap(blob);
    try {
      // Magnified sections use native pixels, rather than recropping a downscaled full image.
      if(image.rotation) {
        const quarter=image.rotation%180!==0;
        const canvas=new OffscreenCanvas(quarter?bmp.height:bmp.width,quarter?bmp.width:bmp.height);
        const ctx=canvas.getContext('2d');ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(image.rotation*Math.PI/180);ctx.drawImage(bmp,-bmp.width/2,-bmp.height/2);
        const rotated=await createImageBitmap(canvas);bmp.close();bmp=rotated;
      }
      const w=Math.ceil(bmp.width*0.56),h=Math.ceil(bmp.height*0.56);
      for(const [x,y] of [[0,0],[bmp.width-w,0],[0,bmp.height-h],[bmp.width-w,bmp.height-h]]) {
        sections.push({...await encodedCanvas(bmp,0,[x,y,w,h]),label:`${image.label.replace(' COMPLETE IMAGE','')} supplementary overlapping section x=${x}/${bmp.width}, y=${y}/${bmp.height}. Evaluate the WHOLE IMAGE.`});
      }
    } finally {bmp.close();}
  }
  return [...images,...sections];
}
async function digest(value) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function formatError(message,key) {return String(message).replaceAll(key || '\0','[redacted]').replace(/data:image\/[^\s]+/g,'[image]').slice(0,600);}
async function oneRequest(config,body,job) {
  const controller=new AbortController();
  const abort=()=>controller.abort(); job.controller.signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(),200000);
  try {
    let response;
    try {response=await fetch(config.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`},body:JSON.stringify(body),signal:controller.signal,redirect:'error'});}
    catch (error) {alive(job);const e=new Error(controller.signal.aborted?'千问请求超时，未填入判断':'千问网络连接失败，未填入判断');e.transient=true;throw e;}
    const requestId=response.headers.get('x-request-id') || response.headers.get('request-id') || '';
    if (!response.ok) {
      let payload;try {payload=await response.json();} catch {}
      const error=new Error(`千问 HTTP ${response.status} ${formatError(payload?.error?.message || payload?.message || response.statusText,config.apiKey)}${requestId?' · request_id='+requestId:''}`);
      error.transient=isTransient(response.status); throw error;
    }
    let text='',finish='';
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const reader=response.body.getReader(); const decoder=new TextDecoder();let buffer='';
      const consume=line=>{
        if (!line.startsWith('data:')) return;
        const raw=line.slice(5).trim();if (!raw || raw==='[DONE]') return;
        const chunk=JSON.parse(raw);
        if (chunk.error) throw new Error(formatError(chunk.error.message || '千问流式响应错误',config.apiKey));
        const choice=chunk.choices?.[0];
        if (typeof choice?.delta?.content==='string') text+=choice.delta.content;
        if (choice?.finish_reason) finish=choice.finish_reason;
        if(text.length>120000) throw new Error('模型正文超长，停止接收');
      };
      for(;;) {
        alive(job);
        const {value,done}=await reader.read();
        buffer+=decoder.decode(value || new Uint8Array(),{stream:!done});
        const lines=buffer.split('\n');buffer=lines.pop();
        for(const line of lines)consume(line.replace(/\r$/,''));
        if(done) {if(buffer.trim())consume(buffer);break;}
      }
    } else {
      const payload=await response.json(); const choice=payload.choices?.[0];text=choice?.message?.content || '';finish=choice?.finish_reason;
    }
    if(finish==='length' || !text || finish!=='stop') {const error=new Error('模型输出不完整或被截断，不能转成评价结果');error.format=true;throw error;}
    let result;
    try {result=parseResult(text);} catch(error) {error.format=true;throw error;}
    return {...result,requestId};
  } finally {clearTimeout(timer);job.controller.signal.removeEventListener('abort',abort);}
}
async function request(config,body,job) {
  for(let attempt=0;;attempt++) {
    alive(job);
    try{return await oneRequest(config,body,job);}
    catch(error) {
      alive(job);
      if (!error.transient || attempt>=2) throw error;
      await setStatus(job.tabId,{message:`千问暂时故障，第 ${attempt+1}/2 次重试；原表尚未填入。`});
      await pause((attempt+1)*2500+Math.random()*700);
    }
  }
}
async function evaluate(snapshot,config,job) {
  await setStatus(job.tabId,{phase:'analyzing',message:`正在后台读取第 ${snapshot.index}/${snapshot.total} 项的三张完整图片。`,snapshot,result:null});
  const images=await fullImages(snapshot,job);alive(job);
  const hashes=await Promise.all(images.map(x=>digest(x.data)));
  const cacheKey=await digest([RULE_VERSION,binding(snapshot),snapshot.pairId,snapshot.languagePair,hashes,config.model,config.endpoint,config.effort]);
  const cached=(await chrome.storage.local.get('cache')).cache || [];
  const hit=!job.force && cached.find(x=>x.key===cacheKey && canAutoApply(x.result,config));
  let result=hit?.result;
  if(!result) {
    await setStatus(job.tabId,{message:'千问正在比较完整原图、A 图和 B 图；蓝色应用工具栏不参与优劣判断。'});
    try {result=await request(config,buildRequest(config,snapshot.languagePair,images),job);}
    catch(error) {if(!error.format)throw error;result=null;}
    if (!result || !canAutoApply(result,config)) {
      alive(job);
      await setStatus(job.tabId,{message:'正在复核整图与覆盖全图的放大分块，未向原表填入任何判断。'});
      result=await request(config,buildRequest(config,snapshot.languagePair,await enlargedSections(images),true),job);
      result.refined=true;
    }
    alive(job);
    if(canAutoApply(result,config)) await chrome.storage.local.set({cache:[{key:cacheKey,result},...cached.filter(x=>x.key!==cacheKey)].slice(0,40)});
  }
  alive(job);
  const fresh=await pageCall(job.tabId,'PW_PAGE_SNAPSHOT');
  if (fresh.key!==snapshot.key) throw new Error('分析期间页面已换题、旋转图片或改变分配，结果不会填入');
  await guard(job.tabId,fresh,job.bound);alive(job);
  return {...result,cached:Boolean(hit),model:config.model,imageInfo:images.map(x=>({label:x.label,width:x.width,height:x.height,originalWidth:x.originalWidth,originalHeight:x.originalHeight})),ruleVersion:RULE_VERSION};
}
async function archive(snapshot,result,applied=false) {
  result.archiveId=await saveRecord(snapshot,result,applied);
}
async function waitNext(job,old) {
  const end=Date.now()+20000;
  while(Date.now()<end) {
    alive(job);await pause(650);
    let next;try{next=await pageCall(job.tabId,'PW_PAGE_SNAPSHOT');}catch {continue;}
    if(next.done===next.total || next.key!==old.key) return next;
  }
  throw new Error('原表已保存但未确认三张图片切到下一项，已暂停；不会重复填入');
}
async function perform(job,config) {
  try {
    let current=await pageCall(job.tabId,'PW_PAGE_SNAPSHOT');job.bound=binding(current);
    await guard(job.tabId,current);alive(job);
    let applied=0,skipped=0;
    for(;;) {
      alive(job);
      await guard(job.tabId,current,job.bound);alive(job);
      if(job.continuous) {
        if(current.done>=current.total) {await setStatus(job.tabId,{phase:'done',message:'分配范围已全部完成。请使用原表导出最终结果。',snapshot:current});break;}
        if(checkpointReached(current.done,current.total,await checkpointAcknowledged(current))) {
          await setStatus(job.tabId,{phase:'checkpoint',message:`已达到约 25% 阶段性节点（${current.done}/${current.total}）。请使用原表导出，交任务方检查并取得反馈后再继续。`,snapshot:current});break;
        }
        if(current.complete) {
          if(++skipped>current.total) throw new Error('未找到可评价的新项，已停止');
          await pageCall(job.tabId,'PW_PAGE_ADVANCE',{snapshotKey:current.key});
          current=await waitNext(job,current);continue;
        }
        if(current.partial) throw new Error('当前项已有一项人工判断，已暂停，避免覆盖');
      }
      const result=await evaluate(current,config,job);alive(job);
      await archive(current,result);
      if(!job.continuous || !canAutoApply(result,config)) {
        await setStatus(job.tabId,{phase:canAutoApply(result,config)?'ready':'review',message:job.continuous?'证据或置信度不足，连续评价已暂停，原表未填入。':'分析完成。请核对两项建议和依据后确认填入。',result,snapshot:current,batchDone:applied});break;
      }
      const fresh=await pageCall(job.tabId,'PW_PAGE_SNAPSHOT');
      if(fresh.key!==current.key || fresh.complete || fresh.partial) throw new Error('填入前项目或已有判断变化，已暂停');
      await guard(job.tabId,fresh,job.bound);alive(job);
      await setStatus(job.tabId,{phase:'applying',message:'正在通过原表按钮保存两项判断。',result,snapshot:current});alive(job);
      await pageCall(job.tabId,'PW_PAGE_APPLY',{snapshotKey:current.key,result,commentMode:config.commentMode});
      job.sheetSaved=true;applied++;await archive(current,result,true);job.sheetSaved=false;
      await setStatus(job.tabId,{batchDone:applied,message:`本批已保存 ${applied} 项，正在核实下一项完整图片。`});
      current=await waitNext(job,current);alive(job);
      if(current.done>=current.total) {await setStatus(job.tabId,{phase:'done',message:'分配范围已完成，请用原表导出最终结果。',snapshot:current});break;}
      if(checkpointReached(current.done,current.total,await checkpointAcknowledged(current))) {
        await setStatus(job.tabId,{phase:'checkpoint',message:`已达到约 25% 阶段性节点（${current.done}/${current.total}）。请用原表导出并取得任务方反馈。`,snapshot:current});break;
      }
      if(applied>=config.batchLimit) {await setStatus(job.tabId,{phase:'paused',message:`本批 ${applied} 项已保存，请抽查后继续。`,snapshot:current});break;}
      await pause(config.delayMs);
    }
  } catch(error) {
    await setStatus(job.tabId,{phase:'paused',message:(job.sheetSaved?'本张两项已由原表保存，但归档更新失败；请核对并导出。':'')+formatError(error.message,config.apiKey),result:null});
  } finally {
    clearInterval(job.heartbeat);await chrome.alarms.clear('pw-active');
    await setStatus(job.tabId,{running:false});
    if(activeJob===job)activeJob=null;
  }
}
async function start(tabId,continuous,force=false) {
  if(activeJob)throw new Error('已有一个任务在运行，请先停止。原表禁止多开并行。');
  const config=await settings();if(!config.apiKey)throw new Error('请先保存千问百炼 API Key');
  if(activeJob)throw new Error('已有一个任务正在启动，请勿重复点击');
  const job={tabId,continuous,force,controller:new AbortController()};activeJob=job;
  await setStatus(tabId,{phase:'starting',running:true,message:'正在核对原表、完整图片和自动保存。',batchDone:0,result:null});
  job.heartbeat=setInterval(()=>chrome.runtime.getPlatformInfo().catch(()=>{}),20000);
  await chrome.alarms.create('pw-active',{periodInMinutes:0.5});
  void perform(job,config);return {started:true};
}
async function manualApply(tabId) {
  if(activeJob)throw new Error('请先停止正在运行的分析');
  const state=await savedStatus(tabId), config=await settings();
  if(!['ready','review'].includes(state.phase) || !state.result || !state.snapshot)throw new Error('请先分析当前张');
  if(!canAutoApply(state.result,config))throw new Error('此结果仍需复核，请在原表人工判断，或重新分析；不会用平局兜底');
  const fresh=await pageCall(tabId,'PW_PAGE_SNAPSHOT');
  if(fresh.key!==state.snapshot.key)throw new Error('当前项已变化，旧建议不能填入');
  await guard(tabId,fresh);
  await pageCall(tabId,'PW_PAGE_APPLY',{snapshotKey:fresh.key,result:state.result,commentMode:config.commentMode});
  try {await archive(fresh,state.result,true);}
  catch(error) {await setStatus(tabId,{phase:'paused',result:null,message:'两项已由原表保存，但长期归档更新失败，请核对并导出。'+error.message});throw error;}
  await setStatus(tabId,{phase:'applied',result:null,message:'两项判断已由原表保存。请使用原表导出结果。'});
  return {applied:true};
}
chrome.alarms.onAlarm.addListener(async alarm=>{
  if(alarm.name!=='pw-active')return;
  if(activeJob) {await chrome.runtime.getPlatformInfo();return;}
  const all=await chrome.storage.session.get(null);
  for(const [key,state] of Object.entries(all))if(key.startsWith('pw-status:') && state.running)await savedStatus(Number(key.split(':')[1]));
  await chrome.alarms.clear('pw-active');
});
chrome.tabs.onRemoved.addListener(tabId=>{if(activeJob?.tabId===tabId)activeJob.controller.abort();});

async function dispatch(message) {
  switch(message.type) {
    case 'PW_SETTINGS': {const s=await settings();return {settings:{...s,apiKey:undefined},hasKey:Boolean(s.apiKey),version:chrome.runtime.getManifest().version};}
    case 'PW_SAVE_SETTINGS': {
      if(activeJob)throw new Error('任务运行时不能更换设置');
      const old=await settings();const next=settingsOf({...old,...message.settings,apiKey:message.settings.apiKey?.trim() || old.apiKey});
      await chrome.storage.local.set({settings:next});return {saved:true};
    }
    case 'PW_STATUS':return {status:await savedStatus(message.tabId)};
    case 'PW_ARCHIVE_INFO':return archiveInfo();
    case 'PW_EXPORT_ARCHIVE':return {html:offlineReport(await records(message.filter || null))};
    case 'PW_CONTEXT':return {snapshot:await pageCall(message.tabId,'PW_PAGE_SNAPSHOT')};
    case 'PW_START':return start(message.tabId,Boolean(message.continuous),Boolean(message.force));
    case 'PW_STOP':
      if(activeJob?.tabId===message.tabId) {activeJob.controller.abort();await setStatus(message.tabId,{message:'正在停止；当前原表保存若已触发，请核对进度。'});}
      else await setStatus(message.tabId,{running:false,phase:'paused',message:'已停止'});
      return {stopped:true};
    case 'PW_APPLY':return manualApply(message.tabId);
    case 'PW_ACK_CHECKPOINT': {
      if(activeJob)throw new Error('请先停止任务');
      const current=await pageCall(message.tabId,'PW_PAGE_SNAPSHOT');
      if(current.done<Math.ceil(current.total*0.25))throw new Error('尚未达到阶段性节点');
      await chrome.storage.local.set({[checkpointKey(current)]:true});
      await setStatus(message.tabId,{phase:'paused',message:'已记录你确认收到阶段性反馈，可重新开始连续评价。'});return {acknowledged:true};
    }
    case 'PW_TEST_API': {
      if(activeJob)throw new Error('任务运行时不能测试接口');
      const config=await settings();if(!config.apiKey)throw new Error('请先保存 API Key');
      const job={controller:new AbortController()};activeJob=job;
      try {
        const response=await fetch(config.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`},body:JSON.stringify({model:config.model,messages:[{role:'user',content:'Reply only OK.'}],stream:false,...(config.model.startsWith('qwen3.8')?{reasoning_effort:'none',max_completion_tokens:32}:{enable_thinking:false,max_tokens:32})}),signal:AbortSignal.timeout(20000),redirect:'error'});
        if(!response.ok)throw new Error(`千问连通性测试 HTTP ${response.status}`);
        const data=await response.json();if(!data.choices?.[0]?.message?.content)throw new Error('千问未返回正文');
        return {message:`${data.model || config.model} 文本连通成功。视觉效果需单张实际分析验证。`};
      }finally{activeJob=null;}
    }
    default:throw new Error('未知指令');
  }
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('')))return;
  dispatch(message).then(value=>respond({ok:true,...value}),error=>respond({ok:false,error:error.message}));
  return true;
});
