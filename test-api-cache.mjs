import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("background.js", import.meta.url), "utf8");
const store = { apiKey: "test-only", model: "deepseek-flash" };
const storage = {
  async get(keys) {
    if (keys == null) return { ...store };
    const list = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(list.filter((key) => Object.hasOwn(store, key)).map((key) => [key, store[key]]));
  },
  async set(values) { Object.assign(store, JSON.parse(JSON.stringify(values))); }
};

function createContext() {
  const context = vm.createContext({
    chrome: {
      runtime: {
        getManifest: () => ({ version: "0.15.0" }),
        onInstalled: { addListener() {} },
        onMessage: { addListener() {} }
      },
      storage: { local: storage }
    },
    URL,
    Blob,
    setTimeout: (callback) => { callback(); return 1; },
    clearTimeout() {}
  });
  vm.runInContext(source, context);
  return context;
}

let calls = 0;
let context = createContext();
const qwenConfig = context.apiConfigFromSettings({
  model: "qwen3.8-flash",
  qwenApiKey: "qwen-test-only",
  qwenEndpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1"
});
assert.equal(qwenConfig.provider, "qwen");
assert.equal(qwenConfig.model, "qwen3.8-flash");
assert.equal(qwenConfig.apiUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
assert.equal(context.languagePairConfig("ja-zh").source, "日文");
assert.equal(context.languagePairConfig("zh-ja").target, "日文");
assert.equal(context.languagePairConfig("en-ja").source, "英文");
assert.equal(context.languagePairConfig("ja-en").target, "英文");
assert.equal(context.rubricForLanguagePair("ja-zh"), vm.runInContext("RUBRIC", context), "original direction must keep the original rubric byte-for-byte");
assert.match(context.rubricForLanguagePair("zh-ja"), /简体中文图片翻译成日文/);
assert.match(context.targetLocatorPromptForLanguagePair("zh-ja"), /残留中文原文/);
assert.match(context.rubricForLanguagePair("en-ja"), /英文图片翻译成日文/);
assert.match(context.rubricForLanguagePair("ja-en"), /日文图片翻译成英文/);
assert.match(context.targetLocatorPromptForLanguagePair("en-ja"), /残留英文原文/);
const archiveOne = context.buildDetailedArchiveEntry({
  account_label: "账号A", task_id: "5221/3184", batch_code: "E2600132", item_index: 7,
  language_pair: "ja-zh", model: "deepseek-flash", source_text: "原文", target_text: "译文",
  translation_score: 4, rendering_score: 3, confidence: .9, apiKey: "must-not-archive"
}, 12, 1000);
const archiveTwo = context.buildDetailedArchiveEntry({
  account_label: "账号A", task_id: "5221/3184", item_index: 8,
  language_pair: "ja-zh", source_text: "原文2", target_text: "译文2"
}, 12, 2000);
assert.equal(archiveOne.accountTaskKey, "账号A\u00005221/3184");
assert.equal(archiveOne.apiKey, undefined, "archive must never contain API keys");
const importedArchive = context.normalizeImportedArchiveEntry({ ...archiveOne, id: "legacy-1", apiKey: "must-not-import" });
assert.equal(importedArchive.id, "legacy-1");
assert.equal(importedArchive.apiKey, undefined, "archive import must never retain API keys");
assert.equal(importedArchive.accountTaskKey, "账号A\u00005221/3184");
const archiveGroups = context.groupArchiveEntries([archiveOne, archiveTwo]);
assert.equal(archiveGroups.total, 2);
assert.equal(archiveGroups.accounts[0].tasks[0].count, 2);
assert.deepEqual(JSON.parse(JSON.stringify(context.reasoningMode(0, null, "qwen"))), { reasoning_effort: "none", max_tokens: 1600 });
assert.deepEqual(JSON.parse(JSON.stringify(context.reasoningMode(2, null, "qwen"))), { reasoning_effort: "medium", max_tokens: 16000 });
const qwenBody = context.prepareProviderBody({
  model: "qwen3.8-flash",
  thinking: { type: "disabled" },
  max_tokens: 1600,
  messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA", detail: "original" } }] }]
}, "qwen");
assert.equal(qwenBody.vl_high_resolution_images, true);
assert.equal(qwenBody.thinking, undefined);
assert.equal(qwenBody.max_tokens, undefined);
assert.equal(qwenBody.max_completion_tokens, 1600);
assert.deepEqual(JSON.parse(JSON.stringify(qwenBody.messages[0].content[0].image_url)), { url: "data:image/png;base64,AA" });
store.qwenApiKey = "qwen-test-only";
const isolatedSettings = await context.apiSettingsForMessage({
  requestSettings: { model: "qwen3.8-flash", qwenEndpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", qualityMode: "deep" }
}, ["qualityMode"]);
assert.equal(isolatedSettings.model, "qwen3.8-flash");
assert.equal(isolatedSettings.qwenEndpoint, "https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
assert.equal(isolatedSettings.qualityMode, "deep");
assert.equal(store.model, "deepseek-flash", "per-tab request settings must not overwrite global settings");

let transientAttempts = 0;
context.fetch = async () => {
  transientAttempts += 1;
  const failed = transientAttempts < 3;
  return {
    ok: !failed,
    status: failed ? 500 : 200,
    statusText: failed ? "Internal Server Error" : "OK",
    headers: { get: (name) => name.toLowerCase() === "content-type" ? "application/json" : (name.toLowerCase() === "x-request-id" ? `retry-${transientAttempts}` : "") },
    text: async () => JSON.stringify(failed
      ? { error: { code: "internal_server_error", message: "Connection refused (os error 111)" } }
      : { choices: [{ finish_reason: "stop", message: { content: "ok" } }] })
  };
};
await context.requestDeepSeek("qwen-test-only", { model: "qwen3.8-flash", messages: [] }, qwenConfig.apiUrl, "qwen");
assert.equal(transientAttempts, 3, "transient provider errors should retry twice and then recover");

let authAttempts = 0;
context.fetch = async () => {
  authAttempts += 1;
  return {
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify({ error: { code: "invalid_api_key", message: "invalid key" } })
  };
};
await assert.rejects(
  context.requestDeepSeek("bad-key", { model: "qwen3.8-flash", messages: [] }, qwenConfig.apiUrl, "qwen"),
  /invalid_api_key/
);
assert.equal(authAttempts, 1, "authentication failures must not be retried");

context.requestDeepSeek = async () => {
  calls += 1;
  return {
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ found: true, state: "normal", box: [100, 200, 300, 260], confidence: 0.93 }) } }],
    usage: { prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 30, prompt_cache_miss_tokens: 70 }
  };
};

