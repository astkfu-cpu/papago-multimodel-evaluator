(() => {
  if (globalThis.__papagoPairwiseAdapter) return;
  globalThis.__papagoPairwiseAdapter=true;
  let cachedText='', tasks;
  const choices=['A','tie','B'];
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function pageSnapshot() {
    if (location.protocol!=='file:' || !/\/index\.html$/i.test(location.pathname)) throw new Error('请打开离线任务包中的 index.html');
    const text=document.getElementById('tasks')?.textContent;
    if (!text || !document.querySelector('#judge .choice')) throw new Error('此页面不是支持的成对评估表');
    if (text!==cachedText) { tasks=JSON.parse(text); cachedText=text; }
    if (tasks.schema!=='iimt_pairwise_tasks/v1' || tasks.kind!=='image' || tasks.domain!=='Userlog') throw new Error('只支持 Userlog 图片成对评估表');
    if (document.querySelector('dialog[open]')) throw new Error('请先完成或关闭页面上的对话框');
    if (!document.getElementById('banner')?.hidden) throw new Error('原表自动保存不可用，请在正常窗口恢复保存后继续');
    const evaluator=document.getElementById('evaluator-id')?.textContent.trim();
    if (!evaluator || evaluator==='-' || /\s/.test(evaluator)) throw new Error('请先在原表填写正确的评估员 ID');
    const scope=document.getElementById('scope-text')?.textContent.trim().split('·').map(x=>x.trim());
    if (!scope?.length || scope.some(x=>!['EN_JA','JA_EN','EN_ZH-CN','ZH-CN_EN','JA_ZH-CN','ZH-CN_JA'].includes(x))) throw new Error('请保持任务包分配的中英日语言对');
    // Distribution packages declare their fixed assignment as a literal MINE array.
    // Parse that data only; never execute page code or guess assignments from image names.
    const assignmentText=[...document.scripts].map(el=>el.textContent).map(text=>text.match(/\bvar\s+MINE\s*=\s*(\[[^\]]*\])/)).find(Boolean)?.[1];
    if(assignmentText) {
      const assignedPairs=JSON.parse(assignmentText);
      if(JSON.stringify([...scope].sort())!==JSON.stringify([...assignedPairs].sort())) throw new Error('任务包预选语言对已被取消或改变，请恢复原来的全部分配后继续');
    }
    const assigned=tasks.pairs.filter(p=>scope.includes(p.langpair));
    const meta=document.getElementById('pair-meta')?.textContent.match(/^([\w-]+)\s*·\s*(\d+)\s*\/\s*(\d+)\s*$/);
    if (!meta || Number(meta[3])!==assigned.length) throw new Error('无法核实当前题号与分配范围');
    const pair=assigned[Number(meta[2])-1];
    if (!pair || pair.langpair!==meta[1]) throw new Error('题号与翻译方向不一致');
    const images=['src','a','b'].map(side=>{
      const img=document.querySelector(`#${side}-body img`);
      const url=new URL(pair[side],location.href);
      const base=new URL('.',location.href).href;
      if (url.protocol!=='file:' || !url.href.startsWith(base) || !/^(src|sys)\//.test(pair[side])) throw new Error('图片路径超出当前任务包');
      if (!img?.complete || !img.naturalWidth || !img.naturalHeight) throw new Error(`${side} 完整图片尚未加载，暂不评价`);
      if (new URL(img.currentSrc || img.src).href!==url.href) throw new Error('页面图片尚未完成换题，暂不评价');
      const rotation=Number(img.style.transform.match(/rotate\((\d+)deg\)/)?.[1] || 0);
      return {side,url:url.href,width:img.naturalWidth,height:img.naturalHeight,rotation};
    });
    let saved;
    try { saved=JSON.parse(localStorage.getItem('sheetjudge:'+tasks.sheet_id) || '{}'); }
    catch { throw new Error('无法读取原表自动保存状态'); }
    if (saved.evaluator!==evaluator || JSON.stringify(saved.langpairs)!==JSON.stringify(scope)) throw new Error('原表身份或范围尚未保存');
    const valid=j=>choices.includes(j?.translation) && choices.includes(j?.rendering);
    const judgments=saved.judgments || {};
    const progress=assigned.filter(p=>valid(judgments[p.id])).length;
    const partial=Boolean(judgments[pair.id]?.translation || judgments[pair.id]?.rendering);
    const key=JSON.stringify([location.href,tasks.sheet_id,evaluator,scope,pair.id,pair.langpair,images]);
    return {key,sheetId:tasks.sheet_id,evaluator,scope,languagePair:pair.langpair,pairId:pair.id,index:Number(meta[2]),total:assigned.length,done:progress,complete:valid(judgments[pair.id]),partial,images,url:location.href};
  }
  async function stableSnapshot() {
    const first=pageSnapshot(); await pause(450);
    const second=pageSnapshot();
    if (first.key!==second.key) throw new Error('图片或题号正在变化，请等页面稳定');
    return second;
  }
  function verifySaved(snapshot, result) {
    let data;
    try {data=JSON.parse(localStorage.getItem('sheetjudge:'+snapshot.sheetId) || '{}');} catch {throw new Error('原表保存内容不可读取');}
    const j=data.judgments?.[snapshot.pairId];
    if (data.evaluator!==snapshot.evaluator || JSON.stringify(data.langpairs)!==JSON.stringify(snapshot.scope) ||
        j?.translation!==result.translation || j?.rendering!==result.rendering || !document.getElementById('banner')?.hidden) {
      throw new Error('原表没有成功保存两项判断，已暂停；请人工核对');
    }
  }
  async function applyResult(message) {
    const snapshot=await stableSnapshot();
    if (snapshot.key!==message.snapshotKey) throw new Error('当前图片、方向或身份已变化，旧建议不能填入');
    if (snapshot.complete || snapshot.partial) throw new Error('当前项已有判断，插件不会覆盖已有进度');
    const result=message.result;
    if (!choices.includes(result?.translation) || !choices.includes(result?.rendering)) throw new Error('两项结果不完整，不能填入');
    const t=document.querySelector(`.choice[data-dim="translation"][data-value="${result.translation}"]`);
    const r=document.querySelector(`.choice[data-dim="rendering"][data-value="${result.rendering}"]`);
    if (!t || !r || t.disabled || r.disabled) throw new Error('原表判断按钮不可用');
    if (message.commentMode==='zh') {
      const comment=document.getElementById('comment');
      if (comment.value.trim()) throw new Error('当前项已有评论，插件不会覆盖');
      comment.value=`翻译：${result.translation_reason} 渲染：${result.rendering_reason}`.slice(0,1000);
      comment.dispatchEvent(new Event('input',{bubbles:true}));
    }
    // Use the sheet's own handlers and autosave. Never mutate its result store.
    if (pageSnapshot().key!==snapshot.key) throw new Error('填入前页面已换题');
    t.click();
    if (!t.classList.contains('selected')) throw new Error('第一项未成功填入，已暂停');
    r.click();
    verifySaved(snapshot,result);
    return {applied:true,pairId:snapshot.pairId};
  }
  function advancePastCompleted(message) {
    const current=pageSnapshot();
    if (message.snapshotKey!==current.key || !current.complete) throw new Error('不能跳过未完成或已变化的项目');
    document.getElementById('next').click(); return {advanced:true};
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if (sender.id!==chrome.runtime.id || !message?.type?.startsWith('PW_PAGE_')) return;
    Promise.resolve().then(()=>{
      if (message.type==='PW_PAGE_IDENTITY') {
        const el=document.getElementById('tasks');
        if (!el) return null;
        const data=JSON.parse(el.textContent);
        return data.schema==='iimt_pairwise_tasks/v1' ? {sheetId:data.sheet_id} : null;
      }
      if (message.type==='PW_PAGE_SNAPSHOT') return stableSnapshot();
      if (message.type==='PW_PAGE_APPLY') return applyResult(message);
      if (message.type==='PW_PAGE_ADVANCE') return advancePastCompleted(message);
      throw new Error('未知页面指令');
    }).then(value=>respond({ok:true,value}),error=>respond({ok:false,error:error.message}));
    return true;
  });
  // Notify the panel when navigation, identity, loading or rotation changes.
  let lastSignature='',changeTimer;
  function pageChanged(){
    let signature;try{const s=pageSnapshot();signature=JSON.stringify([s.key,s.complete,s.partial]);}catch(error){signature='invalid:'+error.message;}
    if(signature===lastSignature)return;lastSignature=signature;
    chrome.runtime.sendMessage({type:'PW_PAGE_CHANGED'}).catch(()=>{});
  }
  new MutationObserver(()=>{clearTimeout(changeTimer);changeTimer=setTimeout(pageChanged,0);}).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['src','style','hidden','open','class']});
  document.addEventListener('load',pageChanged,true);pageChanged();
})();
