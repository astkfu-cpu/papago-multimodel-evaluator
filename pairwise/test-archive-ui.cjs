const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const work=path.resolve(__dirname,'../tmp/pairwise-development');fs.mkdirSync(work,{recursive:true});
(async()=>{
 const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (process.platform==='win32'?'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe':chromium.executablePath());
 const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(work,'archive-ui-')),{headless:true,executablePath,ignoreDefaultArgs:['--disable-extensions'],args:['--disable-extensions-except='+__dirname,'--load-extension='+__dirname],acceptDownloads:true});
 try{
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'),id=worker.url().split('/')[2];
  await worker.evaluate(()=>chrome.storage.local.set({settings:{apiKey:'UI-TEST-DUMMY-SECRET'}}));
  const page=await context.newPage();await page.goto(`chrome-extension://${id}/sidepanel.html`);
  await page.locator('#archive').evaluate(el=>el.open=true);await page.locator('#archive details').evaluate(el=>el.open=true);
  const backup=await page.evaluate(async()=>{
   const {backupOf}=await import(chrome.runtime.getURL('backup.js'));
   return backupOf([{id:'UI-TEST-ROW',schema:'papago_pairwise_assistant_record/v1',createdAt:'2026-10-21T01:00:00.000Z',updatedAt:'2026-10-21T01:00:00.000Z',sheetId:'PUBLIC-DEMO',evaluator:'DEMO',scope:['EN_JA'],pairId:'ui-demo',index:1,total:1,languagePair:'EN_JA',pageURL:'file:///demo/index.html',images:[],applied:false,result:{translation:'A',rendering:'B',translation_reason:'UI 测试翻译依据',rendering_reason:'UI 测试渲染依据',source_summary:'自制演示',a_evidence:'A 的依据',b_evidence:'B 的依据',a_state:'normal',b_state:'normal',confidence:0.9,needs_review:false,review_reason:''}}],'1.1.0');
  });
  await page.locator('#restore-file').setInputFiles({name:'plugin-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.waitForFunction(()=>document.querySelector('#restore-preview').textContent.includes('可补入 1 条'));
  assert.equal((await page.evaluate(()=>new Promise(r=>chrome.runtime.sendMessage({type:'PW_ARCHIVE_INFO'},r)))).count,0);
  page.on('dialog',dialog=>dialog.accept());await page.locator('#restore-confirm').click();
  await page.waitForFunction(()=>document.querySelector('#restore-preview').textContent.includes('已补入 1 条'));
  await page.locator('#restore-file').setInputFiles([]);await page.locator('#restore-file').setInputFiles({name:'same-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.waitForFunction(()=>document.querySelector('#restore-preview').textContent.includes('已有 1 条'));assert(await page.locator('#restore-confirm').isDisabled());
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-batch').click();const download=await downloadPromise,file=await download.path(),text=fs.readFileSync(file,'utf8');
  const exported=JSON.parse(text);assert.equal(exported.records.length,1);assert.equal(exported.records[0].result.rendering_reason,'UI 测试渲染依据');assert(!text.includes('UI-TEST-DUMMY-SECRET'));
  await page.locator('#restore-file').setInputFiles({name:'official-results.json',mimeType:'application/json',buffer:Buffer.from('{"judgments":{}}')});await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('不是插件归档备份'));
  assert(await page.locator('#restore-confirm').isDisabled());
  assert.equal((await page.evaluate(()=>new Promise(r=>chrome.runtime.sendMessage({type:'PW_ARCHIVE_INFO'},r)))).count,1);
  console.log('PASS archive UI: file preview is read-only, explicit restore, duplicate disabled, JSON download excludes key, official format rejected');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
