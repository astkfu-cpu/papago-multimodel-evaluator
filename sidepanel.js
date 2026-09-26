const ids = ["apiKey", "qwenApiKey", "qwenEndpoint", "model", "languagePair", "accountLabel", "qualityMode", "commentMode", "backgroundCapture", "autoAdvance", "pauseOnLowConfidence", "browserArchiveEnabled", "diskArchiveEnabled", "requireDiskBackup", "confidenceThreshold", "delayMs", "maxItems"];
const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const onceButton = document.getElementById("once");
const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const reloadButton = document.getElementById("reloadExtension");
const testApiButton = document.getElementById("testApi");
const statusElement = document.getElementById("status");
const badge = document.getElementById("stateBadge");
const clearHistoryButton = document.getElementById("clearHistory");
const toggleHistoryButton = document.getElementById("toggleHistory");
const historyList = document.getElementById("historyList");
const apiUsageStatsElement = document.getElementById("apiUsageStats");
const controlledTabElement = document.getElementById("controlledTab");
const archiveStatsElement = document.getElementById("archiveStats");
const exportArchiveHtmlButton = document.getElementById("exportArchiveHtml");
const exportArchiveJsonButton = document.getElementById("exportArchiveJson");
const chooseBackupFolderButton = document.getElementById("chooseBackupFolder");
const diskBackupStatusElement = document.getElementById("diskBackupStatus");
const migrateLegacyArchiveButton = document.getElementById("migrateLegacyArchive");
const importArchiveJsonButton = document.getElementById("importArchiveJson");
const archiveImportFile = document.getElementById("archiveImportFile");
const ARCHIVE_UI_DB_NAME = "papago-evaluation-detailed-archive";
const ARCHIVE_UI_DB_VERSION = 2;
const ARCHIVE_UI_EVALUATIONS_STORE = "evaluations";
const ARCHIVE_UI_CONFIG_STORE = "config";
const BACKUP_DIRECTORY_CONFIG_KEY = "backupDirectory";
const TASK_PROFILES_KEY = "taskProfilesV1";
const PANEL_BUILD_VERSION = "0.25.0";
const ORIGINAL_EXTENSION_ID = "dkoifdkgghhfnifnacfjioljdognejbl";
const LEGACY_LUNA_EXTENSION_ID = "ckehnenaimedhlelnmclelbdfojmndle";
// Unpacked extensions receive a different runtime ID on every user's machine.
// Build identity therefore comes from the manifest name, not a developer's ID.
const legacyMigrationMode = /旧版归档迁移器/.test(chrome.runtime.getManifest().name || "");
let evaluationHistory = [];
let historyExpanded = false;
let evaluationTabId = null;
let currentWindowId = null;
let boundPageContext = null;
let bindGeneration = 0;
let currentBackupDirectoryHandle = null;
let currentDiskBackupStatus = null;

initialize().catch(showError);

async function initialize() {
  document.getElementById("version").textContent = `v${chrome.runtime.getManifest().version}`;
  const response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  if (!response?.ok) throw new Error(response?.error || "读取设置失败");
  for (const id of ids) {
    const value = response.settings[id];
    if (value === undefined) continue;
    if (elements[id].type === "checkbox") elements[id].checked = Boolean(value);
    else if (id === "qualityMode" && value === "balanced") elements[id].value = "quality";
    else elements[id].value = value;
  }
  elements.diskArchiveEnabled.checked = false;
  elements.requireDiskBackup.checked = false;
  if (response.settings.v022ContinuityDefaultsApplied !== true) {
    elements.pauseOnLowConfidence.checked = false;
  }
  await chrome.storage.local.set({
    diskArchiveEnabled: false,
    requireDiskBackup: false,
    pauseOnLowConfidence: elements.pauseOnLowConfidence.checked,
    v022ContinuityDefaultsApplied: true
  });
  if (legacyMigrationMode) {
    migrateLegacyArchiveButton.disabled = true;
    migrateLegacyArchiveButton.textContent = "请在原文件夹版本中合并归档";
    statusElement.textContent = "这是临时保留的 Luna 旧扩展，只用于导出旧归档。请改用下载文件夹中的原版本运行新任务。";
  }
  const currentWindow = await chrome.windows.getCurrent();
  currentWindowId = currentWindow?.id ?? null;
  const debuggerGranted = await chrome.permissions.contains({ permissions: ["debugger"] });
  if (elements.backgroundCapture.checked && !debuggerGranted) {
    elements.backgroundCapture.checked = false;
    await chrome.storage.local.set({ backgroundCapture: false });
  }
  updateProviderFields();
  syncArchiveOptionsUi();
  for (const [id, element] of Object.entries(elements)) {
    const handler = id === "backgroundCapture" ? handleBackgroundCaptureChange : (id === "model" ? handleModelChange : (id === "diskArchiveEnabled" ? handleDiskArchiveChange : saveSettings));
    element.addEventListener("change", handler);
  }
  evaluationHistory = Array.isArray(response.settings.evaluationHistory) ? response.settings.evaluationHistory.slice(0, 50) : [];
  renderApiUsageStats(response.settings.apiUsageStatsV1);
  await bindInitialTab();
  await refreshArchiveSummary();
  await requestPersistentArchiveStorage();
}

onceButton.addEventListener("click", async () => {
  try {
    setRunning(true, "正在分析当前张");
    const settings = await saveSettings();
    ensureTaskAccountLabel(settings);
    await ensureDiskBackupReady(settings);
    const response = await sendToEvaluationTab({ type: "ANALYZE_ONCE", settings }, true);
    if (!response?.ok) throw new Error(response?.error || "当前张评价失败");
    if (response.filled !== false) await refreshHistory();
    showResult(response.result, response.filled === false
      ? (response.pauseReason || "识别证据不足，已暂停且没有填写")
      : "当前张已填写，请核对后自行切换或开始连续运行");
  } catch (error) {
    showError(error);
  } finally {
    setRunning(false);
  }
});

startButton.addEventListener("click", async () => {
  try {
    const settings = await saveSettings();
    if (isQwenModel(settings.model) ? !settings.qwenApiKey : !settings.apiKey) {
      throw new Error(isQwenModel(settings.model) ? "请先填写千问百炼 API Key" : "请先填写 DeepSeek API Key");
    }
    ensureTaskAccountLabel(settings);
    await ensureDiskBackupReady(settings);
    await sendToEvaluationTab({ type: "START_AUTO", settings }, true);
    setRunning(true, "连续评价已启动");
  } catch (error) {
    showError(error);
    setRunning(false);
  }
});

