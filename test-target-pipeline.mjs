import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const content = fs.readFileSync(new URL("content.js", import.meta.url), "utf8");
const background = fs.readFileSync(new URL("background.js", import.meta.url), "utf8");
const plain = (v) => JSON.parse(JSON.stringify(v));
let count = 0;
const bg = vm.createContext({
  chrome: { runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} } } },
  setTimeout: () => 1, clearTimeout() {}
});
vm.runInContext(background, bg);
{
  let visibleCalls = 0;
  const debuggerCommands = [];
  let runtimeExpression = "";
  const discardableUpdates = [];
  let foreground = true;
  bg.chrome.tabs = {
    get: async () => ({ id:7, windowId:3, active:foreground, autoDiscardable:true }),
    update: async (_tabId, changes) => { discardableUpdates.push(changes.autoDiscardable); },
    captureVisibleTab: async () => { visibleCalls++; return "visible-image"; }
  };
  bg.chrome.windows = { get: async () => ({ focused:foreground, state:foreground ? "normal" : "minimized" }) };
  bg.chrome.storage = { local: { get: async () => ({ backgroundCapture:true }) } };
  bg.chrome.permissions = { contains: async () => true };
  bg.chrome.debugger = {
    attach: async () => {},
    sendCommand: async (_debuggee, method, params = {}) => {
      debuggerCommands.push(method);
      if (method === "Page.captureScreenshot") return { data:"background-image" };
      if (method === "Runtime.evaluate") {
        runtimeExpression = params.expression || "";
        return { result:{ value:{ clicked:true, reason:"main-world-click" } } };
      }
      return {};
    },
    detach: async () => {}
  };
  const visible = await bg.capturePapagoTab({ tab:{id:7,windowId:3} });
  assert.equal(visible.mode, "foreground");
  assert.equal(visible.image, "visible-image");
  foreground = false;
  const direct = await bg.capturePapagoTab({ tab:{id:7,windowId:3} }, true, true);
  assert.equal(direct.mode, "dom-direct");
  assert.equal(direct.domFallback, true);
  assert.equal(debuggerCommands.includes("Page.captureScreenshot"), false);
  const hidden = await bg.capturePapagoTab({ tab:{id:7,windowId:3} });
  assert.equal(hidden.mode, "background-debugger");
  assert.equal(hidden.image, "data:image/png;base64,background-image");
  assert.equal(visibleCalls, 1);
  assert.equal(discardableUpdates[0], false);
  assert(debuggerCommands.includes("Page.setWebLifecycleState"));
  assert(debuggerCommands.includes("Emulation.setFocusEmulationEnabled"));
  assert(debuggerCommands.includes("Page.captureScreenshot"));
  const clicked = await bg.clickNextInPageMainWorld({ tab:{ id:7 } });
  assert.equal(clicked.clicked, true);
  assert(debuggerCommands.includes("Runtime.evaluate"));
  new vm.Script(runtimeExpression);
  await bg.releaseDebuggerTab(7);
  assert.equal(discardableUpdates.at(-1), true);
  count += 4;
}
{
  const ordinaryFive = { evaluation_state:"normal", source_text:"原文", target_text:"译文", translation_score:5, rendering_score:5,
    comment_zh:"翻译和排版都不错。", comment_ko:"", confidence:.98, needs_review:false, reason:"没有明显问题" };
  bg.validateResult(ordinaryFive, "none");
  assert.equal(ordinaryFive.translation_score, 4);
  assert.equal(ordinaryFive.rendering_score, 4);

  const provenFive = { evaluation_state:"normal", source_text:"原文", target_text:"译文", translation_score:5, rendering_score:5,
    comment_zh:"", comment_ko:"", confidence:.98, needs_review:false,
    reason:"[满分证据]逐字准确自然，无遗漏无误译，排版位置和字号与原图几乎一致" };
  bg.validateResult(provenFive, "none");
  assert.equal(provenFive.translation_score, 5);
  assert.equal(provenFive.rendering_score, 5);

  const ordinaryOne = { evaluation_state:"normal", source_text:"原文", target_text:"译文", translation_score:1, rendering_score:1,
    comment_zh:"", comment_ko:"", confidence:.95, needs_review:false, reason:"有明显问题" };
  bg.validateResult(ordinaryOne, "none");
  assert.equal(ordinaryOne.translation_score, 2);
  assert.equal(ordinaryOne.rendering_score, 2);

  const provenOne = { evaluation_state:"normal", source_text:"原文", target_text:"乱码", translation_score:1, rendering_score:1,
    comment_zh:"", comment_ko:"", confidence:.95, needs_review:false,
    reason:"[极端低分证据]译文是乱码且内容无关，严重重叠后完全无法阅读" };
  bg.validateResult(provenOne, "none");
  assert.equal(provenOne.translation_score, 1);
  assert.equal(provenOne.rendering_score, 1);
  count += 4;
}
for (const box of [[800, 300, 840, 340], [0, 0, 1, 1], [999, 999, 1000, 1000]]) {
  assert.deepEqual(plain(bg.validateTargetLocation({ found: true, box, confidence: 0.9 })).box, box);
  count++;
}
assert.deepEqual(plain(bg.validateTargetLocation({ found: false, state: "page_error", confidence: .9 })), {
  found: false, state: "page_error", confidence: .9
});
assert.throws(() => bg.validateTargetLocation({ found: false, state: "page_error", confidence: .4 }));
count += 2;
for (const value of [
  { found: false, box: [1, 2, 3, 4], confidence: 1 },
  { found: true, box: [-1, 2, 3, 4], confidence: 1 },
  { found: true, box: [5, 2, 3, 4], confidence: 1 },
  { found: true, box: [1, 2, 1001, 4], confidence: 1 },
  { found: true, box: [1, 2, NaN, 4], confidence: 1 },
  { found: true, box: [1, 2, 3, 4], confidence: 0.4 },
  { found: true, box: [1, 2, 3, 4], confidence: Infinity }
]) { assert.throws(() => bg.validateTargetLocation(value)); count++; }