const request = { sourceOverview: "source-a", sourceGuide: "guide-a", targetImage: "target-a", tiles: [{ image: "tile-a", box: [0, 0, 600, 600] }] };
const first = await context.locateTargetBlock(request);
const repeated = await context.locateTargetBlock(request);
assert.equal(first.cached, undefined);
assert.equal(repeated.cached, true);
assert.equal(calls, 1, "identical inputs should only make one paid locator call");

await context.locateTargetBlock({ ...request, targetImage: "target-b" });
assert.equal(calls, 2, "a different target image must never reuse the old result");
await context.locateTargetBlock({ ...request, requestSettings: { languagePair: "zh-ja" } });
assert.equal(calls, 3, "different language directions must never share a locator cache result");
assert.equal(store.apiUsageStatsV1.calls, 3);
assert.equal(store.apiUsageStatsV1.localCacheHits, 1);
assert.equal(store.apiUsageStatsV1.hitTokens, 90);
assert.equal(store.apiUsageStatsV1.missTokens, 210);
assert.equal(store.apiResultCacheV1.length, 3);

context = createContext();
context.requestDeepSeek = async () => { throw new Error("persistent cache was not reused"); };
const afterRestart = await context.locateTargetBlock(request);
assert.equal(afterRestart.cached, true, "cache should survive a service-worker restart");
assert.deepEqual(JSON.parse(JSON.stringify(afterRestart.location.box)), [100, 200, 300, 260]);

console.log("Provider and persistent API cache checks passed (Qwen mapping, exact reuse, mismatch isolation, restart persistence, usage metrics).")