stopButton.addEventListener("click", async () => {
  try {
    await sendToEvaluationTab({ type: "STOP_AUTO" }, false);
    statusElement.textContent = "正在当前安全节点停止…";
  } catch (error) {
    showError(error);
  }
});

reloadButton.addEventListener("click", async () => {
  try {
    await saveSettings();
    statusElement.textContent = "正在应用原文件夹中的最新代码…";
    reloadButton.disabled = true;
    setTimeout(() => chrome.runtime.reload(), 180);
  } catch (error) {
    showError(error);
  }
});

testApiButton.addEventListener("click", async () => {
  try {
    testApiButton.disabled = true;
    await saveSettings();
    statusElement.textContent = "正在测试当前模型、密钥和接口地址…";
    const response = await chrome.runtime.sendMessage({ type: "TEST_PROVIDER" });
    if (!response?.ok) throw new Error(response?.error || "API 测试失败");
    statusElement.textContent = `${response.provider} 连接正常；实际模型：${response.model}`;
    setBadge("连接正常", "success");
  } catch (error) {
    showError(error);
  } finally {
    testApiButton.disabled = false;
  }
});


chrome.runtime.onMessage.addListener((message, sender) => {
  if (!Number.isInteger(evaluationTabId) || sender?.tab?.id !== evaluationTabId) return;
  const boundPath = boundPageContext?.page ? new URL(boundPageContext.page).pathname : "";
  if (message?.pagePath && boundPath && message.pagePath !== boundPath) return;
  if (message?.type === "EVALUATOR_PREVIEW") {
    showTargetPreview(message);
    return;
  }
  if (message?.type !== "EVALUATOR_STATUS") return;
  if (["running", "loading"].includes(message.state) || (message.state === "analyzing" && message.message?.includes("独立定位"))) {
    document.getElementById("targetPreview")?.remove();
  }
  statusElement.textContent = message.message || "";
  if (message.result) showResult(message.result, message.message);
  if (message.state === "scored" && message.result) refreshHistory().catch(() => {});
  if (message.state === "scored" && message.result) refreshArchiveSummary().catch(() => {});
  if (["scored", "error", "paused", "done"].includes(message.state)) refreshApiUsageStats().catch(() => {});
  if (["error", "paused", "stopped", "done"].includes(message.state)) setRunning(false);
  if (message.state === "error") setBadge("错误", "error");
  else if (["scored", "done"].includes(message.state)) setBadge("已评分", "success");
  else if (["running", "analyzing", "loading"].includes(message.state)) setBadge("运行中", "running");
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (windowId !== currentWindowId) return;
  chrome.tabs.get(tabId).then((tab) => {
    if (isPapagoTab(tab)) return bindEvaluationTab(tab, true);
    unbindEvaluationTab("当前标签页不是 Papago Pro；插件不会控制其他页面。");
  }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId !== evaluationTabId || !changeInfo.url || tab.windowId !== currentWindowId) return;
  if (isPapagoTab(tab)) bindEvaluationTab(tab, true).catch(showError);
  else unbindEvaluationTab("当前标签页已离开 Papago Pro；插件不会继续控制旧任务。");
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== evaluationTabId) return;
  evaluationTabId = null;
  controlledTabElement.textContent = "当前控制：标签页已关闭";
  statusElement.textContent = "请切换到另一个 Papago Pro 评价页。";
  clearResult();
  renderHistory();
  setRunning(false);
});

function showTargetPreview(message) {
  if (typeof message.targetImage !== "string" || !/^data:image\/(png|webp|jpeg);base64,/.test(message.targetImage)) return;
  document.getElementById("targetPreview")?.remove();
  const section = document.createElement("details");
  section.id = "targetPreview";
  const title = document.createElement("summary");
  title.textContent = message.label || "查看实际送评的译文近景";
  const image = document.createElement("img");
  image.src = message.targetImage;
  image.alt = "本次从译图独立定位、裁剪后的实际送评区域";
  image.style.cssText = "display:block;max-width:100%;height:auto;margin-top:8px";
  section.append(title, image);
  document.getElementById("recognizedText").after(section);
}

clearHistoryButton.addEventListener("click", async () => {
  if (!confirm("只清空侧栏最近50条记录，不会删除本地长期详细归档。确定继续吗？")) return;
  evaluationHistory = [];
  await chrome.storage.local.remove("evaluationHistory");
  renderHistory();
});

toggleHistoryButton.addEventListener("click", () => {
  historyExpanded = !historyExpanded;
  renderHistory();
});

exportArchiveHtmlButton.addEventListener("click", () => exportDetailedArchive("html"));
exportArchiveJsonButton.addEventListener("click", () => exportDetailedArchive("json"));
chooseBackupFolderButton.addEventListener("click", chooseDiskBackupFolder);
migrateLegacyArchiveButton.addEventListener("click", migrateLegacyArchive);
importArchiveJsonButton.addEventListener("click", () => archiveImportFile.click());
archiveImportFile.addEventListener("change", importArchiveJsonFile);

async function saveSettings() {
  const settings = {
    apiKey: elements.apiKey.value.trim(),
    qwenApiKey: elements.qwenApiKey.value.trim(),
    qwenEndpoint: elements.qwenEndpoint.value.trim(),
    model: elements.model.value,
    languagePair: elements.languagePair.value,
    accountLabel: elements.accountLabel.value.trim(),
    qualityMode: elements.qualityMode.value,
    commentMode: elements.commentMode.value,
    backgroundCapture: elements.backgroundCapture.checked,
    autoAdvance: elements.autoAdvance.checked,
    pauseOnLowConfidence: elements.pauseOnLowConfidence.checked,
    browserArchiveEnabled: elements.browserArchiveEnabled.checked,
    diskArchiveEnabled: false,
    requireDiskBackup: false,
    confidenceThreshold: Number(elements.confidenceThreshold.value),
    delayMs: Number(elements.delayMs.value),
    maxItems: Number(elements.maxItems.value)
  };
  const globalSettings = { ...settings };
  delete globalSettings.accountLabel;
  const response = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: globalSettings });
  if (!response?.ok) throw new Error(response?.error || "保存设置失败");
  await saveTaskProfile(settings.accountLabel);
  syncArchiveOptionsUi(settings);
  return settings;
}