function setup({ locationError = false, navigateDuring = "", stopDuring = "", targetState = "normal", evaluationError = false } = {}) {
  const crops = [], messages = [], fills = [];
  let item = "page:1";
  const box = [800, 300, 840, 340]; // Translation moved far from source; phone screenshot inset.
  const context = vm.createContext({
    location: { hostname: "papago-pro.naver.com", pathname: "/test" },
    document: { body: { innerText: "E2600132\nJA > ZH_CN\n일반" } },
    chrome: { runtime: {
      onMessage: { addListener() {} }, getManifest: () => ({ version: "0.10.0" }),
      async sendMessage(message) {
        messages.push(message);
        if (message.type === navigateDuring) item = "page:2";
        if (message.type === stopDuring) vm.runInContext("runState = {running:true, stopRequested:true}", context);
        if (message.type === "CAPTURE_VISIBLE") return { ok: true, image: "screen" };
        if (message.type === "LOCATE_TARGET_BLOCK") {
          if (locationError) return { ok: false, error: typeof locationError === "string" ? locationError : "not located" };
          if (["no_output", "page_error"].includes(targetState)) return { ok: true, location: { found: false, state: targetState, confidence: .9 } };
          return { ok: true, location: { found: true, state: targetState, box, confidence: .9 } };
        }
        if (message.type === "EVALUATE_IMAGES") return evaluationError ? { ok: false, error: "temporary empty response" } : { ok: true, result: {
          evaluation_state: "normal",
          source_text: "原文", target_text: "译文", translation_score: 4, rendering_score: 4,
          confidence: .9, needs_review: false
        } };
        return { ok: true };
      }
    } }
  });
  vm.runInContext(content, context);
  Object.assign(context, {
    findHeading: () => ({}), currentItemKey: () => item, readProgress: () => ({current: 1}),
    positionForCapture: async () => {},
    detectImagePanes: () => ({ source: {name: "left", left:0,top:0,width:600,height:600}, target: {name:"right",left:600,top:0,width:600,height:600} }),
    extractPaneOriginal: async (_, side) => ({ image: side === "left" ? "source-native" : "target-native", displayRect: {left:0,top:0,width:600,height:600} }),
    refineVisibleMediaRect: async (_, pane) => ({...pane, refined: true}),
    cropScreenshot: async (_, pane) => `screen-${pane.name}`,
    detectHighlightRegion: async () => ({ rect: {left:90,top:90,width:8,height:8}, confidence: .9, mode: "blue-frame" }),
    cropNormalized: async (image, focus) => { crops.push({ image, focus: plain(focus) }); return `crop:${image}`; },
    resizeForModel: async image => image, upscaleForModel: async image => image,
    createOverlappingTiles: async () => [], enhanceTextImage: async image => image,
    imageSimilarity: async () => 0, collectContext: () => "current block",
    fillEvaluation: result => fills.push(result)
  });
  return {context, crops, messages, fills, box};
}
{
  const {context, messages, fills} = setup();
  assert.equal(context.modelRequestSettings({ languagePair: "zh-ja" }).languagePair, "zh-ja");
  const zhJaFallback = context.makeFallbackResult("untranslated", { languagePair: "zh-ja", commentMode: "bilingual" }, "test");
  assert.match(zhJaFallback.comment_zh, /中文原文.*日文翻译/);
  assert.match(zhJaFallback.comment_ko, /중국어 원문.*일본어 번역/);
  context.document = { body: { innerText: "E2600144\nZH_CN  >  JA\n일반" } };
  assert.equal(context.detectPageLanguagePair(), "zh-ja");
  assert.equal(context.extractBatchCode("任务 E\u200B2600132"), "E2600132");
  assert.equal(context.extractBatchCode("E 2 6 0 0 1 3 2"), "E2600132");
  context.location.pathname = "/job/evaluation/5221/3184";
  assert.deepEqual(plain(context.currentArchiveTaskIdentity()), {
    taskId: "E2600144", taskRoute: "5221/3184", batchCode: "E2600144"
  });
  assert.equal(context.settingsForCurrentPage({ languagePair: "ja-zh" }).languagePair, "zh-ja");
  assert.throws(() => context.assertPageLanguagePair("ja-zh"), /语言方向不一致/);
  await assert.rejects(
    () => context.runOne({ settings: { languagePair: "ja-zh" }, preserveViewer: true }),
    /语言方向不一致/
  );
  assert.equal(messages.length, 0, "direction mismatch must stop before capture or any paid API call");
  assert.equal(fills.length, 0);
  context.document = { body: { innerText: "E2600145\nEN > JA\n일반" } };
  assert.equal(context.detectPageLanguagePair(), "en-ja");
  assert.equal(context.settingsForCurrentPage({ languagePair: "ja-zh" }).languagePair, "en-ja");
  const enJaFallback = context.makeFallbackResult("untranslated", { languagePair: "en-ja", commentMode: "bilingual" }, "test");
  assert.match(enJaFallback.comment_zh, /英文原文.*日文翻译/);
  context.document = { body: { innerText: "E2600146\nJA → EN_US\n일반" } };
  assert.equal(context.detectPageLanguagePair(), "ja-en");
  const jaEnFallback = context.makeFallbackResult("untranslated", { languagePair: "ja-en", commentMode: "bilingual" }, "test");
  assert.match(jaEnFallback.comment_zh, /日文原文.*英文翻译/);
  context.document = { body: { innerText: "E2600147\nEN → ZH_CN\n일반" } };
  assert.equal(context.detectPageLanguagePair(), "en-zh");
  const enZhFallback = context.makeFallbackResult("untranslated", { languagePair: "en-zh", commentMode: "bilingual" }, "test");
  assert.match(enZhFallback.comment_zh, /英文原文.*中文翻译/);
  context.document = { body: { innerText: "E2600148\nZH_CN → EN\n일반" } };
  assert.equal(context.detectPageLanguagePair(), "zh-en");
  const zhEnFallback = context.makeFallbackResult("untranslated", { languagePair: "zh-en", commentMode: "bilingual" }, "test");
  assert.match(zhEnFallback.comment_zh, /中文原文.*英文翻译/);
  count++;
}
{
  const {context, fills, messages} = setup({targetState:"page_error"});
  const outcome = await context.runOne({preserveViewer:true});
  assert.equal(outcome.filled, true);
  assert.equal(fills[0].translation_score, "NA");
  assert.equal(fills[0].rendering_score, "NA");
  assert.equal(messages.filter(m => m.type === "EVALUATE_IMAGES").length, 0);
  assert.equal(messages.filter(m => m.type === "LOCATE_TARGET_BLOCK").length, 2, "N/A needs two independent confirmations");
  count++;
}
{
  const {context, fills} = setup({locationError:"千问百炼请求失败（HTTP 401，code InvalidApiKey）：鉴权失败"});
  await assert.rejects(() => context.runOne({preserveViewer:true}), /千问百炼请求失败/);
  assert.equal(fills.length, 0, "provider failures must never be written as task N/A");
  count++;
}
{
  const {context, fills, messages} = setup({targetState:"untranslated", evaluationError:true});
  const outcome = await context.runOne({preserveViewer:true});
  assert.equal(outcome.filled, true);
  assert.equal(fills[0].translation_score, 1);
  assert.equal(fills[0].rendering_score, "NA");
  assert.equal(messages.filter(m => m.type === "EVALUATE_IMAGES").length, 0);
  count++;
}

