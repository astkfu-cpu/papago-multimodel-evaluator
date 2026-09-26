const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { browserLaunchOptions } = require('./test-browser-launch.cjs');

(async () => {
  const browser = await chromium.launch(browserLaunchOptions());
  try {
    const page = await browser.newPage({ viewport: {width:480,height:900} });
    await page.setContent('<div id="test"></div>');
    await page.evaluate(() => { window.chrome = {runtime:{onMessage:{addListener(){}}}}; });
    await page.addScriptTag({path:path.join(__dirname,'content.js')});
    const result = await page.evaluate(async () => {
      const native = document.createElement('canvas');
      native.width = 2000; native.height = 3000;
      const ctx = native.getContext('2d');
      ctx.fillStyle='#eee'; ctx.fillRect(0,0,2000,3000);
      ctx.fillStyle='#2255cc'; ctx.fillRect(1600,900,80,120);
      const focus = targetFocusFromBox([800,300,840,340]);
      const crop = await cropNormalized(native.toDataURL(),focus);
      const raw = await loadImage(crop);
      const expanded = await resizeForModel(await upscaleForModel(crop,1100,4),2000);
      const zoom = await loadImage(expanded);
      const sample = document.createElement('canvas'); sample.width=raw.width; sample.height=raw.height;
      const sampleCtx=sample.getContext('2d'); sampleCtx.drawImage(raw,0,0);
      const center=[...sampleCtx.getImageData(Math.floor(raw.width/2),Math.floor(raw.height/2),1,1).data];
      return {width:raw.width,height:raw.height,zoomWidth:zoom.width,zoomHeight:zoom.height,center,expanded};
    });
    assert.deepEqual(result.center,[34,85,204,255]);
    assert(result.width > 80 && result.width < 150 && result.height > 120 && result.height < 200);
    assert(result.zoomWidth > result.width && result.zoomHeight > result.height);
    const html = fs.readFileSync(path.join(__dirname,'sidepanel.html'),'utf8').replace(/<script[^>]*src="sidepanel.js"[^>]*><\/script>/,'');
    await page.setContent(html);
    await page.addStyleTag({path:path.join(__dirname,'sidepanel.css')});
    await page.evaluate(() => { window.chrome={runtime:{getManifest:()=>({version:'0.9.0'}),sendMessage:async()=>({ok:true,settings:{}}),onMessage:{addListener(){}}},storage:{local:{get:async()=>({})}}}; });
    await page.addScriptTag({path:path.join(__dirname,'sidepanel.js')});
    await page.evaluate(image => {
      showTargetPreview({targetImage:image,label:'实际送评的译文近景（浏览器裁剪测试）'});
      document.getElementById('targetPreview').open=true;
    }, result.expanded);
    await page.waitForFunction(() => document.querySelector('#targetPreview img')?.naturalWidth > 0);
    assert.equal(await page.locator('#targetPreview img').count(),1);
    await page.locator('#targetPreview').scrollIntoViewIfNeeded();
    console.log(JSON.stringify({nativeCrop:[result.width,result.height],enlarged:[result.zoomWidth,result.zoomHeight],pixelVerified:true,previewLoaded:true}));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