function syncArchiveOptionsUi(settings = null) {
  const diskEnabled = settings ? settings.diskArchiveEnabled === true : elements.diskArchiveEnabled.checked;
  elements.requireDiskBackup.disabled = !diskEnabled;
  if (!diskEnabled) elements.requireDiskBackup.title = "先开启磁盘文件自动存档，才会在磁盘写入失败时暂停";
  else elements.requireDiskBackup.removeAttribute("title");
  paintDiskBackupStatus(currentDiskBackupStatus);
}

async function handleDiskArchiveChange() {
  syncArchiveOptionsUi();
  await saveSettings();
}

function isQwenModel(model) {
  return typeof model === "string" && model.startsWith("qwen");
}

function updateProviderFields() {
  const qwen = isQwenModel(elements.model.value);
  document.getElementById("deepseekApiKeyLabel").hidden = qwen;
  document.getElementById("qwenApiKeyLabel").hidden = !qwen;
  document.getElementById("qwenEndpointLabel").hidden = !qwen;
  document.getElementById("providerHint").textContent = qwen
    ? "使用阿里云百炼 API；默认是中国内地兼容地址，也可填写控制台提供的业务空间专属地址。密钥只保存在本机。"
    : "使用 DeepSeek 官方 API；密钥只保存在本机浏览器的扩展存储中。";
}

async function handleModelChange() {
  updateProviderFields();
  await saveSettings();
}

async function handleBackgroundCaptureChange() {
  try {
    if (elements.backgroundCapture.checked) {
      const declared = (chrome.runtime.getManifest().permissions || []).includes("debugger");
      if (!declared) throw new Error("当前 Edge 加载的仍是旧版清单，请到 edge://extensions 点击本扩展的“重新加载”");
      const granted = await chrome.permissions.contains({ permissions: ["debugger"] });
      if (!granted) {
        elements.backgroundCapture.checked = false;
        throw new Error("Edge 未授予后台取图权限，请到 edge://extensions 重新加载本扩展并接受权限提示");
      } else {
        statusElement.textContent = "后台取图已开启，可以切换标签页或最小化窗口。";
      }
    }
    await saveSettings();
  } catch (error) {
    if (elements.backgroundCapture.checked) {
      elements.backgroundCapture.checked = false;
      await chrome.storage.local.set({ backgroundCapture: false }).catch(() => {});
    }
    showError(error);
  }
}

async function sendToEvaluationTab(message, requireActivePapago) {
  let tab = null;
  if (requireActivePapago) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.startsWith("https://papago-pro.naver.com/")) throw new Error("请先切回Papago Pro页面再启动评价");
  } else if (Number.isInteger(evaluationTabId)) {
    tab = await chrome.tabs.get(evaluationTabId).catch(() => null);
  }
  if (!tab?.id) {
    throw new Error("当前侧栏没有绑定 Papago Pro 标签页，请先切到要控制的任务页");
  }
  bindTabIdentity(tab);
  try {
    if (message?.settings) {
      const pageContext = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTEXT" });
      if (!pageContext?.ok || !["ja-zh", "zh-ja", "en-ja", "ja-en", "en-zh", "zh-en"].includes(pageContext.languagePair)) {
        throw new Error(pageContext?.error || "无法确认当前页面的翻译方向");
      }
      if (pageContext.buildVersion !== PANEL_BUILD_VERSION) {
        throw new Error("当前Papago页面仍在运行旧版内容脚本，请刷新这个页面后再启动，避免沿用上一任务状态");
      }
      if (!boundPageContext || taskScopeKey(pageContext) !== taskScopeKey(boundPageContext)) {
        await bindEvaluationTab(tab, true);
        throw new Error("检测到页面已经切换为另一个任务，侧栏已重新绑定。请填写当前任务账号并确认备份位置后再启动");
      }
      boundPageContext = pageContext;
      message = { ...message, settings: { ...message.settings, languagePair: pageContext.languagePair } };
      elements.languagePair.value = pageContext.languagePair;
      renderControlledTab(tab, pageContext.languagePair, pageContext);
    }
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    if (/翻译方向|当前页面|刷新|旧版内容脚本/.test(String(error?.message || ""))) throw error;
    throw new Error("无法连接评价页，请刷新 Papago Pro 页面后重试");
  }
}

function isPapagoTab(tab) {
  return Number.isInteger(tab?.id) && typeof tab?.url === "string" && tab.url.startsWith("https://papago-pro.naver.com/");
}

function bindTabIdentity(tab) {
  evaluationTabId = tab.id;
  renderControlledTab(tab);
  historyExpanded = false;
}

