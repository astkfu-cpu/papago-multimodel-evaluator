const {chromium}=require('playwright');
const path=require('path'),fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto');
const {pathToFileURL}=require('url');
const extension=__dirname;
const work=path.resolve(__dirname,'../tmp/pairwise-development');fs.mkdirSync(work,{recursive:true});
const source=process.env.PAPAGO_PAIRWISE_PACKAGE;
if(!source)throw new Error('Set PAPAGO_PAIRWISE_PACKAGE to your authorized local test package; no customer fixtures are distributed.');
const original=fs.readFileSync(path.join(source,'index.html'),'utf8');const originalHash=crypto.createHash('sha256').update(original).digest('hex');
const dataset=JSON.parse(original.match(/<script id="tasks" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const first=dataset.pairs.find(x=>x.langpair==='EN_JA'),fixture=path.join(work,'fixture');
for(const [side,rel] of [['src','src/EN_JA/test.jpg'],['a','sys/a/EN_JA/test.jpg'],['b','sys/b/EN_JA/test.jpg']]){const dest=path.join(fixture,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(source,first[side]),dest);}
const originalSheetId=dataset.sheet_id;
dataset.sheet_id='TEST-PAPAGO-PAIRWISE-20261014';dataset.eval_id='TEST';dataset.pairs=Array.from({length:8},(_,i)=>({id:`test${String(i+1).padStart(4,'0')}`,langpair:i<4?'EN_JA':'JA_EN',page:null,src:'src/EN_JA/test.jpg',src_pdf:null,a:'sys/a/EN_JA/test.jpg',b:'sys/b/EN_JA/test.jpg'}));
const html=original.replace(/(<script id="tasks" type="application\/json">)[\s\S]*?(<\/script>)/,(_,a,b)=>a+JSON.stringify(dataset)+b).replaceAll(originalSheetId,dataset.sheet_id);
fs.writeFileSync(path.join(fixture,'index.html'),html);
const url=pathToFileURL(path.join(fixture,'index.html')).href;
const profile=fs.mkdtempSync(path.join(work,'e2e-profile-'));
const executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
(async()=>{
 const launchOptions={headless:true,executablePath:executable,ignoreDefaultArgs:['--disable-extensions'],args:['--disable-extensions-except='+extension,'--load-extension='+extension],viewport:{width:1000,height:650},acceptDownloads:true};
 let context=await chromium.launchPersistentContext(profile,launchOptions);
 let worker,dashboard,page,tabId;
 try {
  worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:20000});const id=worker.url().split('/')[2];
  if(!await worker.evaluate(()=>chrome.extension.isAllowedFileSchemeAccess())){
   const manager=await context.newPage();await manager.goto('edge://extensions/');await manager.evaluate(id=>new Promise((resolve,reject)=>chrome.developerPrivate.updateExtensionConfiguration({extensionId:id,fileAccess:true},()=>chrome.runtime.lastError?reject(new Error(chrome.runtime.lastError.message)):resolve())),id);await manager.close();
  }
  await worker.evaluate(async()=>{
   await chrome.storage.local.set({settings:{apiKey:'TEST-KEY-NEVER-REAL',model:'qwen3.8-flash',effort:'low',batchLimit:2},cache:[]});
   globalThis.mockMode='success';globalThis.apiCalls=[];globalThis.nativeFetch=fetch.bind(globalThis);
   globalThis.fetch=async(input,init)=>{
    const url=typeof input==='string'?input:input.url;
    if(!url.startsWith('https://dashscope.'))return nativeFetch(input,init);
    const body=JSON.parse(init.body),imageParts=body.messages[1]?.content?.filter(x=>x.type==='image_url') || [];
    const sizes=[],hashes=[];
    for(const part of imageParts){const blob=await (await nativeFetch(part.image_url.url)).blob();const hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());hashes.push([...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join(''));const image=await createImageBitmap(blob);sizes.push([image.width,image.height]);image.close();}
    apiCalls.push({sizes,hashes,labels:body.messages[1]?.content?.filter(x=>x.type==='text').map(x=>x.text),feedback:body.messages.length>2?body.messages.at(-1).content[0].text:'',metadataLeak:JSON.stringify(body).includes('TEST-EVALUATOR') || JSON.stringify(body).includes('sys/s')});
    if(mockMode==='401')return new Response(JSON.stringify({error:{message:'invalid API key'}}),{status:401,headers:{'content-type':'application/json'}});
    if(mockMode==='429' && apiCalls.length<3)return new Response('{}',{status:429,headers:{'content-type':'application/json'}});
    if(mockMode==='delayed')await new Promise((resolve,reject)=>{const t=setTimeout(resolve,2500);init.signal.addEventListener('abort',()=>{clearTimeout(t);reject(new Error('aborted'));},{once:true});});
    const obj={translation:'A',rendering:'B',translation_reason:'A 的价格与优惠条件更准确；测试依据。',rendering_reason:'B 的字号和布局更贴近完整原图；测试依据。',source_summary:'商品标签、优惠条件及底部完整小字。',a_evidence:'完整 A 图可见价格与条件。',b_evidence:'完整 B 图可见布局和底部小字。',a_state:'normal',b_state:'normal',confidence:0.96,needs_review:false,review_reason:''};
    if(mockMode==='uncertain'){obj.needs_review=true;obj.translation=null;obj.confidence=0.99;obj.a_state='uncertain';obj.review_reason='细字证据不足，需人工处理。';}
    if(mockMode==='format-state' && apiCalls.length<3)obj.a_state='ok';
    if((mockMode==='format-reason' && apiCalls.length===1) || mockMode==='format-persistent')delete obj.rendering_reason;
    const raw=mockMode==='format-null' && apiCalls.length===1?'null':JSON.stringify(obj);
    const chunks=mockMode==='moderated'?[{error:{message:'DataInspectionFailed: Output data may contain inappropriate content.'}}]:[{choices:[{delta:{reasoning_content:'PRIVATE TEST REASONING'},finish_reason:null}]},{choices:[{delta:{content:raw.slice(0,raw.length/2)},finish_reason:null}]},{choices:[{delta:{content:raw.slice(raw.length/2)},finish_reason:mockMode==='filtered'?'content_filter':'stop'}]}];
    const encoded=new TextEncoder().encode(chunks.map(x=>'data: '+JSON.stringify(x)+'\r\n\r\n').join('')+'data: [DONE]\n\n');
    return new Response(new ReadableStream({start(controller){for(let n=0;n<encoded.length;n+=37)controller.enqueue(encoded.slice(n,n+37));controller.close();}}),{status:200,headers:{'content-type':'text/event-stream','x-request-id':'TEST-REQUEST-ID'}});
   };
  });
  page=await context.newPage();await page.goto(url);await page.locator('#evaluator-input').fill('TEST-EVALUATOR');await page.locator('#dlg-evaluator button[value=ok]').click();
  await page.waitForFunction(()=>['src','a','b'].every(x=>document.querySelector(`#${x}-body img`)?.naturalWidth>0));
  tabId=await worker.evaluate(async url=>(await chrome.tabs.query({url}))[0].id,url);
  dashboard=await context.newPage();dashboard.on('pageerror',error=>console.log('DASHBOARD ERROR',error.message));await dashboard.setViewportSize({width:390,height:1000});
  await dashboard.addInitScript(tabId=>{if(globalThis.chrome?.tabs)chrome.tabs.query=async()=>[{id:tabId}];},tabId);
  await dashboard.goto(`chrome-extension://${id}/sidepanel.html`);
  await dashboard.waitForTimeout(1000);console.log('DASHBOARD CONTEXT',await dashboard.locator('#context').textContent());
  await dashboard.waitForFunction(()=>document.querySelector('#context')?.textContent.includes('TEST-EVALUATOR'));
  const call=(type,extra={})=>dashboard.evaluate(async payload=>chrome.runtime.sendMessage(payload),{type,tabId,...extra});
  const until=async predicate=>{const end=Date.now()+60000;while(Date.now()<end){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,200));}throw new Error('Timed out waiting for browser state');};
  const finished=async expected=>{await until(async()=>{const r=await call('PW_STATUS');return !r.status?.running && expected.includes(r.status?.phase);});return (await call('PW_STATUS')).status;};
  const data=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('sheetjudge:TEST-PAPAGO-PAIRWISE-20261014')));
  const mode=value=>worker.evaluate(value=>{mockMode=value;apiCalls=[];},value);

  // The viewport truncates these tall images. Background must still send their FULL dimensions.
  assert((await call('PW_START',{continuous:false})).ok);let state=await finished(['ready']);
  assert.equal(Object.keys((await data()).judgments).length,0);assert.equal(state.result.translation,'A');assert.equal(state.result.rendering,'B');
  assert(state.result.imageInfo.every(x=>x.originalHeight===x.height && x.height>650));
  let calls=await worker.evaluate(()=>apiCalls);assert.equal(calls.length,1);assert.equal(calls[0].sizes.length,3);assert.equal(calls[0].metadataLeak,false);
  assert.deepEqual(calls[0].hashes,['src/EN_JA/test.jpg','sys/a/EN_JA/test.jpg','sys/b/EN_JA/test.jpg'].map(rel=>crypto.createHash('sha256').update(fs.readFileSync(path.join(fixture,rel))).digest('hex')));
  assert(!JSON.stringify(state).includes('PRIVATE TEST REASONING'));assert(!(await call('PW_SETTINGS')).settings.apiKey);
  await dashboard.locator('#result-section').waitFor({state:'visible'});await dashboard.screenshot({path:path.join(work,'sidepanel-ready.png'),fullPage:true});
  console.log('PASS complete native images beyond viewport, two independent reasons, no automatic manual fill, key/engine metadata isolated');

  assert((await call('PW_APPLY')).ok);await page.waitForFunction(()=>document.querySelector('#pair-meta').textContent.includes('2 / 8'));
  assert.deepEqual([(await data()).judgments.test0001.translation,(await data()).judgments.test0001.rendering],['A','B']);
  assert.equal((await call('PW_APPLY')).ok,false);
  let archive=await call('PW_ARCHIVE_INFO');assert.equal(archive.count,1);assert.equal(archive.recent[0].applied,true);
  console.log('PASS original UI handlers persist both choices and auto-advance; one durable record updated to applied');

  assert((await call('PW_START',{continuous:true})).ok);state=await finished(['paused']);
  assert.equal(state.snapshot.done,3);assert.equal(state.batchDone,2);assert(state.message.includes('本批 2 项'));assert.equal(Object.keys((await data()).judgments).length,3);
  console.log('PASS continuous mode crosses 25% without acknowledgement and stops at configured batch size');

  const duplicate=await context.newPage();await duplicate.goto(url);await duplicate.waitForFunction(()=>document.querySelector('#src-body img')?.naturalWidth>0);
  assert((await call('PW_START',{continuous:false,force:true})).ok);state=await finished(['paused']);assert(state.message.includes('多开') || state.message.includes('另一个'));
  await duplicate.close();console.log('PASS duplicate sheet blocks analysis and filling');

  await page.locator('#scope').click();await page.locator('#langpair-list input[value="JA_EN"]').uncheck();await page.locator('#dlg-evaluator button[value=ok]').click();
  assert((await call('PW_START',{continuous:false,force:true})).ok);state=await finished(['paused']);assert(state.message.includes('预选语言对'));
  await page.locator('#scope').click();await page.locator('#langpair-list input[value="JA_EN"]').check();await page.locator('#dlg-evaluator button[value=ok]').click();
  await page.waitForFunction(()=>!document.querySelector('#dlg-evaluator').open && document.querySelector('#scope-text').textContent.includes('JA_EN'));
  await page.waitForFunction(()=>['src','a','b'].every(x=>document.querySelector(`#${x}-body img`)?.complete && document.querySelector(`#${x}-body img`)?.naturalWidth>0));
  console.log('PASS modified preselected assignment is rejected before sending images');

  await mode('401');assert((await call('PW_START',{continuous:false,force:true})).ok);state=await finished(['paused']);assert(state.message.includes('401'),state.message);assert.equal(Object.keys((await data()).judgments).length,3);assert.equal((await worker.evaluate(()=>apiCalls)).length,1);
  console.log('PASS authentication failure does not retry, fill, or become tie');

  for(const [scenario,attempts,field] of [['format-state',3,'a_state'],['format-null',2,'评价对象'],['format-reason',2,'rendering_reason']]) {
    await mode(scenario);assert((await call('PW_START',{continuous:false,force:true})).ok);state=await finished(['ready']);
    calls=await worker.evaluate(()=>apiCalls);assert.equal(calls.length,attempts);assert.equal(state.result.formatRetries,attempts-1);
    assert(calls.every(x=>x.sizes.length===3));assert(calls.slice(1).every(x=>x.feedback.includes(field)));
    assert(calls.every(x=>JSON.stringify(x.hashes)===JSON.stringify(calls[0].hashes)));
    assert.equal(Object.keys((await data()).judgments).length,3);assert(state.result.rendering_reason.length>2);
    console.log('PASS targeted full-image recovery '+scenario+' without filling or inventing missing fields');
  }
  const countBeforeFailure=(await call('PW_ARCHIVE_INFO')).count;
  await mode('format-persistent');assert((await call('PW_START',{continuous:true,force:true})).ok);state=await finished(['paused']);
  assert(state.message.includes('自动修复 2 次'));assert.equal((await worker.evaluate(()=>apiCalls)).length,3);
  assert.equal(Object.keys((await data()).judgments).length,3);assert.equal((await call('PW_ARCHIVE_INFO')).count,countBeforeFailure);
  console.log('PASS exhausted format recovery stops after three attempts without false archive or sheet judgment');
  for(const scenario of ['moderated','filtered']) {
    await mode(scenario);assert((await call('PW_START',{continuous:true,force:true})).ok);await finished(['paused']);
    assert.equal((await worker.evaluate(()=>apiCalls)).length,1);assert.equal(Object.keys((await data()).judgments).length,3);
  }
  console.log('PASS content moderation and content_filter stop immediately without format retries');

  await mode('uncertain');assert((await call('PW_START',{continuous:true,force:true})).ok);state=await finished(['review']);
  calls=await worker.evaluate(()=>apiCalls);assert.equal(calls.length,2);assert.equal(calls[0].sizes.length,3);assert.equal(calls[1].sizes.length,15);
  assert.equal((await call('PW_APPLY')).ok,false);assert.equal(Object.keys((await data()).judgments).length,3);
  console.log('PASS difficult whole-image recheck includes whole images + overlapping sections; high-confidence uncertainty still pauses');

  await mode('429');assert((await call('PW_START',{continuous:false,force:true})).ok);state=await finished(['ready']);assert.equal((await worker.evaluate(()=>apiCalls)).length,3);assert.equal(Object.keys((await data()).judgments).length,3);
  console.log('PASS transient throttling retries before producing a suggestion, without filling during retries');

  await mode('delayed');assert((await call('PW_START',{continuous:false,force:true})).ok);
  await until(async()=>(await call('PW_STATUS')).status?.phase==='analyzing');
  await page.locator('#a-rotate').click();state=await finished(['paused']);assert(state.message.includes('旋转') || state.message.includes('变化'));
  for(let i=0;i<3;i++)await page.locator('#a-rotate').click();assert.equal(Object.keys((await data()).judgments).length,3);
  console.log('PASS image rotation while request is pending invalidates old recommendation');

  await mode('delayed');assert((await call('PW_START',{continuous:true,force:true})).ok);
  await until(async()=>(await call('PW_STATUS')).status?.phase==='analyzing');
  assert((await call('PW_STOP')).ok);await finished(['paused']);assert.equal(Object.keys((await data()).judgments).length,3);
  console.log('PASS stop cancels request and prevents fill');

  await mode('success');
  assert((await call('PW_SAVE_SETTINGS',{settings:{batchLimit:800}})).ok);
  assert.equal((await call('PW_SETTINGS')).settings.batchLimit,800);
  assert((await call('PW_START',{continuous:true,force:true})).ok);state=await finished(['done']);
  assert.equal(state.snapshot.done,8);assert.equal(state.batchDone,5);assert.equal(Object.keys((await data()).judgments).length,8);
  calls=await worker.evaluate(()=>apiCalls);assert.equal(calls.length,5);
  assert(calls[0].labels[0].includes('EN_JA'));assert(calls.slice(1).every(x=>x.labels[0].includes('JA_EN')));
  assert.equal(await dashboard.locator('#checkpoint').count(),0);
  console.log('PASS batch size 800 resumes above 25%, switches direction per item and completes all remaining items');

  const count=(await call('PW_ARCHIVE_INFO')).count;await dashboard.reload();await dashboard.waitForFunction(()=>document.querySelector('#archive-count').textContent!=='0 条');assert.equal((await call('PW_ARCHIVE_INFO')).count,count);
  const report=await call('PW_EXPORT_ARCHIVE');assert(report.html.includes('翻译'));assert(report.html.includes('原表两项已保存'));assert(!report.html.includes('TEST-KEY-NEVER-REAL'));assert(!report.html.includes('PRIVATE TEST REASONING'));
  fs.writeFileSync(path.join(work,'offline-report.html'),report.html);const preview=await context.newPage();await preview.goto(pathToFileURL(path.join(work,'offline-report.html')).href);assert.equal(await preview.locator('article').count(),count);await preview.screenshot({path:path.join(work,'offline-report.png'),fullPage:true});await preview.close();
  await dashboard.locator('#archive').evaluate(el=>el.open=true);const downloadPromise=dashboard.waitForEvent('download');await dashboard.locator('#export-records').click();const download=await downloadPromise;assert(download.suggestedFilename().includes('插件离线记录'));await download.saveAs(path.join(work,'downloaded-offline-report.html'));
  console.log('PASS permanent browser archive survives page reload and exports readable offline HTML with reasons and saved state');
  const before=Object.keys((await data()).judgments).length;await page.reload();await page.waitForFunction(()=>document.querySelector('#src-body img')?.naturalWidth>0);assert.equal(Object.keys((await data()).judgments).length,before);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(source,'index.html'))).digest('hex'),originalHash);
  // Permanence must cover more than the former rolling 100-record limit.
  await dashboard.evaluate(async()=>{
    const archive=await import(chrome.runtime.getURL('archive.js'));const rows=await archive.records();const sample=rows[0];
    const snapshot={url:sample.pageURL,sheetId:sample.sheetId,evaluator:sample.evaluator,scope:sample.scope,pairId:sample.pairId,index:sample.index,total:sample.total,languagePair:sample.languagePair,images:sample.images};
    for(let i=0;i<101;i++){const result={...sample.result};delete result.archiveId;await archive.saveRecord({...snapshot,pairId:'ARCHIVE-RETENTION-TEST-'+i},result,false);}
  });
  assert.equal((await call('PW_ARCHIVE_INFO')).count,count+101);
  await context.close();context=await chromium.launchPersistentContext(profile,launchOptions);
  worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:20000});
  const restored=await worker.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('papago-pairwise-assistant-archive',1);
    request.onsuccess=()=>{const db=request.result;const count=db.transaction('records','readonly').objectStore('records').count();count.onsuccess=()=>{db.close();resolve({count:count.result});};count.onerror=()=>reject(count.error);};request.onerror=()=>reject(request.error);
  }));
  assert.equal(restored.count,count+101);
  console.log('PASS archive exceeds 100 records and survives closing/reopening the isolated browser profile');
  fs.writeFileSync(path.join(work,'e2e-summary.json'),JSON.stringify({version:JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8')).version,tests:18,passed:true,formatRecoveryVerified:true,formatRecoveryBounded:true,moderationNotRetried:true,checkpointDoesNotBlock:true,batchLimitVerified:true,directionSwitchVerified:true,mockAPI:true,liveAPI:false,nativeImages:true,wholeImage:true,originalImageBytesVerified:true,assignmentGuardVerified:true,archiveRecords:restored.count,browserRestartVerified:true,originalPackageUnchanged:true},null,2));
  console.log('PASS browser sheet progress survives reload; official package unchanged. All browser checks passed with mocked Qwen responses.');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