{
  const {context, crops, messages, fills, box} = setup();
  const result = await context.runOne({preserveViewer:true});
  assert.equal(result.filled, true);
  assert.equal(fills.length, 1);
  const actual = crops.find(c => c.image === "target-native");
  const expected = plain(context.targetFocusFromBox(box));
  assert.deepEqual(actual.focus, expected);
  assert(actual.focus.left > .75, "Must not reuse source block coordinates near 0.15");
  const locate = messages.find(m => m.type === "LOCATE_TARGET_BLOCK");
  assert.equal(locate.targetImage, "target-native");
  assert.equal(locate.sourceGuide, "crop:screen-left", "Locator must see screenshot highlight, not unmarked source crop");
  const evaluate = messages.find(m => m.type === "EVALUATE_IMAGES");
  assert.equal(evaluate.targetDetail, "crop:target-native");
  assert.equal(messages.filter(m => m.type === "LOCATE_TARGET_BLOCK").length, 1);
  assert.equal(messages.filter(m => m.type === "EVALUATE_IMAGES").length, 1);
  assert.equal(messages.find(m => m.type === "EVALUATOR_PREVIEW").targetImage, evaluate.targetDetail);
  count++;
}
{
  const {context, fills, messages} = setup({locationError:true});
  const outcome = await context.runOne({preserveViewer:true});
  assert.equal(outcome.filled, true);
  assert.equal(fills[0].translation_score, 3);
  assert.equal(fills[0].rendering_score, 3);
  assert.equal(fills[0].auto_fallback, true);
  assert.equal(messages.filter(m => m.type === "LOCATE_TARGET_BLOCK").length, 3);
  count++;
}
for (const options of [
  {navigateDuring:"LOCATE_TARGET_BLOCK"},
  {navigateDuring:"EVALUATE_IMAGES"}, {stopDuring:"LOCATE_TARGET_BLOCK"}, {stopDuring:"EVALUATE_IMAGES"}
]) {
  const {context, fills, messages} = setup(options);
  await assert.rejects(() => context.runOne({preserveViewer:true}));
  assert.equal(fills.length, 0, "No stale or unlocated result may fill page");
  if (options.navigateDuring === "LOCATE_TARGET_BLOCK" || options.stopDuring === "LOCATE_TARGET_BLOCK") {
    assert.equal(messages.filter(m => m.type === "EVALUATE_IMAGES").length, 0);
  }
  count++;
}
{
  const {context} = setup();
  for (const box of [[0,0,4,4], [995,995,1000,1000]]) {
    const focus = context.targetFocusFromBox(box);
    assert(focus.left >= 0 && focus.top >= 0 && focus.left + focus.width <= 1 && focus.top + focus.height <= 1);
  }
  count++;
}