function renderControlledTab(tab, languagePair = "", taskIdentity = null) {
  const match = String(tab.url || "").match(/\/job\/evaluation\/([^/?#]+\/[^/?#]+)/);
  const label = directionLabel(languagePair);
  const direction = label ? ` · ${label}` : "";
  const taskId = taskIdentity?.taskId || (match ? match[1] : "");
  const route = taskIdentity?.taskRoute && taskIdentity.taskRoute !== taskId ? ` · 网页 ${taskIdentity.taskRoute}` : "";
  controlledTabElement.textContent = `当前控制：当前标签页 #${tab.id}${taskId ? ` · 任务 ${taskId}` : ""}${route}${direction}`;
}

function unbindEvaluationTab(message = "请切换到要控制的 Papago Pro 页面。") {
  evaluationTabId = null;
  boundPageContext = null;
  currentBackupDirectoryHandle = null;
  controlledTabElement.textContent = "当前控制：无（仅控制当前页面）";
  statusElement.textContent = message;
  clearResult();
  renderHistory();
  setRunning(false);
  paintDiskBackupStatus(null);
}

async function bindInitialTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!isPapagoTab(active)) return unbindEvaluationTab();
  await bindEvaluationTab(active, true);
}

async function bindEvaluationTab(tab, restoreState = false) {
  if (!isPapagoTab(tab)) return;
  const generation = ++bindGeneration;
  bindTabIdentity(tab);
  boundPageContext = null;
  clearResult();
  renderHistory();
  const pageContext = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTEXT" }).catch(() => null);
  if (generation !== bindGeneration || tab.id !== evaluationTabId) return;
  if (pageContext?.ok && ["ja-zh", "zh-ja", "en-ja", "ja-en", "en-zh", "zh-en"].includes(pageContext.languagePair)) {
    if (pageContext.buildVersion !== PANEL_BUILD_VERSION) {
      statusElement.textContent = "当前Papago页面仍是旧版脚本。请刷新这个页面；在刷新前不会恢复旧任务状态或允许启动。";
      setBadge("需刷新", "error");
      setRunning(false);
      paintDiskBackupStatus(null);
      return;
    }
    boundPageContext = pageContext;
    elements.languagePair.value = pageContext.languagePair;
    renderControlledTab(tab, pageContext.languagePair, pageContext);
    await loadTaskProfile(pageContext);
    currentBackupDirectoryHandle = null;
  } else {
    statusElement.textContent = "无法读取当前任务页信息，请刷新该 Papago 页面后重试。";
    setRunning(false);
    paintDiskBackupStatus(null);
    return;
  }
  if (!restoreState) return;
  const view = await chrome.tabs.sendMessage(tab.id, { type: "GET_RUNTIME_STATE" }).catch(() => null);
  if (!view?.ok) {
    statusElement.textContent = "已绑定当前任务页；如无法启动，请刷新该 Papago 页面。";
    setRunning(false);
    return;
  }
  statusElement.textContent = view.message || (view.running ? "当前标签页正在运行" : "当前标签页待机");
  if (view.result) showResult(view.result, view.message);
  setRunning(Boolean(view.running));
  if (!view.running && ["error", "paused"].includes(view.state)) {
    setBadge(view.state === "error" ? "错误" : "已暂停", view.state === "error" ? "error" : "idle");
  }
}

function taskScopeKey(identity = {}) {
  const taskRoute = String(identity.taskRoute || identity.task_route || identity.pagePath || identity.page_path || "未知路径");
  const languagePair = String(identity.languagePair || identity.language_pair || "未知方向");
  return `${taskRoute}\u0000${languagePair}`;
}

function legacyTaskScopeKeys(identity = {}) {
  const taskId = String(identity.taskId || identity.task_id || identity.batchCode || identity.batch_code || "未知任务");
  const taskRoute = String(identity.taskRoute || identity.task_route || identity.pagePath || identity.page_path || "未知路径");
  const languagePair = String(identity.languagePair || identity.language_pair || "未知方向");
  return [...new Set([
    `${taskRoute}\u0000${taskId}\u0000${languagePair}`,
    `${taskRoute}\u0000${taskRoute}\u0000${languagePair}`
  ])];
}

function backupDirectoryConfigKey(identity = {}) {
  return `${BACKUP_DIRECTORY_CONFIG_KEY}:task:${taskScopeKey(identity)}`;
}

async function loadTaskProfile(identity) {
  const stored = await chrome.storage.local.get(TASK_PROFILES_KEY);
  const profiles = stored[TASK_PROFILES_KEY] && typeof stored[TASK_PROFILES_KEY] === "object" ? stored[TASK_PROFILES_KEY] : {};
  const stableKey = taskScopeKey(identity);
  let profile = profiles[stableKey];
  if (!profile) {
    for (const legacyKey of legacyTaskScopeKeys(identity)) {
      if (profiles[legacyKey]) {
        profile = profiles[legacyKey];
        profiles[stableKey] = { ...profile, updatedAt: Date.now(), migratedFromLegacyTaskScope: true };
        await chrome.storage.local.set({ [TASK_PROFILES_KEY]: profiles });
        break;
      }
    }
  }
  elements.accountLabel.value = typeof profile?.accountLabel === "string" ? profile.accountLabel : "";
}

async function saveTaskProfile(accountLabel) {
  if (!boundPageContext) return;
  const stored = await chrome.storage.local.get(TASK_PROFILES_KEY);
  const profiles = stored[TASK_PROFILES_KEY] && typeof stored[TASK_PROFILES_KEY] === "object" ? { ...stored[TASK_PROFILES_KEY] } : {};
  profiles[taskScopeKey(boundPageContext)] = { accountLabel: String(accountLabel || "").trim().slice(0, 60), updatedAt: Date.now() };
  const ordered = Object.entries(profiles).sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0)).slice(0, 100);
  await chrome.storage.local.set({ [TASK_PROFILES_KEY]: Object.fromEntries(ordered) });
}

function ensureTaskAccountLabel(settings) {
  if (!boundPageContext) throw new Error("尚未绑定当前任务页，请刷新页面后重试");
  if ((settings?.browserArchiveEnabled !== false || settings?.diskArchiveEnabled === true) && !String(settings?.accountLabel || "").trim()) {
    throw new Error("这是一个新任务，请先填写该任务对应的账号名称，防止归档到错误账号");
  }
}

function setRunning(running, message) {
  onceButton.disabled = running || legacyMigrationMode;
  startButton.disabled = running || legacyMigrationMode;
  stopButton.disabled = !running;
  testApiButton.disabled = running;
  if (message) statusElement.textContent = message;
  setBadge(running ? "运行中" : "待机", running ? "running" : "idle");
}

