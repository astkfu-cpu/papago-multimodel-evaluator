const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{execFileSync}=require('child_process');
const work=path.resolve(__dirname,'../tmp/pairwise-development');
const stage=fs.mkdtempSync(path.join(work,'upgrade-extension-'));
const profile=fs.mkdtempSync(path.join(work,'upgrade-profile-'));
const oldZip=process.env.PAPAGO_PAIRWISE_PREVIOUS_ZIP;
if(!oldZip)throw new Error('Set PAPAGO_PAIRWISE_PREVIOUS_ZIP to an authorized v1.0.1 package.');
const python=process.env.PYTHON_EXECUTABLE || 'python';
execFileSync(python,['-X','utf8','-c',`import sys,zipfile,pathlib
with zipfile.ZipFile(sys.argv[1]) as z:
 for name in z.namelist():
  p=pathlib.PurePosixPath(name)
  if len(p.parts)==2 and p.parts[0]=='papago-pairwise-evaluator':
   pathlib.Path(sys.argv[2],p.name).write_bytes(z.read(name))`,oldZip,stage]);
const launch={headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',ignoreDefaultArgs:['--disable-extensions'],args:['--disable-extensions-except='+stage,'--load-extension='+stage]};
(async()=>{
 let context=await chromium.launchPersistentContext(profile,launch);
 try {
  let worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');const id=worker.url().split('/')[2];
  let page=await context.newPage();await page.goto(`chrome-extension://${id}/sidepanel.html`);
  const before=await page.evaluate(async()=>{
    if(chrome.runtime.getManifest().version!=='1.0.1')throw new Error('Expected actual old build');
    const archive=await import(chrome.runtime.getURL('archive.js'));
    const settings={apiKey:'UPGRADE-TEST-DUMMY-KEY',model:'qwen3.8-flash',effort:'medium',batchLimit:800,confidenceThreshold:0.93,commentMode:'zh'};
    await chrome.storage.local.set({settings});
    for(let i=0;i<5;i++) {
      const snapshot={sheetId:'TEST-OLD-SHEET',evaluator:'TEST-OLD-USER',scope:['EN_JA','JA_EN'],pairId:'old-'+i,index:i+1,total:800,languagePair:'EN_JA',url:'file:///test/index.html',images:[]};
      const result={translation:i===4?null:'A',rendering:'B',translation_reason:'原来的翻译理由 '+i,rendering_reason:'原来的渲染理由 '+i,source_summary:'原图内容',a_evidence:'A 的原有依据',b_evidence:'B 的原有依据',a_state:i===4?'uncertain':'normal',b_state:'normal',confidence:i===4?0.5:0.96,needs_review:i===4,review_reason:i===4?'原有疑难记录':'',ruleVersion:'pairwise-en-v2-whole-image-20261014-v1'};
      await archive.saveRecord(snapshot,result,i<4);
    }
    return {rows:await archive.records(),settings:(await chrome.storage.local.get('settings')).settings};
  });
  await context.close();
  // Same directory, same browser profile: the user-facing overwrite update path.
  for(const name of fs.readdirSync(__dirname))if(/\.(js|html|css|json)$/.test(name))fs.copyFileSync(path.join(__dirname,name),path.join(stage,name));
  context=await chromium.launchPersistentContext(profile,launch);
  worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');assert.equal(worker.url().split('/')[2],id);
  page=await context.newPage();await page.goto(`chrome-extension://${id}/sidepanel.html`);
  const after=await page.evaluate(async()=>{
    const archive=await import(chrome.runtime.getURL('archive.js')),rows=await archive.records();
    return {rows,settings:(await chrome.storage.local.get('settings')).settings,version:chrome.runtime.getManifest().version,html:archive.offlineReport(rows)};
  });
  assert.equal(after.version,'1.0.2');assert.deepEqual(after.rows,before.rows);assert.deepEqual(after.settings,before.settings);
  assert(after.html.includes('原来的渲染理由 4'));assert(after.html.includes('原有疑难记录'));assert(!after.html.includes(before.settings.apiKey));
  fs.writeFileSync(path.join(work,'upgrade-summary.json'),JSON.stringify({passed:true,from:'1.0.1',to:after.version,oldRecords:5,recordsExactlyPreserved:true,settingsExactlyPreserved:true,sameExtensionId:true,oldReviewRecordExportable:true},null,2));
  console.log('PASS actual 1.0.1 to 1.0.2 overwrite upgrade: same extension ID, all old records/reasons/status/timestamps and settings preserved, old review record exportable');
 }finally {await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
