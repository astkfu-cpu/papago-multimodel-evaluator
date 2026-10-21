import test from 'node:test';
import assert from 'node:assert/strict';
import {settingsOf,endpointURL,parseResult,canAutoApply,checkpointReached,buildRequest,RUBRIC} from './shared.js';
import {offlineReport} from './archive.js';
const base=()=>({translation:'A',rendering:'B',translation_reason:'A 的金额和条件更准确',rendering_reason:'B 的文字布局更贴近原图',source_summary:'商品优惠条件及小字',a_evidence:'可见译文完整',b_evidence:'可见译文有金额错误',a_state:'normal',b_state:'normal',confidence:0.91,needs_review:false,review_reason:''});
test('two dimensions can have different winners; invalid/absent output never becomes tie',()=>{
  assert.equal(parseResult(JSON.stringify(base())).rendering,'B');
  for(const raw of ['{}','null','[]','{"translation":3}','not JSON'])assert.throws(()=>parseResult(raw));
});
test('uncertainty and both failures require review even with high confidence',()=>{
  for(const state of [{a_state:'uncertain'},{translation:null},{a_state:'no_result',b_state:'untranslated'}]){
    const r=parseResult(JSON.stringify({...base(),...state}));assert.equal(r.needs_review,true);assert.equal(canAutoApply(r,settingsOf()),false);
  }
  assert.equal(canAutoApply({...base(),confidence:0.84},settingsOf()),false);
});
test('single-side failure must agree with BOTH winners',()=>{
  assert.equal(parseResult(JSON.stringify({...base(),a_state:'no_result'})).needs_review,true);
  assert.equal(parseResult(JSON.stringify({...base(),a_state:'untranslated',translation:'B',rendering:'B'})).needs_review,false);
});
test('only official endpoints accepted, without credentials or redirect parameters',()=>{
  for(const url of ['https://evil.example/','https://dashscope.aliyuncs.com.evil.example/','https://xmaas.aliyuncs.com/','http://dashscope.aliyuncs.com/','https://key@dashscope.aliyuncs.com/'])assert.throws(()=>endpointURL(url));
  assert.equal(endpointURL('https://dashscope.aliyuncs.com/compatible-mode/v1'),'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.throws(()=>settingsOf({batchLimit:1.5}));
});
test('interim checkpoint at assigned scope 200/800, not every batch',()=>{
  assert.equal(checkpointReached(199,800),false);assert.equal(checkpointReached(200,800),true);assert.equal(checkpointReached(201,800,true),false);
});
test('request sends complete labelled images, direction and rule only; exact Qwen parameters',()=>{
  const request=buildRequest(settingsOf(), 'EN_JA', [{data:'data:image/jpeg;base64,source'},{data:'data:image/jpeg;base64,A'},{data:'data:image/jpeg;base64,B'}]);
  assert.equal(request.reasoning_effort,'low');assert.equal(request.stream,true);assert.equal(request.vl_high_resolution_images,true);
  assert.equal(request.messages[1].content.filter(x=>x.type==='image_url').length,3);
  assert(request.messages[0].content.includes('WHOLE'));assert(RUBRIC.includes('less poor'));assert(RUBRIC.includes('IGNORE'));
  assert(!JSON.stringify(request).includes('sys/s'));assert(!('thinking_budget' in request));
});
test('offline report escapes model text and excludes unsafe image links',()=>{
  const result={...base(),translation_reason:'<script>alert("unsafe")</script>',ruleVersion:'test'};
  const html=offlineReport([{evaluator:'test',languagePair:'EN_JA',index:1,total:800,pairId:'p1',sheetId:'test',createdAt:'now',updatedAt:'now',applied:false,result,images:[{side:'a',url:'javascript:alert(1)'}]}]);
  assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(!html.includes('href="javascript:'));
});