function showResult(result, message) {
  const resultLabel = document.getElementById("resultLabel");
  resultLabel.hidden = false;
  const direction = directionLabel(result.language_pair);
  resultLabel.textContent = result.item_index ? `最近一次完成：第 ${result.item_index} 张${direction ? ` · ${direction}` : ""}` : "最近一次完成的评价";
  document.getElementById("scores").hidden = false;
  document.getElementById("translationScore").textContent = result.translation_score;
  document.getElementById("renderingScore").textContent = result.rendering_score;
  document.getElementById("confidence").textContent = Number(result.confidence || 0).toFixed(2);
  const chineseComment = result.comment_zh || result.comment || "";
  const koreanComment = result.comment_ko || "";
  document.getElementById("chineseLabel").hidden = !chineseComment;
  document.getElementById("comment").textContent = chineseComment;
  document.getElementById("koreanLabel").hidden = !koreanComment;
  document.getElementById("koreanComment").textContent = koreanComment;
  const recognized = document.getElementById("recognizedText");
  recognized.hidden = !(result.source_text || result.target_text || result.reason || result.archive_saved || result.archive_error);
  const archiveStatus = result.archive_saved === true ? "\n浏览器归档：已保存" : result.archive_error ? `\n浏览器归档失败：${result.archive_error}` : "";
  const diskStatus = result.disk_backup_saved === true
    ? `\n磁盘备份：已追加${result.disk_backup_path ? `（${result.disk_backup_path}）` : ""}`
    : result.disk_backup_error ? `\n磁盘备份失败：${result.disk_backup_error}` : "";
  recognized.textContent = `${direction ? `翻译方向：${direction}\n` : ""}${result.task_id ? `任务编号：${result.task_id}${result.task_route && result.task_route !== result.task_id ? `（网页任务 ${result.task_route}）` : ""}\n` : ""}调用模型：${result.model || "旧记录未保存"}\n识别原文：${result.source_text || "未返回"}\n识别译文：${result.target_text || "未返回"}${result.reason ? `\n判断依据：${result.reason}` : ""}${result.capture_info ? `\n取图方式：${result.capture_info}` : ""}${archiveStatus}${diskStatus}`;
  if (message) statusElement.textContent = message;
  setBadge("已评分", "success");
}

function showError(error) {
  statusElement.textContent = error?.message || String(error);
  setBadge("错误", "error");
}

async function refreshApiUsageStats() {
  const stored = await chrome.storage.local.get("apiUsageStatsV1");
  renderApiUsageStats(stored.apiUsageStatsV1);
}

async function refreshArchiveSummary() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_ARCHIVE_SUMMARY" });
    if (!response?.ok) throw new Error(response?.error || "读取失败");
    const summary = response.summary || { total: 0, accounts: [] };
    const taskCount = (summary.accounts || []).reduce((sum, account) => sum + (account.tasks?.length || 0), 0);
    archiveStatsElement.textContent = `已长期归档 ${Number(summary.total) || 0} 条 · ${summary.accounts?.length || 0} 个账号标签 · ${taskCount} 个任务`;
  } catch (error) {
    archiveStatsElement.textContent = `归档统计读取失败：${error?.message || error}`;
  }
}

function openArchiveUiDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ARCHIVE_UI_DB_NAME, ARCHIVE_UI_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ARCHIVE_UI_EVALUATIONS_STORE)) {
        const store = db.createObjectStore(ARCHIVE_UI_EVALUATIONS_STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("accountLabel", "accountLabel", { unique: false });
        store.createIndex("accountTaskKey", "accountTaskKey", { unique: false });
      }
      if (!db.objectStoreNames.contains(ARCHIVE_UI_CONFIG_STORE)) {
        db.createObjectStore(ARCHIVE_UI_CONFIG_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本地归档设置"));
  });
}

function waitForUiArchiveTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("保存备份文件夹失败"));
    transaction.onabort = () => reject(transaction.error || new Error("保存备份文件夹事务中止"));
  });
}

async function saveBackupDirectoryHandle(handle) {
  if (!boundPageContext) throw new Error("尚未读取当前任务信息，不能保存备份位置");
  const db = await openArchiveUiDb();
  try {
    const transaction = db.transaction(ARCHIVE_UI_CONFIG_STORE, "readwrite");
    transaction.objectStore(ARCHIVE_UI_CONFIG_STORE).put({
      key: backupDirectoryConfigKey(boundPageContext),
      handle,
      name: handle.name || "已选文件夹",
      taskScope: taskScopeKey(boundPageContext),
      updatedAt: Date.now()
    });
    await waitForUiArchiveTransaction(transaction);
    currentBackupDirectoryHandle = handle;
  } finally {
    db.close();
  }
}

async function readBackupDirectoryHandle(identity) {
  const db = await openArchiveUiDb();
  try {
    const stableKey = backupDirectoryConfigKey(identity);
    const candidateKeys = [
      stableKey,
      ...legacyTaskScopeKeys(identity).map((scope) => `${BACKUP_DIRECTORY_CONFIG_KEY}:task:${scope}`)
    ];
    for (const key of [...new Set(candidateKeys)]) {
      const record = await new Promise((resolve, reject) => {
        const request = db.transaction(ARCHIVE_UI_CONFIG_STORE, "readonly").objectStore(ARCHIVE_UI_CONFIG_STORE).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("读取当前任务备份文件夹失败"));
      });
      if (!record?.handle) continue;
      if (key !== stableKey) {
        const transaction = db.transaction(ARCHIVE_UI_CONFIG_STORE, "readwrite");
        transaction.objectStore(ARCHIVE_UI_CONFIG_STORE).put({
          ...record,
          key: stableKey,
          taskScope: taskScopeKey(identity),
          migratedFromLegacyTaskScope: true,
          updatedAt: Date.now()
        });
        await waitForUiArchiveTransaction(transaction);
      }
      return record.handle;
    }
    return null;
  } finally {
    db.close();
  }
}

async function requestPersistentArchiveStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

function paintDiskBackupStatus(status) {
  currentDiskBackupStatus = status || null;
  diskBackupStatusElement.classList.remove("ready", "error");
  if (!elements.diskArchiveEnabled?.checked) {
    diskBackupStatusElement.textContent = "磁盘自动备份：已关闭，不会影响评价运行";
    chooseBackupFolderButton.textContent = "选择自动备份文件夹（可选）";
    return;
  }
  if (!status?.configured) {
    const task = boundPageContext?.taskId || boundPageContext?.taskRoute;
    diskBackupStatusElement.textContent = task
      ? `当前任务 ${task}：尚未选择备份文件夹（不会沿用其他任务的位置）`
      : "磁盘自动备份：等待读取当前任务";
    chooseBackupFolderButton.textContent = "选择自动备份文件夹";
    return;
  }
  if (status.writable === true || (status.permission === "granted" && status.writable !== false)) {
    diskBackupStatusElement.classList.add("ready");
    diskBackupStatusElement.textContent = `磁盘自动备份：可写 · ${status.folderName || "已选文件夹"}`;
    chooseBackupFolderButton.textContent = "更换自动备份文件夹";
    return;
  }
  diskBackupStatusElement.classList.add("error");
  diskBackupStatusElement.textContent = status.error
    ? `磁盘自动备份不可写：${status.error}`
    : `磁盘自动备份需要重新授权：${status.folderName || "已选文件夹"}`;
  chooseBackupFolderButton.textContent = "重新授权或更换文件夹";
}

