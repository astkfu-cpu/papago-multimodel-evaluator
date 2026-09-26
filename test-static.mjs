import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const required = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  ...(manifest.content_scripts || []).flatMap((entry) => entry.js || []),
  "sidepanel.css",
  "sidepanel.js",
  "test-api-cache.mjs",
  "test-archive.cjs",
  "README.md",
  "PRIVACY.md"
].filter(Boolean);

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing manifest/project file: ${file}`);
}
if (!manifest.host_permissions.includes("https://papago-pro.naver.com/*")) throw new Error("Papago host permission missing");
if (!manifest.host_permissions.includes("https://api.deepseek.com/*")) throw new Error("DeepSeek host permission missing");
if (!manifest.host_permissions.includes("https://dashscope.aliyuncs.com/*") || !manifest.host_permissions.includes("https://*.maas.aliyuncs.com/*")) throw new Error("Qwen host permission missing");
if (!manifest.host_permissions.includes("<all_urls>")) throw new Error("captureVisibleTab permission missing");
if (!(manifest.permissions || []).includes("debugger")) throw new Error("Required background capture permission missing");
if (!(manifest.permissions || []).includes("unlimitedStorage")) throw new Error("Long-term local archive storage permission missing");
if ((manifest.optional_permissions || []).includes("debugger")) throw new Error("debugger cannot be requested as an optional permission");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const detector = fs.readFileSync(path.join(root, "highlight-detector.js"), "utf8");
const panel = fs.readFileSync(path.join(root, "sidepanel.html"), "utf8");
const panelScript = fs.readFileSync(path.join(root, "sidepanel.js"), "utf8");
if (background.includes("sk-")) throw new Error("Possible API key committed");
for (const field of ["sourceOverview", "targetOverview", "sourceDetail", "targetDetail"]) {
  if (!background.includes(field) || !content.includes(field)) throw new Error(`Separate image field missing: ${field}`);
}
if (content.includes("composeComparison(")) throw new Error("Legacy merged-image path is still active");
if (!content.includes("waitForNextItemReady") || !content.includes("paneVisualState")) throw new Error("Stable next-item image guard missing");
if (!content.includes("sourceChanged ||=") || !content.includes("targetChanged ||=") || !content.includes("stableCount >= 2") || !content.includes("imageSimilarity") || !content.includes("nativePaneVisualState")) throw new Error("Independent pane update guard missing");
if (!content.includes("LOCATE_SOURCE_BLOCK") || !background.includes("locateSourceBlock")) throw new Error("Source-block model recovery missing");
if (!content.includes("chrome.runtime.getManifest().version")) throw new Error("Versioned cache key missing");
if (!background.includes('quality: { thinking: { type: "disabled" }, reasoning_effort: "none", max_tokens: 2200 }')) throw new Error("Stable continuous mode missing");
if (!background.includes('thoughtful: { thinking: { type: "enabled" }, reasoning_effort: "low", max_tokens: 10000 }')) throw new Error("Thoughtful single-item mode missing");
if (!background.includes('deep: { thinking: { type: "enabled" }, reasoning_effort: "high", max_tokens: 20000 }')) throw new Error("Deep single-item mode missing");
if (!background.includes("禁止抄录、翻译、概括或评价图片里的其他文字")) throw new Error("Highlighted-block-only rubric missing");
if (!content.includes('makeFallbackResult("uncertain"') || !content.includes("多轮原文高亮定位仍失败")) throw new Error("Three-point fallback missing");
if (!content.includes("当前原文块编号")) throw new Error("Block guide context missing");
if (!detector.includes("findFrameCandidates") || !detector.includes("findPairedLineFrames")) throw new Error("Structural blue-frame detector missing");
if (!detector.includes("warmCoverage >= 0.45")) throw new Error("Gray-yellow interior guard missing");
if (!detector.includes("findContentBounds") || !content.includes("refineVisibleMediaRect")) throw new Error("Screenshot media-boundary calibration missing");
if (!content.includes("createOverlappingTiles") || !content.includes("enhanceTextImage")) throw new Error("Multi-tile enhanced recovery missing");
if (!fs.existsSync(path.join(root, "test-highlight-detector.mjs"))) throw new Error("Highlight regression suite missing");
if (!content.includes("preserveViewer: true") || !content.includes("upscaleForModel")) throw new Error("Manual zoom preservation or small-block enlargement missing");
if (!content.includes("intersectRects") || !content.includes("plainRect")) throw new Error("Actual visible-image bounds missing");
if (!content.includes("(weakDetection ? 150 : 110) / reference.width")) throw new Error("Pixel-based small-block crop missing");
if (!background.includes('detail: "original"')) throw new Error("Full-resolution overview mode missing");
if (!background.includes("parseEventStream") || !background.includes("describePayload")) throw new Error("DeepSeek response diagnostics missing");
if (!background.includes('response_format: { type: "json_object" }')) throw new Error("JSON response mode missing");
if (!background.includes("evaluation_state") || !background.includes("untranslated") || !background.includes("page_error")) throw new Error("Special-state rubric missing");
if (!background.includes("calibrateExtremeScores") || !background.includes("[满分证据]") || !background.includes("[极端低分证据]")) throw new Error("Extreme-score calibration missing");
if (!content.includes("fallbackKind") || !content.includes('makeFallbackResult("na"')) throw new Error("Automatic special-state fallback missing");
if (!background.includes("comment_zh") || !background.includes("comment_ko")) throw new Error("Bilingual comment fields missing");
if (!content.includes("result.comment_ko")) throw new Error("Papago page is not filled with Korean comment");
if (!panel.includes('id="historyList"') || !panel.includes('id="clearHistory"')) throw new Error("Evaluation history panel missing");
if (!panelScript.includes("evaluationHistory")) throw new Error("Evaluation history UI missing");
if (panelScript.includes('permissions.request({ permissions: ["debugger"] })')) throw new Error("debugger must not be requested at runtime");
if (!background.includes("SAVE_HISTORY_ENTRY") || !content.includes("SAVE_HISTORY_ENTRY")) throw new Error("Background history persistence missing");
if (!background.includes("Page.captureScreenshot") || !background.includes("capturePapagoTab") || !content.includes("RELEASE_BACKGROUND_CAPTURE")) throw new Error("Background-tab capture path missing");
if (!background.includes("PREPARE_BACKGROUND_CAPTURE") || !background.includes("autoDiscardable: false") || !background.includes("Page.setWebLifecycleState")) throw new Error("Persistent background-tab wake guard missing");
if (!background.includes("BACKGROUND_DELAY") || !content.includes("useExtensionTimers") || !content.includes("document.hidden")) throw new Error("Background-safe delay path missing");
if (!content.includes("backgroundCapture === true ? 12000 : 18000")) throw new Error("Background page-update retry interval missing");
if (!panel.includes('id="commentMode"') || !panel.includes('id="toggleHistory"')) throw new Error("Optional comment mode or history toggle missing");
if (!panel.includes('id="backgroundCapture"') || panel.indexOf('id="status"') > panel.indexOf("模型与 API 设置")) throw new Error("Top status panel or background toggle missing");
if (!background.includes("slice(0, 50)")) throw new Error("History limit must be 50");
if (!background.includes("papago-evaluation-detailed-archive") || !background.includes("indexedDB.open") || !background.includes("accountTaskKey")) throw new Error("IndexedDB detailed archive missing");
if (!panel.includes('id="accountLabel"') || !panel.includes('id="exportArchiveHtml"') || !panel.includes('id="exportArchiveJson"')) throw new Error("Archive account or export controls missing");
if (!content.includes("currentArchiveTaskIdentity") || !content.includes("result.account_label") || !panelScript.includes("groupedArchivePayload")) throw new Error("Account/task archive classification missing");
if (!panel.includes('id="migrateLegacyArchive"') || !panel.includes('id="importArchiveJson"') || !background.includes("IMPORT_ARCHIVE_ENTRIES")) throw new Error("Archive migration/import controls missing");
if (!content.includes("findVisibleHeaderBatchCode") || !content.includes("taskRoute")) throw new Error("Header task number classification missing");
if (!content.includes("extractBatchCode") || !content.includes("shadowRoot")) throw new Error("Robust visible header task number scan missing");
if (!panelScript.includes("taskScopeKey") || !panelScript.includes("TASK_PROFILES_KEY")) throw new Error("Per-task account isolation missing");
if (!content.includes('CONTENT_BUILD_VERSION = "0.25.0"') || !panelScript.includes('PANEL_BUILD_VERSION = "0.25.0"')) throw new Error("Content/panel version handshake missing");
if (!panel.includes('value="en-zh"') || !panel.includes('value="zh-en"') || !content.includes('"EN>ZH_CN": "en-zh"') || !content.includes('"ZH_CN>EN": "zh-en"')) throw new Error("English-Chinese bidirectional mode missing");
if (!panel.includes('id="qualityMode"')) throw new Error("Quality mode selector missing");
if (!panel.includes('id="languagePair"') || !panel.includes('value="zh-ja"') || !panelScript.includes("languagePair")) throw new Error("Chinese-to-Japanese direction selector missing");
if (!panel.includes('value="qwen3.8-flash"') || !panel.includes('id="qwenApiKey"') || !panel.includes('id="qwenEndpoint"')) throw new Error("Qwen 3.8 Flash settings missing");
if (!background.includes("prepareProviderBody") || !background.includes("vl_high_resolution_images")) throw new Error("Qwen multimodal request adapter missing");
if (!background.includes("isTransientProviderError") || !background.includes("maximumAttempts = 3") || !background.includes("waitBeforeTransientRetry")) throw new Error("Transient provider retry guard missing");
if (!background.includes("apiResultCacheV1") || !background.includes("MAX_API_CACHE_ENTRIES = 120")) throw new Error("Persistent exact-result cache missing");
if (!background.includes("prompt_cache_hit_tokens") || !background.includes("prompt_cache_miss_tokens")) throw new Error("DeepSeek cache-token metrics missing");
if (!panel.includes('id="apiUsageStats"') || !panelScript.includes("renderApiUsageStats")) throw new Error("Cache metrics UI missing");
if (!panel.includes('id="testApi"') || !background.includes("TEST_PROVIDER")) throw new Error("Provider diagnostics button missing");
if (panelScript.includes('storage.session.get("evaluationTabId")') || !panelScript.includes("sender?.tab?.id !== evaluationTabId")) throw new Error("Side-panel status is not isolated by tab");
if (!panelScript.includes("chrome.tabs.onActivated") || !content.includes("GET_RUNTIME_STATE")) throw new Error("Per-tab runtime restore missing");
if (!content.includes("requestSettings: modelRequestSettings(settings)") || !background.includes("apiSettingsForMessage")) throw new Error("Per-tab model settings are not pinned to each run");
if (!content.includes("backgroundCapture: settings.backgroundCapture === true") || !background.includes("requestedBackgroundCapture")) throw new Error("Per-tab background capture mode is not pinned to each run");
if (!background.includes("saveHistoryEntry(message.result, sender.tab?.id)") || !panelScript.includes("entry.tabId === evaluationTabId")) throw new Error("History is not isolated by tab");
if (!content.includes("未经双轮确认不会误填NA") || !content.includes('makeFallbackResult("uncertain", settings')) throw new Error("N/A confirmation guard missing");
if (!background.includes("rubricForLanguagePair") || !background.includes("targetLocatorPromptForLanguagePair") || !content.includes("assertPageLanguagePair")) throw new Error("Language-direction prompt or page guard missing");
if (!content.includes("GET_PAGE_CONTEXT") || !content.includes("settingsForCurrentPage") || !content.includes("已停止且不会默认使用日译中")) throw new Error("Current-page automatic language lock missing");
if (!panel.includes('value="en-ja"') || !panel.includes('value="ja-en"') || !content.includes('"EN>JA": "en-ja"') || !content.includes('"JA>EN": "ja-en"')) throw new Error("English-Japanese bidirectional mode missing");
if (!background.includes("已自动重连并重试") || !background.includes("retryDelays = [0, 260, 650, 1200]") || !background.includes("adopted: true")) throw new Error("Debugger reconnect retry missing");
if (!panel.includes('id="browserArchiveEnabled"') || !panel.includes('id="diskArchiveEnabled" type="checkbox" hidden') || !panelScript.includes("diskArchiveEnabled: false")) throw new Error("Browser-only archive controls missing");
if (!content.includes("isRecoverableRunError") || !content.includes('emitStatus("recovering"')) throw new Error("Continuous-run recovery missing");
if (!background.includes("MAX_PROVIDER_CONCURRENCY") || !background.includes("Math.random() * 1100")) throw new Error("Parallel provider throttling/jitter missing");
if (!background.includes("preferDirectWhenBackground") || !content.includes("detectDomHighlightRegion") || !content.includes("后台直接读取网页原图（不依赖窗口可见）")) throw new Error("Occluded-window DOM image fallback missing");
if (!content.includes("sourceCandidate?.image && targetCandidate?.image") || !content.includes("preferDirectWhenBackground: false")) throw new Error("Screenshot-free transition fingerprint path missing");
if (!background.includes("CLICK_NEXT_BACKGROUND") || !background.includes("Runtime.evaluate") || !content.includes("refreshFilledEvaluationSignals")) throw new Error("Background next-item retry path missing");
if (!content.includes("currentItemKey() === before.itemKey") || !content.includes("当前评分已填写，但网页没有切换")) throw new Error("Confirmed next-item transition guard missing");
if (!content.includes("ratingSelectionsCleared") || !content.includes("resetTransitionReady")) throw new Error("Rating-reset transition evidence missing");
if (!background.includes('expression: "Date.now()"') || !background.includes("Force a lightweight renderer task")) throw new Error("Background renderer wake-up missing");
if (!content.includes("reapplyCurrentEvaluation") || !content.includes("forceBackground") || !background.includes("forced-complete-form-click")) throw new Error("Disabled complete-form retry missing");
if (!content.includes("MAX_PAGE_IMAGE_CACHE_ENTRIES") || !content.includes("pageImageCache.get(url)")) throw new Error("Page image resource cache missing");
const transitionStateBody = content.slice(content.indexOf("async function captureCurrentPaneVisualState"), content.indexOf("function paneVisualState"));
if (transitionStateBody.includes("extractPaneOriginal(") || transitionStateBody.includes("CAPTURE_VISIBLE")) throw new Error("Transition polling still downloads or screenshots full images");
if (!background.includes("languagePair: result.language_pair") || !panelScript.includes("方向未记录") || !panelScript.includes("entry.captureInfo")) throw new Error("Detailed direction-aware history missing");
if (panelScript.includes("states.find((entry) => entry.state?.running)") || !panelScript.includes("仅控制当前页面")) throw new Error("Side panel may still auto-bind another page");
console.log(`Static checks passed (${required.length} referenced files).`);