// The locator API receives images in the coordinate order specified in its prompt.
{
  bg.chrome.storage = { local: { get: async () => ({ apiKey:"test-only", model:"configured-model" }) } };
  let request;
  bg.requestDeepSeek = async (_, body) => {
    request = body;
    return { choices:[{finish_reason:"stop",message:{content:JSON.stringify({found:true,box:[800,300,840,340],confidence:.9})}}] };
  };
  const response = await bg.locateTargetBlock({sourceOverview:"A",sourceGuide:"B",targetImage:"C"});
  assert.equal(response.ok, true);
  assert.equal(request.model,"configured-model");
  assert.deepEqual(plain(request.messages[1].content.filter(c => c.type === "image_url").map(c => c.image_url.url)), ["A","B","C"]);
  bg.requestDeepSeek = async () => ({choices:[{finish_reason:"length",message:{content:'{"found":true}'}}]});
  await assert.rejects(() => bg.locateTargetBlock({sourceOverview:"A",sourceGuide:"B",targetImage:"C2"}));
  count++;
}
{
  bg.chrome.storage = { local: { get: async () => ({ apiKey:"test-only", model:"configured-model" }) } };
  let request;
  bg.requestDeepSeek = async (_, body) => {
    request = body;
    return { choices:[{finish_reason:"stop",message:{content:JSON.stringify({found:true,box:[120,220,310,280],confidence:.94})}}] };
  };
  const response = await bg.locateSourceBlock({
    sourceImage:"full-source", sourceHint:"wrong-hint",
    tiles:[{image:"tile-1",box:[0,0,600,600]}], recoveryLevel:1
  });
  assert.equal(response.ok, true);
  assert.deepEqual(plain(response.location.box), [120,220,310,280]);
  assert.deepEqual(plain(request.messages[1].content.filter(c => c.type === "image_url").map(c => c.image_url.url)),
    ["full-source","wrong-hint","tile-1"]);
  assert.equal(request.reasoning_effort, "low");
  count++;
}
console.log(`Target pipeline checks passed (${count} cases; no paid API calls).`);