async function refreshDiskBackupStatus(verify = false) {
  if (!boundPageContext) {
    paintDiskBackupStatus(null);
    return { configured: false, permission: "not_configured", writable: false };
  }
  const response = await chrome.runtime.sendMessage({
    type: verify ? "VERIFY_DISK_BACKUP" : "GET_DISK_BACKUP_STATUS",
    taskIdentity: boundPageContext
  });
  if (!response?.ok) throw new Error(response?.error || "读取磁盘备份状态失败");
  paintDiskBackupStatus(response.status);
  return response.status;
}

async function chooseDiskBackupFolder() {
  try {
    if (!boundPageContext) throw new Error("请先刷新并绑定当前 Papago 任务页");
    chooseBackupFolderButton.disabled = true;
    const explicitlyChangingFolder = currentDiskBackupStatus?.writable === true;
    let handle = explicitlyChangingFolder ? null : currentBackupDirectoryHandle;
    let permission = handle ? currentDiskBackupStatus?.permission : "not_configured";
    statusElement.textContent = explicitlyChangingFolder ? "正在打开文件夹选择窗口……" : "正在恢复当前任务的文件夹权限……";
    if (handle && permission !== "granted" && typeof handle.requestPermission === "function") permission = await handle.requestPermission({ mode: "readwrite" });
    if (!handle || permission !== "granted") {
      if (typeof window.showDirectoryPicker !== "function") throw new Error("当前Edge版本不支持文件夹授权，请先更新Edge");
      const pickerId = `papago-${String(boundPageContext.taskRoute || boundPageContext.taskId || "task").replace(/[^a-z0-9_-]/gi, "-").slice(-24)}`;
      handle = await window.showDirectoryPicker({ mode: "readwrite", id: pickerId });
      permission = typeof handle.queryPermission === "function"
        ? await handle.queryPermission({ mode: "readwrite" }) : "granted";
    }
    if (permission !== "granted" && typeof handle.requestPermission === "function") {
      permission = await handle.requestPermission({ mode: "readwrite" });
    }
    if (permission !== "granted") throw new Error("没有获得该文件夹的读写权限");
    await saveBackupDirectoryHandle(handle);
    const status = await refreshDiskBackupStatus(true);
    if (!status?.writable) throw new Error(status?.error || "文件夹写入测试失败");
    const flushResult = await chrome.runtime.sendMessage({
      type: "FLUSH_TASK_DISK_BACKUP",
      taskIdentity: boundPageContext
    });
    if (!flushResult?.ok) throw new Error(flushResult?.error || "补写浏览器内已有记录失败");
    const recoveredText = flushResult.recovered > 0 ? `；已补写 ${flushResult.recovered} 条此前仅保存在浏览器里的记录` : "";
    statusElement.textContent = `当前任务 ${boundPageContext.taskId || boundPageContext.taskRoute} 的自动备份文件夹已设置：${status.folderName}${recoveredText}。不会改动其他任务的备份位置。`;
    setBadge("备份就绪", "success");
  } catch (error) {
    if (error?.name !== "AbortError") showError(error);
    else statusElement.textContent = "已取消更换文件夹，继续使用原来的备份位置。";
    await refreshDiskBackupStatus().catch(() => {});
  } finally {
    chooseBackupFolderButton.disabled = false;
  }
}

async function ensureDiskBackupReady(settings) {
  if (settings?.diskArchiveEnabled !== true || settings?.requireDiskBackup === false) return;
  const status = await refreshDiskBackupStatus(true);
  if (!status?.configured) throw new Error("请先点击“选择自动备份文件夹”，确保详细记录能写入真实磁盘文件");
  if (status.writable !== true) throw new Error(`备份文件夹写入测试失败：${status.error || "请重新选择文件夹"}`);
}

async function loadAllDetailedArchiveEntries() {
  const entries = [];
  const pageSize = 500;
  while (true) {
    const response = await chrome.runtime.sendMessage({ type: "GET_ARCHIVE_PAGE", offset: entries.length, limit: pageSize });
    if (!response?.ok) throw new Error(response?.error || "读取详细归档失败");
    const page = Array.isArray(response.entries) ? response.entries : [];
    entries.push(...page);
    if (page.length < pageSize) return entries;
  }
}

async function importArchiveEntries(entries) {
  let imported = 0;
  let skipped = 0;
  for (let offset = 0; offset < entries.length; offset += 250) {
    const response = await chrome.runtime.sendMessage({
      type: "IMPORT_ARCHIVE_ENTRIES",
      entries: entries.slice(offset, offset + 250)
    });
    if (!response?.ok) throw new Error(response?.error || "写入浏览器归档失败");
    imported += Number(response.imported) || 0;
    skipped += Number(response.skipped) || 0;
  }
  return { imported, skipped };
}

async function migrateLegacyArchive() {
  if (chrome.runtime.id !== ORIGINAL_EXTENSION_ID) {
    showError(new Error("请打开从下载文件夹加载的原版本，再执行旧归档合并"));
    return;
  }
  migrateLegacyArchiveButton.disabled = true;
  importArchiveJsonButton.disabled = true;
  archiveStatsElement.textContent = "正在读取当前浏览器配置中的 Luna 旧版归档…";
  try {
    let offset = 0;
    let imported = 0;
    let skipped = 0;
    const pageSize = 250;
    while (true) {
      const response = await chrome.runtime.sendMessage(LEGACY_LUNA_EXTENSION_ID, {
        type: "EXPORT_ARCHIVE_PAGE_FOR_MIGRATION", offset, limit: pageSize
      });
      if (!response?.ok) throw new Error(response?.error || "旧版本没有返回归档数据");
      const page = Array.isArray(response.entries) ? response.entries : [];
      if (page.length) {
        const result = await importArchiveEntries(page);
        imported += result.imported;
        skipped += result.skipped;
        offset += page.length;
        archiveStatsElement.textContent = `正在合并旧版归档：已读取 ${offset} 条…`;
      }
      if (page.length < pageSize) break;
    }
    await refreshArchiveSummary();
    archiveStatsElement.textContent += `；本次新增 ${imported} 条，重复跳过 ${skipped} 条。`;
    statusElement.textContent = `旧版归档合并完成：新增 ${imported} 条，重复 ${skipped} 条。可再次点击验证，重复记录不会写入。`;
    setBadge("归档已合并", "success");
  } catch (error) {
    archiveStatsElement.textContent = `旧版归档合并失败：${error?.message || error}`;
    statusElement.textContent = "请确认当前浏览器配置里仍启用了 Luna 旧版本，并已将旧版本也更新到 v0.25.0。也可以使用 JSON 导出/导入作为后备。";
    setBadge("迁移失败", "error");
  } finally {
    migrateLegacyArchiveButton.disabled = false;
    importArchiveJsonButton.disabled = false;
  }
}

function flattenArchivePayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.entries)) return payload.entries;
  if (Array.isArray(payload?.records)) return payload.records;
  const entries = [];
  for (const account of Array.isArray(payload?.accounts) ? payload.accounts : []) {
    for (const task of Array.isArray(account?.tasks) ? account.tasks : []) {
      for (const record of Array.isArray(task?.records) ? task.records : []) {
        entries.push({
          ...record,
          accountLabel: record.accountLabel || account.accountLabel || "默认账号",
          taskId: record.taskId || task.taskId || "未知任务",
          batchCode: record.batchCode || task.batchCode || ""
        });
      }
    }
  }
  return entries;
}

async function importArchiveJsonFile() {
  const file = archiveImportFile.files?.[0];
  archiveImportFile.value = "";
  if (!file) return;
  importArchiveJsonButton.disabled = true;
  migrateLegacyArchiveButton.disabled = true;
  archiveStatsElement.textContent = `正在校验并导入 ${file.name}…`;
  try {
    if (file.size > 80 * 1024 * 1024) throw new Error("备份文件超过80MB，请拆分后导入");
    const payload = JSON.parse(await file.text());
    const entries = flattenArchivePayload(payload);
    if (!entries.length) throw new Error("JSON 中没有找到可导入的评价记录");
    const result = await importArchiveEntries(entries);
    await refreshArchiveSummary();
    archiveStatsElement.textContent += `；本次新增 ${result.imported} 条，重复跳过 ${result.skipped} 条。`;
    statusElement.textContent = `归档导入完成：新增 ${result.imported} 条，重复 ${result.skipped} 条。`;
    setBadge("导入完成", "success");
  } catch (error) {
    archiveStatsElement.textContent = `导入失败：${error?.message || error}`;
    setBadge("导入失败", "error");
  } finally {
    importArchiveJsonButton.disabled = false;
    migrateLegacyArchiveButton.disabled = chrome.runtime.id !== ORIGINAL_EXTENSION_ID;
  }
}

function groupedArchivePayload(entries) {
  const accounts = new Map();
  const sorted = [...entries].sort((a, b) =>
    String(a.accountLabel || "").localeCompare(String(b.accountLabel || ""), "zh-CN") ||
    String(a.taskId || "").localeCompare(String(b.taskId || ""), "zh-CN") ||
    Number(a.itemIndex || 0) - Number(b.itemIndex || 0) ||
    Number(a.createdAt || 0) - Number(b.createdAt || 0));
  for (const entry of sorted) {
    const accountLabel = entry.accountLabel || "默认账号";
    const taskId = entry.taskId || "未知任务";
    if (!accounts.has(accountLabel)) accounts.set(accountLabel, new Map());
    const tasks = accounts.get(accountLabel);
    if (!tasks.has(taskId)) tasks.set(taskId, []);
    tasks.get(taskId).push(entry);
  }
  return {
    schema: "papago-evaluation-archive-v1",
    exportedAt: new Date().toISOString(),
    total: entries.length,
    accounts: [...accounts.entries()].map(([accountLabel, tasks]) => ({
      accountLabel,
      tasks: [...tasks.entries()].map(([taskId, records]) => ({
        taskId,
        batchCode: records.find((entry) => entry.batchCode)?.batchCode || "",
        records
      }))
    }))
  };
}

function escapeArchiveHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function detailedArchiveHtml(payload) {
  const sections = payload.accounts.map((account) => {
    const tasks = account.tasks.map((task) => {
      const rows = task.records.map((entry) => `<tr>
        <td>${escapeArchiveHtml(entry.itemIndex || "-")}</td>
        <td>${escapeArchiveHtml(directionLabel(entry.languagePair) || entry.languagePair || "-")}</td>
        <td>${escapeArchiveHtml(entry.translationScore)}</td>
        <td>${escapeArchiveHtml(entry.renderingScore)}</td>
        <td>${escapeArchiveHtml(Number(entry.confidence || 0).toFixed(2))}</td>
        <td>${escapeArchiveHtml(entry.sourceText)}</td>
        <td>${escapeArchiveHtml(entry.targetText)}</td>
        <td>${escapeArchiveHtml(entry.commentZh)}</td>
        <td>${escapeArchiveHtml(entry.commentKo)}</td>
        <td>${escapeArchiveHtml(entry.reason)}</td>
        <td>${escapeArchiveHtml(entry.model)}</td>
        <td>${escapeArchiveHtml(new Date(entry.createdAt).toLocaleString("zh-CN", { hour12: false }))}</td>
      </tr>`).join("");
      return `<section><h2>任务 ${escapeArchiveHtml(task.taskId)}${task.batchCode ? ` · ${escapeArchiveHtml(task.batchCode)}` : ""}</h2>
        <p>记录数：${task.records.length}</p><div class="table-wrap"><table><thead><tr><th>页码</th><th>方向</th><th>翻译</th><th>渲染</th><th>置信度</th><th>原文</th><th>译文</th><th>中文评价</th><th>韩文评价</th><th>判断依据</th><th>模型</th><th>时间</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }).join("");
    return `<article><h1>账号：${escapeArchiveHtml(account.accountLabel)}</h1>${tasks}</article>`;
  }).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Papago翻译评价详细归档</title><style>body{font-family:Segoe UI,Microsoft YaHei,sans-serif;margin:24px;color:#182230}h1{margin-top:32px;border-bottom:2px solid #175cd3;padding-bottom:8px}h2{margin:24px 0 6px;font-size:17px}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #d0d5dd;padding:7px;vertical-align:top;white-space:pre-wrap;min-width:70px}th{background:#f2f4f7;position:sticky;top:0}td:nth-child(6),td:nth-child(7),td:nth-child(8),td:nth-child(9),td:nth-child(10){min-width:180px}p{color:#667085}</style></head><body><h1>Papago 翻译评价详细归档</h1><p>导出时间：${escapeArchiveHtml(new Date(payload.exportedAt).toLocaleString("zh-CN", { hour12: false }))} · 共 ${payload.total} 条</p>${sections}</body></html>`;
}

function downloadArchiveFile(filename, content, mimeType) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function exportDetailedArchive(format) {
  exportArchiveHtmlButton.disabled = true;
  exportArchiveJsonButton.disabled = true;
  archiveStatsElement.textContent = "正在整理本地详细归档…";
  try {
    const entries = await loadAllDetailedArchiveEntries();
    if (!entries.length) throw new Error("目前还没有可导出的详细归档");
    const payload = groupedArchivePayload(entries);
    const date = new Date().toISOString().slice(0, 10);
    if (format === "html") downloadArchiveFile(`Papago评价审查报告_${date}.html`, detailedArchiveHtml(payload), "text/html;charset=utf-8");
    else downloadArchiveFile(`Papago评价详细归档_${date}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
    archiveStatsElement.textContent = `已导出 ${entries.length} 条；浏览器内长期归档仍保留。`;
  } catch (error) {
    archiveStatsElement.textContent = `导出失败：${error?.message || error}`;
  } finally {
    exportArchiveHtmlButton.disabled = false;
    exportArchiveJsonButton.disabled = false;
  }
}

function renderApiUsageStats(stats) {
  if (!stats || typeof stats !== "object") {
    apiUsageStatsElement.textContent = "API缓存统计：暂无本机记录";
    return;
  }
  const hit = Number(stats.hitTokens) || 0;
  const miss = Number(stats.missTokens) || 0;
  const denominator = hit + miss;
  const rate = denominator ? `${(hit / denominator * 100).toFixed(1)}%` : "暂无数据";
  apiUsageStatsElement.textContent = `本机API：${Number(stats.calls) || 0}次 · 平台前缀命中 ${rate} · 本地免调用 ${Number(stats.localCacheHits) || 0}次`;
}

async function refreshHistory() {
  const stored = await chrome.storage.local.get("evaluationHistory");
  evaluationHistory = Array.isArray(stored.evaluationHistory) ? stored.evaluationHistory.slice(0, 50) : [];
  renderHistory();
}

function renderHistory() {
  historyList.replaceChildren();
  const scopedHistory = Number.isInteger(evaluationTabId)
    ? evaluationHistory.filter((entry) => entry.tabId === evaluationTabId)
    : [];
  if (!scopedHistory.length) {
    toggleHistoryButton.hidden = true;
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = Number.isInteger(evaluationTabId) ? "当前标签页还没有完成的评价。" : "尚未绑定评价标签页。";
    historyList.append(empty);
    return;
  }
  const visibleHistory = historyExpanded ? scopedHistory : scopedHistory.slice(0, 2);
  for (const entry of visibleHistory) {
    const item = document.createElement("article");
    item.className = "history-item";
    const head = document.createElement("div");
    head.className = "history-item-head";
    const title = document.createElement("span");
    const direction = directionLabel(entry.languagePair);
    title.textContent = `${entry.itemIndex ? `第 ${entry.itemIndex} 张` : "已完成评价"} · ${direction || "方向未记录"}`;
    const scores = document.createElement("span");
    scores.className = "history-scores";
    scores.textContent = `翻译 ${entry.translationScore} · 渲染 ${entry.renderingScore} · ${entry.confidence.toFixed(2)}`;
    head.append(title, scores);
    const comments = [];
    const detail = document.createElement("p");
    detail.className = "history-comment ko";
    detail.textContent = `模型：${entry.model || "旧记录未保存"}${entry.evaluationState ? ` · 状态：${entry.evaluationState}` : ""}\n原文：${entry.sourceText || "未记录"}\n译文：${entry.targetText || "未记录"}${entry.reason ? `\n依据：${entry.reason}` : ""}${entry.captureInfo ? `\n取图：${entry.captureInfo}` : ""}`;
    comments.push(detail);
    if (entry.commentZh) {
      const zh = document.createElement("p");
      zh.className = "history-comment";
      zh.textContent = `中：${entry.commentZh}`;
      comments.push(zh);
    }
    if (entry.commentKo) {
      const ko = document.createElement("p");
      ko.className = "history-comment ko";
      ko.textContent = `韩：${entry.commentKo}`;
      comments.push(ko);
    }
    if (!comments.length) {
      const none = document.createElement("p");
      none.className = "history-comment ko";
      none.textContent = "本条未生成评论";
      comments.push(none);
    }
    const time = document.createElement("div");
    time.className = "history-time";
    time.textContent = new Date(entry.createdAt).toLocaleString("zh-CN", { hour12: false });
    item.append(head, ...comments, time);
    historyList.append(item);
  }
  toggleHistoryButton.hidden = scopedHistory.length <= 2;
  toggleHistoryButton.textContent = historyExpanded ? "收起记录" : `展开其余 ${scopedHistory.length - 2} 条`;
}

function directionLabel(value) {
  if (value === "zh-ja") return "中→日";
  if (value === "ja-zh") return "日→中";
  if (value === "en-ja") return "英→日";
  if (value === "ja-en") return "日→英";
  if (value === "en-zh") return "英→中";
  if (value === "zh-en") return "中→英";
  return "";
}

function clearResult() {
  document.getElementById("resultLabel").hidden = true;
  document.getElementById("scores").hidden = true;
  document.getElementById("translationScore").textContent = "-";
  document.getElementById("renderingScore").textContent = "-";
  document.getElementById("confidence").textContent = "-";
  document.getElementById("comment").textContent = "";
  document.getElementById("chineseLabel").hidden = true;
  document.getElementById("koreanLabel").hidden = true;
  document.getElementById("koreanComment").textContent = "";
  const recognized = document.getElementById("recognizedText");
  recognized.hidden = true;
  recognized.textContent = "";
}

function setBadge(text, className) {
  badge.textContent = text;
  badge.className = `badge ${className}`;
}
