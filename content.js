const CONTENT_BUILD_VERSION = "0.25.0";
let runState = { running: false, stopRequested: false };
let singleRunning = false;
let runtimeView = { state: "idle", message: "当前标签页待机", result: null, pagePath: location.pathname };
let useExtensionTimers = false;
const pageImageCache = new Map();
const MAX_PAGE_IMAGE_CACHE_ENTRIES = 12;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleCommand(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

async function handleCommand(message) {
  if (message?.type === "PING") return { ok: true, page: location.href };
  if (message?.type === "GET_RUNTIME_STATE") {
    const samePage = runtimeView.pagePath === location.pathname;
    return {
      ok: true,
      running: Boolean(runState.running || singleRunning),
      state: samePage ? runtimeView.state : "idle",
      message: samePage ? runtimeView.message : "已切换到新任务页，未沿用上一任务状态",
      result: samePage ? runtimeView.result : null,
      page: location.href
    };
  }
  if (message?.type === "GET_PAGE_CONTEXT") {
    const languagePair = requirePageLanguagePair();
    return { ok: true, buildVersion: CONTENT_BUILD_VERSION, languagePair, itemIndex: readProgress().current, page: location.href, ...currentArchiveTaskIdentity() };
  }
  if (message?.type === "ANALYZE_ONCE") {
    if (runState.running || singleRunning) throw new Error("当前评价尚未完成，请勿重复启动");
    runState.stopRequested = false;
    singleRunning = true;
    try {
      const settings = settingsForCurrentPage(message.settings || {});
      await prepareBackgroundCapture(settings);
      return await runOne({ advance: false, settings, preserveViewer: true });
    } finally {
      singleRunning = false;
      await releaseBackgroundCapture();
    }
  }
  if (message?.type === "START_AUTO") {
    if (runState.running || singleRunning) return { ok: true, alreadyRunning: true };
    const settings = settingsForCurrentPage(message.settings || {});
    runState = { running: true, stopRequested: false };
    autoLoop(settings)
      .catch((error) => {
        emitStatus("error", error?.message || String(error));
        runState.running = false;
      })
      .finally(async () => {
        await releaseBackgroundCapture();
      });
    return { ok: true };
  }
  if (message?.type === "STOP_AUTO") {
    runState.stopRequested = true;
    return { ok: true };
  }
  throw new Error("未知操作");
}


async function autoLoop(settings) {
  const maxItems = clampInt(settings.maxItems, 1, 7500, 100);
  const delayMs = clampInt(settings.delayMs, 300, 15000, 1200);
  const threshold = clampNumber(settings.confidenceThreshold, 0, 1, 0.72);
  let completed = 0;
  let recoveryCount = 0;
  await prepareBackgroundCapture(settings);
  emitStatus("running", "连续评价已开始");

  while (!runState.stopRequested && completed < maxItems) {
    let outcome;
    try {
      outcome = await runOne({ advance: false, settings, preserveViewer: false });
    } catch (error) {
      if (runState.stopRequested) break;
      if (!isRecoverableRunError(error)) throw error;
      recoveryCount += 1;
      const delay = Math.min(15000, 1200 + recoveryCount * 900);
      emitStatus("recovering", `当前张遇到临时取图或页面连接问题，正在自动恢复（第 ${recoveryCount} 次，${Math.round(delay / 1000)} 秒后重试）`);
      await recoverBackgroundCapture(settings);
      await sleep(delay);
      continue;
    }
    recoveryCount = 0;
    if (!outcome.filled) {
      emitStatus("paused", outcome.pauseReason || "识别证据不足，已暂停且没有填写", outcome.result);
      break;
    }
    completed += 1;
    await emitStatus("scored", `已完成任务第 ${outcome.result.item_index || "当前"} 张（本次第 ${completed} 张）`, outcome.result);

    if (settings.diskArchiveEnabled === true && settings.requireDiskBackup !== false && outcome.result.disk_backup_saved !== true) {
      emitStatus("paused", `当前评价已填入且保存在浏览器内，但磁盘备份失败：${outcome.result.disk_backup_error || "备份目录不可写"}。已暂停，避免继续产生未落盘记录。`, outcome.result);
      break;
    }

    const shouldPause = !outcome.result.auto_fallback && settings.pauseOnLowConfidence !== false &&
      (outcome.result.needs_review || outcome.result.confidence < threshold);
    if (shouldPause) {
      emitStatus("paused", `置信度 ${outcome.result.confidence.toFixed(2)}，已暂停，请人工核对`, outcome.result);
      break;
    }
    if (settings.autoAdvance === false) {
      emitStatus("paused", "已完成当前张，自动切换已关闭", outcome.result);
      break;
    }

    const before = { itemKey: currentItemKey(), visualState: outcome.visualState };
    await clickNextSafely();
    emitStatus("loading", "已切换，正在等待两侧新图片加载完成");
    let transitionRecoveryCount = 0;
    while (!runState.stopRequested) {
      try {
        await waitForNextItemReady(before, settings.backgroundCapture === true ? 12000 : 18000, settings.backgroundCapture === true);
        break;
      } catch (error) {
        if (!isRecoverableRunError(error)) throw error;
        transitionRecoveryCount += 1;
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          emitStatus("recovering", `网络已断开，当前评分已保留；网络恢复后会自动重新触发下一张（等待第 ${transitionRecoveryCount} 轮）`);
          await waitForNetworkRecovery();
          await recoverBackgroundCapture(settings);
          continue;
        }
        const stillSameItem = currentItemKey() === before.itemKey;
        if (stillSameItem) {
          emitStatus("recovering", `当前评分已填写，但网页没有切换；正在重新确认并触发下一张（第 ${transitionRecoveryCount} 次）`);
          try {
            reapplyCurrentEvaluation(outcome.result);
            await sleep(320);
            await clickNextSafely({
              useBackground: settings.backgroundCapture === true,
              forceBackground: settings.backgroundCapture === true && transitionRecoveryCount >= 3
            });
          } catch (clickError) {
            emitStatus("recovering", `下一张按钮暂时没有响应，保持当前评分并继续恢复：${clickError?.message || clickError}`);
          }
        } else {
          emitStatus("recovering", `页码已变化，正在等待两侧新图片稳定（第 ${transitionRecoveryCount} 次）`);
        }
        await recoverBackgroundCapture(settings);
        await sleep(Math.min(8000, 900 + transitionRecoveryCount * 900));
      }
    }
    if (runState.stopRequested) break;
    await sleep(Math.max(delayMs, 650));
  }

  runState.running = false;
  if (runState.stopRequested) emitStatus("stopped", "已停止，当前已填写内容不会撤销");
  else if (completed >= maxItems) emitStatus("done", `达到本次上限 ${maxItems} 张，已停止`);
}

async function runOne({ advance = false, settings = {}, preserveViewer = false } = {}) {
  if (!location.hostname.endsWith("papago-pro.naver.com")) throw new Error("请先打开 Papago Pro 评价页面");
  const heading = findHeading("translation");
  if (!heading) throw new Error("未找到翻译评分区域，请确认当前页面已加载完成");
  const languagePair = normalizeLanguagePair(settings.languagePair);
  assertPageLanguagePair(languagePair);
  const runDetails = {
    languagePair,
    model: settings.model || "deepseek-flash",
    qualityMode: settings.qualityMode || "quality",
    accountLabel: normalizeAccountLabel(settings.accountLabel),
    browserArchiveEnabled: settings.browserArchiveEnabled !== false,
    diskArchiveEnabled: settings.diskArchiveEnabled === true,
    requireDiskBackup: settings.requireDiskBackup !== false,
    ...currentArchiveTaskIdentity()
  };
  const complete = (result, details) => finishEvaluation(result, { ...details, runDetails });
  const itemKeyAtStart = currentItemKey();
  const progressAtStart = readProgress().current;

  if (!preserveViewer) {
    resetViewerZooms(heading);
    await sleep(350);
  }
  await positionForCapture(heading);
  const panes = detectImagePanes(heading);
  const [sourceCandidate, targetCandidate] = await Promise.all([
    extractPaneOriginal(panes.source, "left", heading).catch(() => null),
    extractPaneOriginal(panes.target, "right", heading).catch(() => null)
  ]);
  const directImagesReady = Boolean(sourceCandidate?.image && targetCandidate?.image);
  let capture = await chrome.runtime.sendMessage({
    type: "CAPTURE_VISIBLE",
    backgroundCapture: settings.backgroundCapture === true,
    preferDirectWhenBackground: directImagesReady
  }).catch((error) => ({ ok: false, error: error?.message || String(error) }));
  if (!capture?.ok && !directImagesReady && capture?.domFallback) {
    capture = await chrome.runtime.sendMessage({
      type: "CAPTURE_VISIBLE", backgroundCapture: settings.backgroundCapture === true,
      preferDirectWhenBackground: false
    }).catch((error) => ({ ok: false, error: error?.message || String(error) }));
  }
  if (!capture?.ok && !directImagesReady) throw new Error(capture?.error || "页面截图和网页原图均读取失败");

  let sourceViewRect;
  let targetViewRect;
  let sourceFallback;
  let targetFallback;
  if (capture?.ok && capture.image) {
    [sourceViewRect, targetViewRect] = await Promise.all([
      refineVisibleMediaRect(capture.image, panes.source, sourceCandidate?.displayRect),
      refineVisibleMediaRect(capture.image, panes.target, targetCandidate?.displayRect)
    ]);
    [sourceFallback, targetFallback] = await Promise.all([
      cropScreenshot(capture.image, sourceViewRect),
      cropScreenshot(capture.image, targetViewRect)
    ]);
  } else {
    sourceViewRect = { ...(sourceCandidate?.displayRect || plainRect(panes.source)), refined: false };
    targetViewRect = { ...(targetCandidate?.displayRect || plainRect(panes.target)), refined: false };
    sourceFallback = sourceCandidate.image;
    targetFallback = targetCandidate.image;
    capture = { ...capture, mode: "dom-direct" };
  }
  // Keep the state in the same source-image coordinate system in foreground
  // and background mode, so a compositor failure cannot create a false stall.
  const sourceStateImage = sourceCandidate?.image || sourceFallback;
  const targetStateImage = targetCandidate?.image || targetFallback;
  const visualState = paneVisualState(sourceStateImage, targetStateImage);
  // The debugger screenshot can be temporarily stale or unavailable while
  // Papago swaps the two panes. Keep a lightweight DOM/media identity as an
  // independent signal so the next-item guard can still observe the update.
  Object.assign(visualState, nativePaneVisualState(panes));
  let highlightDetection = capture?.ok && capture.image
    ? await detectHighlightRegion(capture.image, sourceViewRect).catch(() => null)
    : null;
  if (!highlightDetection) {
    highlightDetection = detectDomHighlightRegion(panes.source, sourceViewRect);
  }
  if (!highlightDetection && sourceCandidate?.image) {
    highlightDetection = await detectHighlightInImage(sourceCandidate.image, sourceViewRect).catch(() => null);
  }
  // If DOM/direct-image detection still cannot see the selection, make one
  // non-fatal debugger attempt. Failure here must never stop the run.
  if (!highlightDetection && capture?.mode === "dom-direct" && settings.backgroundCapture === true) {
    const screenshotFallback = await chrome.runtime.sendMessage({
      type: "CAPTURE_VISIBLE", backgroundCapture: true, preferDirectWhenBackground: false
    }).catch(() => null);
    if (screenshotFallback?.ok && screenshotFallback.image) {
      const screenshotSourceRect = await refineVisibleMediaRect(
        screenshotFallback.image, panes.source, sourceCandidate?.displayRect
      ).catch(() => sourceViewRect);
      const screenshotSource = await cropScreenshot(screenshotFallback.image, screenshotSourceRect).catch(() => null);
      const screenshotDetection = await detectHighlightRegion(
        screenshotFallback.image, screenshotSourceRect
      ).catch(() => null);
      if (screenshotSource && screenshotDetection) {
        capture = screenshotFallback;
        sourceViewRect = screenshotSourceRect;
        sourceFallback = screenshotSource;
        highlightDetection = screenshotDetection;
      }
    }
  }
  if (capture?.mode === "dom-direct" && highlightDetection?.mode === "blue-frame-dom") {
    sourceFallback = await annotateHighlightOnImage(
      sourceFallback, highlightDetection, sourceViewRect
    ).catch(() => sourceFallback);
  }
  const targetMaster = targetCandidate?.image || targetFallback;
  const [sourceOverview, targetOverview] = await Promise.all([
    resizeForModel(sourceFallback, 1800),
    resizeForModel(targetMaster, 2600)
  ]);
  let focus = highlightDetection
    ? normalizedFocusRect(highlightDetection.rect, sourceViewRect, highlightDetection.confidence)
    : null;
  // A color-only fallback is often the wrong product/button region. Do not bias the model with it.
  let sourceGuideHint = focus && String(highlightDetection?.mode || "").startsWith("blue-frame") && highlightDetection.confidence >= 0.65
    ? await upscaleForModel(await cropNormalized(sourceFallback, focus), 900, 8) : "";
  const needsModelSourceLocation = !highlightDetection || !focus || !String(highlightDetection.mode || "").startsWith("blue-frame") ||
    highlightDetection.confidence < 0.88 || highlightDetection.separation < 1.25 || highlightDetection.candidateCount > 3;
  let sourceLocationRounds = 0;
  let sourceLocateError = "";
  if (needsModelSourceLocation) {
    const sourceTiles = await createOverlappingTiles(sourceFallback);
    for (const level of [0, 1, 2]) {
      assertCurrentTask(itemKeyAtStart);
      emitStatus("analyzing", `原文高亮定位第 ${level + 1} 轮${level ? "（已切换思考并使用分块）" : ""}`);
      const response = await chrome.runtime.sendMessage({
        type: "LOCATE_SOURCE_BLOCK", sourceImage: sourceOverview, sourceHint: sourceGuideHint,
        tiles: level ? sourceTiles : [], recoveryLevel: level,
        requestSettings: modelRequestSettings(settings)
      });
      sourceLocationRounds = level + 1;
      assertCurrentTask(itemKeyAtStart);
      if (response?.ok && response.location?.box) {
        highlightDetection = detectionFromBox(response.location.box, sourceViewRect, response.location.confidence, "model-located");
        focus = focusFromBox(response.location.box, 0.42, 0.70);
        break;
      }
      sourceLocateError = response?.error || "未找到高亮块";
      if (isFatalApiError(sourceLocateError)) throw new Error(sourceLocateError);
    }
  }
  if (!focus || !highlightDetection) {
    const fallback = makeFallbackResult("uncertain", settings, `多轮原文高亮定位仍失败：${sourceLocateError || "未找到高亮块"}`);
    return complete(fallback, { progressAtStart, itemKeyAtStart, visualState, advance, captureInfo: "原文多轮定位失败，使用3/3中间档自动兜底" });
  }
  const tightFocus = boxFromDetection(highlightDetection, sourceViewRect);
  const sourceGuideRaw = await cropNormalized(sourceFallback, focusFromBox(tightFocus, 0.28, 0.50));
  const sourceDetail = await upscaleForModel(sourceGuideRaw, 1200, 12);
  let sourceEnhanced = await enhanceTextImage(sourceGuideRaw);
  if (sourceCandidate?.image) {
    const highResolutionCrop = await cropNormalized(sourceCandidate.image, focusFromBox(tightFocus, 0.38, 0.65)).catch(() => null);
    if (highResolutionCrop) sourceEnhanced = await enhanceTextImage(highResolutionCrop);
  }
  const sourceDetailMode = `页面高亮紧裁近景（定位${sourceLocationRounds ? `经${sourceLocationRounds}轮视觉复核` : "采用可靠蓝框"}）；增强图只在复核轮使用`;

  assertCurrentTask(itemKeyAtStart);
  const targetTiles = await createOverlappingTiles(targetMaster);
  let located = null;
  let targetLocateError = "";
  let targetLocationRounds = 0;
  let specialStateCandidate = null;
  for (const level of [0, 1, 2]) {
    emitStatus("analyzing", `译文独立定位第 ${level + 1} 轮${level ? "（已切换思考并使用重叠分块）" : ""}`);
    const response = await chrome.runtime.sendMessage({
      type: "LOCATE_TARGET_BLOCK", sourceOverview, sourceGuide: sourceDetail,
      targetImage: targetOverview, tiles: level ? targetTiles : [], recoveryLevel: level,
      requestSettings: modelRequestSettings(settings)
    });
    targetLocationRounds = level + 1;
    assertCurrentTask(itemKeyAtStart);
    if (response?.ok && response.location) {
      const candidate = response.location;
      if (!candidate.found && ["no_output", "page_error"].includes(candidate.state)) {
        if (specialStateCandidate?.state === candidate.state) {
          located = candidate;
          break;
        }
        specialStateCandidate = candidate;
        targetLocateError = `模型初步判断为${candidate.state}，正在进行第二轮独立确认`;
        continue;
      }
      located = candidate;
      break;
    }
    targetLocateError = response?.error || "未找到对应译文";
    if (isFatalApiError(targetLocateError)) throw new Error(targetLocateError);
  }
  if (located && !located.found && ["no_output", "page_error"].includes(located.state)) {
    const fallback = makeFallbackResult("na", settings, located.state === "page_error" ? "译图显示错误或无结果页面" : "译图没有生成可评价结果");
    return complete(fallback, { progressAtStart, itemKeyAtStart, visualState, advance, captureInfo: `译图定位判定为${located.state}，按规则自动填写NA/NA` });
  }
  if (located?.found && located.state === "untranslated") {
    const names = languagePairNames(languagePair);
    const fallback = makeFallbackResult("untranslated", settings, `译文定位阶段已确认对应位置仍保留${names.source}，没有${names.target}译文`);
    return complete(fallback, { progressAtStart, itemKeyAtStart, visualState, advance,
      captureInfo: "译文定位确认未翻译，按规则自动填写翻译1、渲染NA" });
  }
  if (!located?.box) {
    const fallback = makeFallbackResult("uncertain", settings,
      `译文多轮定位仍失败：${targetLocateError || "无法确认对应区域"}`);
    return complete(fallback, { progressAtStart, itemKeyAtStart, visualState, advance,
      captureInfo: "译文多轮定位失败，使用3/3中间档自动兜底；未经双轮确认不会误填NA" });
  }
  const targetFocus = targetFocusFromBox(located.box);
  const targetCrop = await cropNormalized(targetMaster, targetFocus);
  const targetDetail = await resizeForModel(await upscaleForModel(targetCrop, 1200, 12), 2200);
  const targetEnhanced = await enhanceTextImage(targetCrop);
  const targetDetailMode = targetCandidate?.image
    ? `译图经${targetLocationRounds}轮独立定位后从网页原始图裁出的文字近景`
    : `译图经${targetLocationRounds}轮独立定位后的页面截图近景`;
  await chrome.runtime.sendMessage({
    type: "EVALUATOR_PREVIEW", itemIndex: progressAtStart,
    pagePath: location.pathname,
    targetImage: await resizeForModel(targetDetail, 1000),
    label: `第 ${progressAtStart || "当前"} 张 · 实际送评的译文近景${targetCandidate?.image ? "（原始图片裁剪）" : "（截图裁剪）"}`
  }).catch(() => null);
  const imageModes = {
    sourceOverview: "页面当前完整原图视图（保留高亮框和实际显示效果）",
    targetOverview: "用于定位的完整译图；图4直接从这张图的原始分辨率裁剪",
    sourceDetail: sourceDetailMode,
    targetDetail: targetDetailMode,
    focus: focus ? "已定位高亮局部" : "未定位高亮，局部图退化为完整图片",
    focusConfidence: highlightDetection?.confidence || 0
  };
  assertCurrentTask(itemKeyAtStart);
  const cacheKey = `${chrome.runtime.getManifest().version}:${languagePair}:${settings.model || "deepseek-flash"}:${settings.qualityMode || "quality"}:${settings.commentMode || "bilingual"}:${itemKeyAtStart}:${quickHash(sourceOverview)}:${quickHash(targetOverview)}:${quickHash(sourceDetail)}:${quickHash(targetDetail)}`;

  const context = `${collectContext(highlightDetection)}；译文定位初判状态：${located.state || "normal"}`;
  const detectorStatus = String(highlightDetection?.mode || "").startsWith("blue-frame")
    ? `蓝框结构定位（框完整度 ${Number(highlightDetection.frameQuality || 0).toFixed(2)}）`
    : "颜色回退定位";
  const boundaryStatus = sourceViewRect.refined ? "已校准真实图片边界" : "使用网页图片边界";
  const captureStatus = capture.mode === "background-debugger" ? "后台指定标签页取图"
    : capture.mode === "dom-direct" ? "后台直接读取网页原图（不依赖窗口可见）"
      : "前台可见页取图";
  const detailStatus = `${captureStatus}；${detectorStatus}；${boundaryStatus}；${sourceDetailMode}；${targetDetailMode}`;
  emitStatus("analyzing", `正在核对第 ${progressAtStart || "当前"} 张（${detailStatus}）`);
  const threshold = clampNumber(settings.confidenceThreshold, 0, 1, 0.72);
  let evaluated = null;
  let lastResult = null;
  let lastReasons = [];
  let evaluationError = "";
  for (const level of [0, 1, 2]) {
    emitStatus("analyzing", `评分第 ${level + 1} 轮${level ? `（自动切换${level === 1 ? "轻度" : "深度"}思考复核）` : ""}`);
    evaluated = await chrome.runtime.sendMessage({
      type: "EVALUATE_IMAGES", sourceOverview, targetOverview, sourceDetail, targetDetail,
      sourceEnhanced, targetEnhanced, recoveryLevel: level, imageModes,
      cacheKey: `${cacheKey}:r${level}`, context,
      requestSettings: modelRequestSettings(settings)
    });
    assertCurrentTask(itemKeyAtStart);
    if (!evaluated?.ok) {
      evaluationError = evaluated?.error || "评分请求失败";
      if (isFatalApiError(evaluationError)) throw new Error(evaluationError);
      continue;
    }
    lastResult = evaluated.result;
    lastReasons = assessReliability(lastResult, { focusFound: true });
    if (lastResult.needs_review) lastReasons.push(lastResult.reason || "模型要求复核");
    if (settings.pauseOnLowConfidence !== false && lastResult.confidence < threshold) lastReasons.push(`置信度低于${threshold.toFixed(2)}`);
    if (!lastReasons.length || ["untranslated", "no_output", "page_error"].includes(lastResult.evaluation_state)) break;
  }
  let result = lastResult;
  if (!result || lastReasons.length || result.evaluation_state === "unreadable") {
    const fallbackKind = located.state === "untranslated" ? "untranslated"
      : "uncertain";
    result = makeFallbackResult(fallbackKind, settings,
      result?.reason || evaluationError || lastReasons.join("；") || "多轮复核仍无法确认图文");
  }
  return complete(result, { progressAtStart, itemKeyAtStart, visualState, advance,
    usage: evaluated?.usage || null, captureInfo: `${detailStatus}；评分最多经过3轮自动复核${result.auto_fallback ? "；已自动兜底" : ""}` });
}

async function finishEvaluation(result, { progressAtStart, itemKeyAtStart, visualState, advance, usage = null, captureInfo = "", runDetails = {} }) {
  assertCurrentTask(itemKeyAtStart);
  result.capture_info = captureInfo;
  result.item_index = progressAtStart || null;
  result.item_key = `${location.pathname}:${progressAtStart || itemKeyAtStart}`;
  result.language_pair = normalizeLanguagePair(runDetails.languagePair);
  result.model = runDetails.model || "deepseek-flash";
  result.quality_mode = runDetails.qualityMode || "quality";
  result.page_path = location.pathname;
  result.account_label = normalizeAccountLabel(runDetails.accountLabel);
  result.task_id = runDetails.taskId || location.pathname;
  result.batch_code = runDetails.batchCode || "";
  result.task_route = runDetails.taskRoute || "";
  await fillEvaluation(result);
  const saved = await chrome.runtime.sendMessage({
    type: "SAVE_HISTORY_ENTRY", result,
    archiveOptions: {
      browserArchiveEnabled: runDetails.browserArchiveEnabled !== false,
      diskArchiveEnabled: runDetails.diskArchiveEnabled === true
    }
  }).catch((error) => ({ archiveSaved: false, archiveError: error?.message || String(error) }));
  result.archive_saved = saved?.archiveSaved === true;
  result.archive_error = saved?.archiveError || "";
  result.disk_backup_saved = saved?.diskBackupSaved === true;
  result.disk_backup_status = saved?.diskBackupStatus || "unknown";
  result.disk_backup_error = saved?.diskBackupError || "";
  result.disk_backup_path = saved?.diskBackupPath || "";
  if (advance) await clickNextSafely();
  return { ok: true, filled: true, result, usage, visualState };
}

function assertCurrentTask(itemKey) {
  if (currentItemKey() !== itemKey) throw new Error("任务已切换，丢弃上一个任务的结果，未填写");
  if ((runState.running || singleRunning) && runState.stopRequested) throw new Error("已停止，未填写正在返回的结果");
}

function focusFromBox(box, padXRatio = 0.18, padYRatio = 0.22) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) throw new Error("译文坐标无效");
  const [left, top, right, bottom] = box;
  if (left < 0 || top < 0 || right > 1000 || bottom > 1000 || right <= left || bottom <= top) throw new Error("译文坐标越界");
  const padX = Math.max(4, (right - left) * padXRatio);
  const padY = Math.max(4, (bottom - top) * padYRatio);
  const x = Math.max(0, left - padX);
  const y = Math.max(0, top - padY);
  return { left: x / 1000, top: y / 1000,
    width: (Math.min(1000, right + padX) - x) / 1000,
    height: (Math.min(1000, bottom + padY) - y) / 1000 };
}

function targetFocusFromBox(box) {
  // Target coordinates belong to the full target image, never the source pane or phone inset.
  return focusFromBox(box, 0.18, 0.22);
}

function detectionFromBox(box, reference, confidence = 0.8, mode = "model-located") {
  const focus = focusFromBox(box, 0, 0);
  return {
    rect: {
      left: reference.left + focus.left * reference.width,
      top: reference.top + focus.top * reference.height,
      width: focus.width * reference.width,
      height: focus.height * reference.height
    },
    confidence: clampNumber(confidence, 0, 1, 0.8),
    mode,
    frameQuality: mode === "blue-frame" ? 1 : 0,
    candidateCount: 1,
    separation: 3
  };
}

function boxFromDetection(detection, reference) {
  const rect = detection?.rect;
  if (!rect || !reference?.width || !reference?.height) throw new Error("高亮定位坐标无效");
  const left = Math.max(0, Math.min(1000, ((rect.left - reference.left) / reference.width) * 1000));
  const top = Math.max(0, Math.min(1000, ((rect.top - reference.top) / reference.height) * 1000));
  const right = Math.max(left + 1, Math.min(1000, ((rect.left + rect.width - reference.left) / reference.width) * 1000));
  const bottom = Math.max(top + 1, Math.min(1000, ((rect.top + rect.height - reference.top) / reference.height) * 1000));
  return [left, top, right, bottom];
}

async function createOverlappingTiles(dataUrl) {
  const boxes = [
    [0, 0, 600, 600], [400, 0, 1000, 600],
    [0, 400, 600, 1000], [400, 400, 1000, 1000]
  ];
  return Promise.all(boxes.map(async (box) => ({
    box,
    image: await resizeForModel(await cropNormalized(dataUrl, focusFromBox(box, 0, 0)), 1500)
  })));
}

async function enhanceTextImage(dataUrl) {
  const image = await loadImage(dataUrl);
  const longEdge = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = Math.min(12, Math.max(1, 1500 / Math.max(1, longEdge)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = "contrast(145%) saturate(75%) brightness(105%)";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function isFatalApiError(message) {
  return /(?:HTTP\s*(?:400|401|403|404))|api\s*key|密钥|鉴权|认证|unauthorized|forbidden|余额|insufficient|quota|安全请求上限/i.test(String(message || ""));
}

function modelRequestSettings(settings) {
  return {
    model: settings?.model || "deepseek-flash",
    qwenEndpoint: settings?.qwenEndpoint || "",
    languagePair: normalizeLanguagePair(settings?.languagePair),
    qualityMode: settings?.qualityMode || "quality",
    commentMode: settings?.commentMode || "bilingual"
  };
}

function normalizeLanguagePair(value) {
  return ["ja-zh", "zh-ja", "en-ja", "ja-en", "en-zh", "zh-en"].includes(value) ? value : "ja-zh";
}

function normalizeAccountLabel(value) {
  const normalized = String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, 60);
  return normalized || "默认账号";
}

function currentArchiveTaskIdentity() {
  const match = String(location.pathname || "").match(/\/job\/evaluation\/([^/?#]+)\/([^/?#]+)/i);
  const taskRoute = match ? `${match[1]}/${match[2]}` : String(location.pathname || "未知任务");
  const batchCode = findVisibleHeaderBatchCode();
  return { taskId: batchCode || taskRoute, taskRoute, batchCode };
}

function findVisibleHeaderBatchCode() {
  const candidates = [];
  const roots = [document];
  for (let rootIndex = 0; rootIndex < roots.length && rootIndex < 100; rootIndex += 1) {
    const root = roots[rootIndex];
    const elements = typeof root?.querySelectorAll === "function" ? [...root.querySelectorAll("*")].slice(0, 5000) : [];
    for (const element of elements) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
      const rect = element.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > Math.min(innerHeight || 900, 340)) continue;
      const text = String(element.innerText || element.textContent || element.getAttribute?.("aria-label") || element.getAttribute?.("title") || "").trim();
      if (!text || text.length > 500) continue;
      const code = extractBatchCode(text);
      if (code) candidates.push({ code, top: rect.top, area: rect.width * rect.height, length: text.length });
    }
  }
  candidates.sort((a, b) => a.top - b.top || a.area - b.area || a.length - b.length);
  const fullText = `${document.body?.innerText || ""}\n${document.documentElement?.textContent || ""}`;
  return candidates[0]?.code || extractBatchCode(fullText);
}

function extractBatchCode(text) {
  const normalized = String(text || "").replace(/[\u200B-\u200D\uFEFF]/g, " ");
  const match = normalized.match(/(?:^|[^A-Z0-9])E\s*([0-9](?:\s*[0-9]){5,})(?![A-Z0-9])/i);
  return match ? `E${match[1].replace(/\s+/g, "")}`.toUpperCase() : "";
}

function languagePairNames(value) {
  return {
    "ja-zh": { source: "日文原文", target: "简体中文" },
    "zh-ja": { source: "简体中文原文", target: "日文" },
    "en-ja": { source: "英文原文", target: "日文" },
    "ja-en": { source: "日文原文", target: "英文" },
    "en-zh": { source: "英文原文", target: "简体中文" },
    "zh-en": { source: "简体中文原文", target: "英文" }
  }[normalizeLanguagePair(value)];
}

function languagePairFromPageCodes(source, target) {
  const normalizeCode = (code) => String(code || "").toUpperCase().replace(/^EN_US$/, "EN");
  const key = `${normalizeCode(source)}>${normalizeCode(target)}`;
  return { "JA>ZH_CN": "ja-zh", "ZH_CN>JA": "zh-ja", "EN>JA": "en-ja", "JA>EN": "ja-en", "EN>ZH_CN": "en-zh", "ZH_CN>EN": "zh-en" }[key] || null;
}

function languagePairFromPageText(text, allowNearby = false) {
  const token = "(JA|ZH_CN|EN(?:_US)?)";
  const explicit = String(text || "").match(new RegExp(`\\b${token}\\s*(?:>|→|▶|›|➡|➜|-+>)\\s*${token}\\b`, "i"));
  const nearby = explicit || (allowNearby
    ? String(text || "").match(new RegExp(`\\b${token}\\b[\\s\\S]{0,24}?\\b${token}\\b`, "i"))
    : null);
  return nearby ? languagePairFromPageCodes(nearby[1], nearby[2]) : null;
}

function detectPageLanguagePair() {
  if (typeof document === "undefined") return null;
  const candidates = [];
  if (typeof document.querySelectorAll === "function") {
    for (const element of document.querySelectorAll("header, [class*='header'], [class*='lang'], button, span")) {
      const text = String(element.textContent || "").trim().toUpperCase().replace(/\s+/g, " ");
      if (!text || text.length > 80) continue;
      const rect = element.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= Math.min(globalThis.innerHeight || 900, 320)) {
        candidates.push(text);
      }
    }
  }
  for (const text of candidates) {
    const pair = languagePairFromPageText(text, true);
    if (pair) return pair;
  }
  return languagePairFromPageText(String(document.body?.innerText || "").toUpperCase(), false);
}

function requirePageLanguagePair() {
  const pagePair = detectPageLanguagePair();
  if (!pagePair) throw new Error("无法读取当前页面顶部的翻译方向，已停止且不会默认使用日译中。请确认页面顶部显示 JA → ZH_CN、ZH_CN → JA、EN → JA、JA → EN、EN → ZH_CN 或 ZH_CN → EN 后重试。");
  return pagePair;
}

function settingsForCurrentPage(settings = {}) {
  return { ...settings, languagePair: requirePageLanguagePair() };
}

function assertPageLanguagePair(configuredPair) {
  const pagePair = requirePageLanguagePair();
  if (pagePair === configuredPair) return;
  const configured = languagePairNames(configuredPair);
  const actual = languagePairNames(pagePair);
  throw new Error(`语言方向不一致：网页是${actual.source}→${actual.target}译文，插件选择的是${configured.source}→${configured.target}译文。请在侧栏切换“翻译方向”后重试。`);
}

function makeFallbackResult(kind, settings, reason) {
  const commentMode = ["bilingual", "chinese", "none"].includes(settings?.commentMode) ? settings.commentMode : "bilingual";
  const languagePair = normalizeLanguagePair(settings?.languagePair);
  const untranslated = {
    "ja-zh": {
      zh: "对应位置还是原文，没有生成中文翻译，按未翻译处理。",
      ko: "해당 위치에 원문이 그대로 남아 있고 중국어 번역이 생성되지 않아 미번역으로 처리했습니다."
    },
    "zh-ja": {
      zh: "对应位置还是中文原文，没有生成日文翻译，按未翻译处理。",
      ko: "해당 위치에 중국어 원문이 그대로 남아 있고 일본어 번역이 생성되지 않아 미번역으로 처리했습니다."
    },
    "en-ja": {
      zh: "对应位置还是英文原文，没有生成日文翻译，按未翻译处理。",
      ko: "해당 위치에 영어 원문이 그대로 남아 있고 일본어 번역이 생성되지 않아 미번역으로 처리했습니다."
    },
    "ja-en": {
      zh: "对应位置还是日文原文，没有生成英文翻译，按未翻译处理。",
      ko: "해당 위치에 일본어 원문이 그대로 남아 있고 영어 번역이 생성되지 않아 미번역으로 처리했습니다."
    },
    "en-zh": {
      zh: "对应位置还是英文原文，没有生成中文翻译，按未翻译处理。",
      ko: "해당 위치에 영어 원문이 그대로 남아 있고 중국어 번역이 생성되지 않아 미번역으로 처리했습니다."
    },
    "zh-en": {
      zh: "对应位置还是中文原文，没有生成英文翻译，按未翻译处理。",
      ko: "해당 위치에 중국어 원문이 그대로 남아 있고 영어 번역이 생성되지 않아 미번역으로 처리했습니다."
    }
  }[languagePair];
  const variants = {
    na: {
      evaluation_state: "page_error", translation_score: "NA", rendering_score: "NA", confidence: 0.9,
      zh: "译图没有生成可评价的结果，按规则记为无法评估。",
      ko: "번역 이미지에 평가할 수 있는 결과가 생성되지 않아 규정에 따라 평가 불가로 처리했습니다."
    },
    untranslated: {
      evaluation_state: "untranslated", translation_score: 1, rendering_score: "NA", confidence: 0.86,
      zh: untranslated.zh,
      ko: untranslated.ko
    },
    uncertain: {
      evaluation_state: "unreadable", translation_score: 3, rendering_score: 3, confidence: 0.72,
      zh: "这个文本块比较小，多轮放大后仍不能完全确认，先按中间档评分。",
      ko: "텍스트 블록이 작아 여러 번 확대해도 완전히 확인하기 어려워 우선 중간 점수로 평가했습니다."
    }
  };
  const chosen = variants[kind] || variants.uncertain;
  return {
    evaluation_state: chosen.evaluation_state,
    source_text: "", target_text: "",
    translation_score: chosen.translation_score, rendering_score: chosen.rendering_score,
    comment_zh: commentMode === "none" ? "" : chosen.zh,
    comment_ko: commentMode === "bilingual" ? chosen.ko : "",
    comment: commentMode === "none" ? "" : chosen.zh,
    translation_issues: [], rendering_issues: [],
    confidence: chosen.confidence, needs_review: false, reason: String(reason || ""), auto_fallback: true
  };
}

function assessReliability(result, { focusFound }) {
  const reasons = [];
  const state = ["normal", "untranslated", "no_output", "page_error", "unreadable"].includes(result.evaluation_state)
    ? result.evaluation_state : "normal";
  const sourceText = String(result.source_text || "").trim();
  const targetText = String(result.target_text || "").trim();
  const allIssues = [...(result.translation_issues || []), ...(result.rendering_issues || [])].join(" ");
  const explanation = `${result.comment || ""} ${result.reason || ""} ${allIssues}`;
  if (!focusFound) reasons.push("没有可靠定位高亮块");
  if (["no_output", "page_error"].includes(state)) return reasons;
  if (state === "untranslated") {
    if (!sourceText) reasons.push("未翻译判断缺少原文证据");
  } else if (!sourceText || !targetText) reasons.push("原文或译文识别不完整");
  if (sourceText.length >= 215 || targetText.length >= 215) reasons.push("识别文字过长，疑似读取了高亮块以外的内容");
  const hangulCount = (targetText.match(/[\uac00-\ud7af]/g) || []).length;
  const hanCount = (targetText.match(/[\u3400-\u9fff]/g) || []).length;
  if (hangulCount > 2 && hangulCount > hanCount / 2) reasons.push("译文语种识别异常");
  if (result.translation_score >= 3 && /完全错误|完全无关|无意义|乱码|未翻译|主要意思相反/.test(explanation)) {
    reasons.push("翻译问题与分数不一致");
  }
  if (result.rendering_score >= 3 && /无法阅读|基本不可用|严重叠字|大面积错位|文字越界/.test(explanation)) {
    reasons.push("排版问题与分数不一致");
  }
  if (result.translation_score === 5 && (result.translation_issues || []).length > 0) reasons.push("满分但仍报告翻译问题");
  if (result.rendering_score === 5 && (result.rendering_issues || []).length > 0) reasons.push("满分但仍报告排版问题");
  return reasons;
}

function resetViewerZooms(heading) {
  const headingTop = heading.getBoundingClientRect().top;
  const ranges = [...document.querySelectorAll('input[type="range"]')]
    .filter((input) => {
      const rect = input.getBoundingClientRect();
      return rect.width > 40 && rect.top > 60 && rect.bottom < headingTop;
    });
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  for (const range of ranges) {
    if (!setter) continue;
    setter.call(range, range.min || "0");
    range.dispatchEvent(new Event("input", { bubbles: true }));
    range.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function findHeading(kind) {
  const patterns = kind === "translation"
    ? [/^翻译[—\-]/, /translation/i, /^번역/]
    : [/^渲染[—\-]/, /rendering/i, /^렌더링/];
  const all = [...document.querySelectorAll("body *")];
  return all
    .filter((element) => {
      const text = directText(element);
      if (!patterns.some((pattern) => pattern.test(text))) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 120 && rect.width < innerWidth * 0.65 && rect.height < 100 && rect.bottom > 0;
    })
    .sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0] || null;
}

function directText(element) {
  return [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent || "")
    .join(" ")
    .trim();
}

async function positionForCapture(heading) {
  const docY = scrollY + heading.getBoundingClientRect().top;
  const desiredTop = Math.max(0, docY - innerHeight * 0.68);
  if (Math.abs(scrollY - desiredTop) > 30) {
    scrollTo({ top: desiredTop, behavior: "instant" });
    await sleep(350);
  }
}

function detectImagePanes(heading) {
  const headingTop = heading.getBoundingClientRect().top;
  const candidates = [...document.querySelectorAll("img, canvas, [class]")]
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > innerWidth * 0.18 && rect.height > 180 && rect.top >= 70 && rect.top < headingTop && rect.bottom <= headingTop + 30)
    .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));

  const left = candidates.find(({ rect }) => rect.left < innerWidth * 0.45 && rect.right <= innerWidth * 0.58);
  const right = candidates.find(({ rect }) => rect.left >= innerWidth * 0.42 && rect.right > innerWidth * 0.68);
  if (left && right) {
    return {
      source: { ...normalizeRect(left.rect), element: left.element },
      target: { ...normalizeRect(right.rect), element: right.element }
    };
  }

  const bottom = Math.max(220, headingTop - 18);
  const top = Math.max(85, bottom - Math.min(700, innerHeight * 0.52));
  const margin = Math.max(8, innerWidth * 0.055);
  const gap = Math.max(4, innerWidth * 0.008);
  const half = innerWidth / 2;
  return {
    source: { left: margin, top, width: half - margin - gap, height: bottom - top, element: null },
    target: { left: half + gap, top, width: half - margin - gap, height: bottom - top, element: null }
  };
}

async function extractPaneOriginal(pane, side, heading) {
  const headingTop = heading.getBoundingClientRect().top;
  const roots = pane.element
    ? [pane.element, ...pane.element.querySelectorAll("img,canvas,[style*='background']")]
    : [...document.querySelectorAll("img,canvas,[style*='background']")];
  const candidates = [...new Set(roots)]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return { element, rect, score: mediaScore(element), stackRank: visibleMediaStackRank(element, rect) };
    })
    .filter(({ element, rect, score, stackRank }) => {
      const center = rect.left + rect.width / 2;
      const inSide = side === "left" ? center < innerWidth / 2 : center >= innerWidth / 2;
      const overlapWidth = Math.max(0, Math.min(rect.right, pane.left + pane.width) - Math.max(rect.left, pane.left));
      const overlapHeight = Math.max(0, Math.min(rect.bottom, pane.top + pane.height) - Math.max(rect.top, pane.top));
      const overlap = overlapWidth * overlapHeight;
      const renderedArea = Math.max(1, rect.width * rect.height);
      const style = getComputedStyle(element);
      return inSide && stackRank >= 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || 1) > 0.05 && score > 20000 && overlap / renderedArea > 0.55 && rect.width > 70 && rect.height > 70 && rect.top >= 60 && rect.top < headingTop && rect.bottom <= headingTop + 40;
    })
    .sort((a, b) => a.stackRank - b.stackRank || mediaPriority(b.element) - mediaPriority(a.element) || b.score - a.score);

  for (const { element, rect } of candidates) {
    const image = await elementToDataUrl(element).catch(() => null);
    if (image && image.length > 2000) return { image, displayRect: renderedMediaRect(element, rect) };
  }
  return null;
}

function renderedMediaRect(element, rect) {
  const fallback = plainRect(rect);
  const intrinsicWidth = element instanceof HTMLImageElement ? element.naturalWidth :
    element instanceof HTMLCanvasElement ? element.width : 0;
  const intrinsicHeight = element instanceof HTMLImageElement ? element.naturalHeight :
    element instanceof HTMLCanvasElement ? element.height : 0;
  if (!intrinsicWidth || !intrinsicHeight || !rect.width || !rect.height) return fallback;
  const style = getComputedStyle(element);
  const fit = style.objectFit || "fill";
  if (!/contain|scale-down/.test(fit)) return fallback;
  const scale = Math.min(rect.width / intrinsicWidth, rect.height / intrinsicHeight, fit === "scale-down" ? 1 : Infinity);
  const width = intrinsicWidth * scale;
  const height = intrinsicHeight * scale;
  const position = (style.objectPosition || "50% 50%").split(/\s+/);
  const factor = (value) => value?.endsWith("%") ? clampNumber(parseFloat(value) / 100, 0, 1, 0.5) : 0.5;
  return {
    left: rect.left + (rect.width - width) * factor(position[0]),
    top: rect.top + (rect.height - height) * factor(position[1] || position[0]),
    width,
    height
  };
}

async function refineVisibleMediaRect(screenshot, pane, candidateRect) {
  const base = intersectRects(candidateRect, pane) || plainRect(pane);
  const image = await loadImage(screenshot);
  const scaleX = image.naturalWidth / innerWidth;
  const scaleY = image.naturalHeight / innerHeight;
  const sx = Math.max(0, Math.round(pane.left * scaleX));
  const sy = Math.max(0, Math.round(pane.top * scaleY));
  const sw = Math.min(image.naturalWidth - sx, Math.max(1, Math.round(pane.width * scaleX)));
  const sh = Math.min(image.naturalHeight - sy, Math.max(1, Math.round(pane.height * scaleY)));
  const analysisScale = Math.min(1, 720 / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * analysisScale));
  const height = Math.max(1, Math.round(sh * analysisScale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const bounds = globalThis.PapagoHighlightDetector?.findContentBounds?.(pixels, width, height);
  if (!bounds) return { ...base, refined: false };
  const detected = {
    left: pane.left + (bounds.minX / width) * pane.width,
    top: pane.top + (bounds.minY / height) * pane.height,
    width: ((bounds.maxX - bounds.minX + 1) / width) * pane.width,
    height: ((bounds.maxY - bounds.minY + 1) / height) * pane.height
  };
  const narrowed = detected.width < pane.width * 0.92 || detected.height < pane.height * 0.92;
  if (!narrowed || detected.width < 70 || detected.height < 90) return { ...base, refined: false };
  const overlap = intersectRects(detected, base);
  if (candidateRect && (!overlap || overlap.width * overlap.height < detected.width * detected.height * 0.45)) {
    return { ...base, refined: false };
  }
  return { ...detected, refined: true };
}

function visibleMediaStackRank(element, rect) {
  // elementsFromPoint can return an empty stack for a minimized/background
  // Chromium surface even though the DOM image itself is fully available.
  if (typeof document !== "undefined" && document.hidden) return 0;
  const points = [
    [rect.left + rect.width * 0.5, rect.top + rect.height * 0.5],
    [rect.left + rect.width * 0.35, rect.top + rect.height * 0.35],
    [rect.left + rect.width * 0.65, rect.top + rect.height * 0.65]
  ];
  let best = Infinity;
  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    const stack = document.elementsFromPoint(x, y);
    const rank = stack.findIndex((node) => node === element || element.contains(node));
    if (rank >= 0) best = Math.min(best, rank);
  }
  return Number.isFinite(best) ? best : -1;
}

async function imageSimilarity(firstUrl, secondUrl) {
  const [first, second] = await Promise.all([loadImage(firstUrl), loadImage(secondUrl)]);
  const width = 64;
  const height = Math.max(24, Math.min(96, Math.round(width * second.naturalHeight / Math.max(1, second.naturalWidth))));
  const render = (image, contain, background = [255, 255, 255]) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    context.fillStyle = `rgb(${background[0]},${background[1]},${background[2]})`;
    context.fillRect(0, 0, width, height);
    if (contain) {
      const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    } else {
      context.drawImage(image, 0, 0, width, height);
    }
    return context.getImageData(0, 0, width, height).data;
  };
  const secondPixels = render(second, false);
  const cornerOffsets = [0, (width - 1) * 4, (height - 1) * width * 4, (height * width - 1) * 4];
  const background = [0, 1, 2].map((channel) => Math.round(cornerOffsets.reduce((sum, offset) => sum + secondPixels[offset + channel], 0) / cornerOffsets.length));
  const firstPixels = render(first, true, background);
  let colorDifference = 0;
  let edgeDifference = 0;
  const gray = (pixels, index) => pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
  for (let index = 0; index < firstPixels.length; index += 4) {
    colorDifference += Math.abs(firstPixels[index] - secondPixels[index]);
    colorDifference += Math.abs(firstPixels[index + 1] - secondPixels[index + 1]);
    colorDifference += Math.abs(firstPixels[index + 2] - secondPixels[index + 2]);
    const pixel = index / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x + 1 < width && y + 1 < height) {
      const right = index + 4;
      const down = index + width * 4;
      const firstEdge = Math.abs(gray(firstPixels, right) - gray(firstPixels, index)) + Math.abs(gray(firstPixels, down) - gray(firstPixels, index));
      const secondEdge = Math.abs(gray(secondPixels, right) - gray(secondPixels, index)) + Math.abs(gray(secondPixels, down) - gray(secondPixels, index));
      edgeDifference += Math.abs(firstEdge - secondEdge);
    }
  }
  const colorSimilarity = 1 - colorDifference / (width * height * 3 * 255);
  const edgeSimilarity = 1 - edgeDifference / (width * height * 510);
  return clampNumber(colorSimilarity * 0.52 + edgeSimilarity * 0.48, 0, 1, 0);
}

function mediaPriority(element) {
  if (element instanceof HTMLCanvasElement) return 3;
  if (element instanceof HTMLImageElement) return 2;
  return 1;
}

function mediaScore(element) {
  if (element instanceof HTMLCanvasElement) return Math.max(element.width * element.height, element.clientWidth * element.clientHeight);
  if (element instanceof HTMLImageElement) return Math.max(element.naturalWidth * element.naturalHeight, element.clientWidth * element.clientHeight);
  const rect = element.getBoundingClientRect();
  return backgroundImageUrl(element) ? rect.width * rect.height : 0;
}

async function elementToDataUrl(element) {
  if (element instanceof HTMLCanvasElement) {
    if (element.width < 100 || element.height < 100) return null;
    return element.toDataURL("image/png");
  }
  let url = "";
  if (element instanceof HTMLImageElement) url = element.currentSrc || element.src;
  else url = backgroundImageUrl(element);
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  const cached = pageImageCache.get(url);
  if (cached) {
    pageImageCache.delete(url);
    pageImageCache.set(url, cached);
    return cached;
  }
  let image = null;
  if (url.startsWith("blob:")) {
    const response = await fetch(url);
    if (!response.ok) return null;
    image = await blobToDataUrl(await response.blob());
  } else {
    const fetched = await chrome.runtime.sendMessage({ type: "FETCH_PAGE_IMAGE", url });
    image = fetched?.ok ? fetched.image : null;
  }
  if (image) rememberPageImage(url, image);
  return image;
}

function rememberPageImage(url, image) {
  pageImageCache.set(url, image);
  while (pageImageCache.size > MAX_PAGE_IMAGE_CACHE_ENTRIES) {
    pageImageCache.delete(pageImageCache.keys().next().value);
  }
}

function backgroundImageUrl(element) {
  const value = getComputedStyle(element).backgroundImage || "";
  const match = value.match(/^url\(["']?(.*?)["']?\)$/i);
  return match?.[1] || "";
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("网页图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

async function detectHighlightRegion(screenshot, sourceRect) {
  const image = await loadImage(screenshot);
  const scaleX = image.naturalWidth / innerWidth;
  const scaleY = image.naturalHeight / innerHeight;
  const sx = Math.max(0, Math.round(sourceRect.left * scaleX));
  const sy = Math.max(0, Math.round(sourceRect.top * scaleY));
  const sw = Math.min(image.naturalWidth - sx, Math.round(sourceRect.width * scaleX));
  const sh = Math.min(image.naturalHeight - sy, Math.round(sourceRect.height * scaleY));
  const analysisScale = Math.min(1, 720 / sw);
  const width = Math.max(1, Math.round(sw * analysisScale));
  const height = Math.max(1, Math.round(sh * analysisScale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const best = globalThis.PapagoHighlightDetector?.locate(pixels, width, height);
  if (!best) return null;
  return {
    rect: {
      left: sourceRect.left + (best.minX / width) * sourceRect.width,
      top: sourceRect.top + (best.minY / height) * sourceRect.height,
      width: Math.max(8, ((best.maxX - best.minX + 1) / width) * sourceRect.width),
      height: Math.max(8, ((best.maxY - best.minY + 1) / height) * sourceRect.height)
    },
    confidence: best.confidence,
    mode: best.mode,
    frameQuality: best.frameQuality || 0,
    candidateCount: best.candidateCount || 1,
    separation: best.separation || 1
  };
}

function normalizedFocusRect(highlight, reference, confidence = 1) {
  const centerX = (highlight.left + highlight.width / 2 - reference.left) / reference.width;
  const centerY = (highlight.top + highlight.height / 2 - reference.top) / reference.height;
  if (centerX < -0.05 || centerX > 1.05 || centerY < -0.05 || centerY > 1.05) return null;
  const rawWidth = highlight.width / reference.width;
  const rawHeight = highlight.height / reference.height;
  const weakDetection = confidence < 0.7;
  const minWidth = Math.min(weakDetection ? 0.68 : 0.50, Math.max(0.16, (weakDetection ? 150 : 110) / reference.width));
  const minHeight = Math.min(weakDetection ? 0.58 : 0.42, Math.max(0.12, (weakDetection ? 100 : 70) / reference.height));
  const width = Math.min(1, Math.max(minWidth, rawWidth * (weakDetection ? 3.8 : 2.4)));
  const height = Math.min(1, Math.max(minHeight, rawHeight * (weakDetection ? 4.2 : 2.8)));
  return {
    left: Math.max(0, Math.min(1 - width, centerX - width / 2)),
    top: Math.max(0, Math.min(1 - height, centerY - height / 2)),
    width,
    height
  };
}

async function cropNormalized(dataUrl, focus) {
  const image = await loadImage(dataUrl);
  const sx = Math.max(0, Math.round(focus.left * image.naturalWidth));
  const sy = Math.max(0, Math.round(focus.top * image.naturalHeight));
  const sw = Math.min(image.naturalWidth - sx, Math.max(1, Math.round(focus.width * image.naturalWidth)));
  const sh = Math.min(image.naturalHeight - sy, Math.max(1, Math.round(focus.height * image.naturalHeight)));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext("2d", { alpha: false }).drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL("image/png");
}

async function resizeForModel(dataUrl, maxDimension) {
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  if (scale === 1) return dataUrl;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d", { alpha: false }).drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/webp", 0.9);
}

async function upscaleForModel(dataUrl, minLongEdge = 1100, maxScale = 4) {
  const image = await loadImage(dataUrl);
  const longEdge = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = Math.min(maxScale, Math.max(1, minLongEdge / Math.max(1, longEdge)));
  if (scale === 1) return dataUrl;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function quickHash(value) {
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(value.length / 5000));
  for (let index = 0; index < value.length; index += step) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function normalizeRect(rect) {
  const padding = 4;
  const left = Math.max(0, rect.left - padding);
  const top = Math.max(0, rect.top - padding);
  return {
    left,
    top,
    width: Math.min(innerWidth - left, rect.width + padding * 2),
    height: Math.min(innerHeight - top, rect.height + padding * 2)
  };
}

function plainRect(rect) {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function intersectRects(first, second) {
  if (!first || !second) return null;
  const left = Math.max(0, first.left, second.left);
  const top = Math.max(0, first.top, second.top);
  const right = Math.min(innerWidth, first.left + first.width, second.left + second.width);
  const bottom = Math.min(innerHeight, first.top + first.height, second.top + second.height);
  if (right - left < 40 || bottom - top < 80) return null;
  return { left, top, width: right - left, height: bottom - top };
}

async function cropScreenshot(dataUrl, rect) {
  const image = await loadImage(dataUrl);
  const scaleX = image.naturalWidth / innerWidth;
  const scaleY = image.naturalHeight / innerHeight;
  const sx = Math.max(0, Math.round(rect.left * scaleX));
  const sy = Math.max(0, Math.round(rect.top * scaleY));
  const sw = Math.min(image.naturalWidth - sx, Math.max(1, Math.round(rect.width * scaleX)));
  const sh = Math.min(image.naturalHeight - sy, Math.max(1, Math.round(rect.height * scaleY)));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext("2d", { alpha: false }).drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL("image/png");
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("截图解码失败"));
    image.src = src;
  });
}

async function fillEvaluation(result) {
  const translationCard = findRatingCard(findHeading("translation"));
  const renderingCard = findRatingCard(findHeading("rendering"));
  selectRating(translationCard, result.translation_score);
  selectRating(renderingCard, result.rendering_score);

  const field = document.querySelector('textarea, input[class*="form_input"]');
  if (result.comment_ko && !field) throw new Error("需要填写韩文评论，但没有找到评论输入框");
  if (field) {
    setNativeValue(field, result.comment_ko || "");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.blur();
  }
  const deadline = Date.now() + 2200;
  while (Date.now() < deadline) {
    const next = findNextButton();
    if (next && !next.disabled) return;
    await sleep(80);
  }
  throw new Error("评分已点击，但页面在2秒内仍未接受完整填写，请人工核对");
}

function findRatingCard(heading) {
  if (!heading) throw new Error("评分标题缺失");
  let node = heading;
  for (let i = 0; i < 7 && node; i += 1, node = node.parentElement) {
    const radios = node.querySelectorAll('input[type="radio"]');
    if (radios.length >= 6) return node;
    const text = (node.innerText || "").replace(/\s+/g, " ");
    const rect = node.getBoundingClientRect();
    if (rect.width > 300 && rect.height > 100 && /1/.test(text) && /5/.test(text) && /NA|不可分级|평가 불가/i.test(text)) return node;
  }
  throw new Error("未找到评分选项");
}

function selectRating(card, score) {
  const radios = [...card.querySelectorAll('input[type="radio"]')].filter(isVisibleOrInput);
  if (radios.length >= 6) {
    const index = score === "NA" ? 5 : Number(score) - 1;
    const radio = radios[index];
    if (!radio) throw new Error(`找不到评分 ${score}`);
    radio.click();
    if (!radio.checked) {
      radio.checked = true;
      radio.dispatchEvent(new Event("input", { bubbles: true }));
      radio.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return;
  }

  const target = [...card.querySelectorAll("label, button, span, div")]
    .filter((element) => {
      const text = directText(element).replace(/\s+/g, " ").trim();
      const matches = score === "NA" ? /NA|不可分级|평가 불가/i.test(text) : text === String(score);
      const rect = element.getBoundingClientRect();
      return matches && rect.width > 0 && rect.height > 0 && rect.height < 80;
    })
    .sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return (ra.width * ra.height) - (rb.width * rb.height);
    })[0];
  if (!target) throw new Error(`找不到评分 ${score}`);
  target.click();
}

function isVisibleOrInput(element) {
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function setNativeValue(element, value) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("无法写入评论框");
  setter.call(element, value);
}

function findNextButton() {
  return document.querySelector('button[class*="btn_step_next"], [role="button"][class*="btn_step_next"]');
}

async function clickNextSafely({ useBackground = false, forceBackground = false } = {}) {
  const button = findNextButton();
  if (!button) throw new Error("未找到下一张按钮");
  const progress = readProgress();
  if (!button.className.includes("btn_step_next") || (progress.total > 0 && progress.current >= progress.total)) {
    throw new Error("已到最终提交步骤，扩展已停止并保留人工确认");
  }
  const disabled = button.disabled || button.getAttribute("aria-disabled") === "true";
  if (disabled && !(useBackground && forceBackground)) throw new Error("下一张按钮尚未启用");
  if (useBackground) {
    const response = await chrome.runtime.sendMessage({
      type: "CLICK_NEXT_BACKGROUND", force: forceBackground
    }).catch(() => null);
    if (response?.ok && response.clicked) return response;
  }
  if (disabled) throw new Error("下一张按钮尚未启用");
  button.click();
  return { ok: true, clicked: true, mode: "content-script-click" };
}

function refreshFilledEvaluationSignals() {
  for (const radio of document.querySelectorAll('input[type="radio"]:checked')) {
    radio.dispatchEvent(new Event("input", { bubbles: true }));
    radio.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const field = document.querySelector('textarea, input[class*="form_input"]');
  if (field) {
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.blur();
  }
}

function reapplyCurrentEvaluation(result) {
  const translationCard = findRatingCard(findHeading("translation"));
  const renderingCard = findRatingCard(findHeading("rendering"));
  selectRating(translationCard, result.translation_score);
  selectRating(renderingCard, result.rendering_score);
  const field = document.querySelector('textarea, input[class*="form_input"]');
  if (field) {
    setNativeValue(field, result.comment_ko || "");
  }
  refreshFilledEvaluationSignals();
}

async function waitForNetworkRecovery() {
  while (!runState.stopRequested && typeof navigator !== "undefined" && navigator.onLine === false) {
    await sleep(2500);
  }
  if (!runState.stopRequested) emitStatus("recovering", "网络连接已恢复，正在重新确认下一张按钮");
}

function readProgress() {
  const current = Number(document.querySelector('input[class*="progress_current_input"]')?.value || 0);
  const totalMatch = document.body.innerText.match(/\/\s*([0-9]{1,7})/);
  return { current, total: Number(totalMatch?.[1] || 0) };
}

function currentItemKey() {
  const progress = document.querySelector('input[class*="progress_current_input"]')?.value || "";
  const main = document.body.innerText.match(/(?:原版|Original|원본)\s*([0-9]+)/i)?.[1] || "";
  return `${progress}:${main}:${location.href}`;
}

async function waitForNextItemReady(before, timeoutMs, backgroundCapture = false) {
  const start = Date.now();
  let stableCount = 0;
  let sourceChanged = false;
  let targetChanged = false;
  let itemKeyChanged = false;
  let visualChanged = false;
  let ratingsResetObserved = false;
  let previousVisualState = null;
  let candidateItemKey = "";
  while (Date.now() - start < timeoutMs) {
    if (runState.stopRequested) return;
    await sleep(700);
    const itemKey = currentItemKey();
    if (!findHeading("translation")) continue;
    const visualState = await captureCurrentPaneVisualState(backgroundCapture).catch(() => null);
    if (!visualState) continue;
    const sourceChangedNow = Boolean(
      visualState.source && before.visualState?.source && visualState.source !== before.visualState.source
    ) || Boolean(
      visualState.sourceNative && before.visualState?.sourceNative && visualState.sourceNative !== before.visualState.sourceNative
    );
    const targetChangedNow = Boolean(
      visualState.target && before.visualState?.target && visualState.target !== before.visualState.target
    ) || Boolean(
      visualState.targetNative && before.visualState?.targetNative && visualState.targetNative !== before.visualState.targetNative
    );
    sourceChanged ||= sourceChangedNow;
    targetChanged ||= targetChangedNow;
    itemKeyChanged ||= itemKey !== before.itemKey;
    visualChanged ||= sourceChangedNow || targetChangedNow;
    ratingsResetObserved ||= ratingSelectionsCleared();
    const sameItem = itemKey === candidateItemKey;
    let visuallyStable = previousVisualState &&
      previousVisualState.sourceNative === visualState.sourceNative &&
      previousVisualState.targetNative === visualState.targetNative;
    if (!visuallyStable && previousVisualState &&
      previousVisualState.source === visualState.source && previousVisualState.target === visualState.target) {
      visuallyStable = true;
    }
    if (!visuallyStable && previousVisualState?.sourceImage && visualState.sourceImage) {
      const [sourceSimilarity, targetSimilarity] = await Promise.all([
        imageSimilarity(previousVisualState.sourceImage, visualState.sourceImage).catch(() => 0),
        imageSimilarity(previousVisualState.targetImage, visualState.targetImage).catch(() => 0)
      ]);
      visuallyStable = sourceSimilarity >= 0.985 && targetSimilarity >= 0.985;
    }
    if (sameItem && visuallyStable) stableCount += 1;
    else stableCount = 1;
    candidateItemKey = itemKey;
    previousVisualState = visualState;
    // Keep the independent-pane guard, but allow a pane whose next item is
    // intentionally identical to the previous one after a short grace period.
    // This avoids both false stalls and accepting the target while it is still
    // one render behind the source.
    const elapsed = Date.now() - start;
    const graceElapsed = elapsed >= 2200;
    const sourceReady = sourceChanged || graceElapsed;
    const targetReady = targetChanged || graceElapsed;
    // Papago sometimes reuses the same image URL for another highlighted block
    // and updates the visible progress label late. Both rating groups being
    // cleared is strong evidence that the previous item was accepted. A short
    // extra grace avoids reading the old pixels during the React transition.
    const resetTransitionReady = ratingsResetObserved && elapsed >= 3200;
    if (stableCount >= 2 && currentItemKey() === itemKey &&
      (itemKeyChanged || visualChanged || resetTransitionReady) && sourceReady && targetReady) return;
  }
  const pending = [!sourceChanged && "原图", !targetChanged && "译图"].filter(Boolean).join("和") || "两侧图片";
  throw new Error(`${pending}在${Math.round(timeoutMs / 1000)}秒内没有确认稳定，当前页面可能仍在切换；已停止且没有调用下一次评分`);
}

function ratingSelectionsCleared() {
  try {
    const translationCard = findRatingCard(findHeading("translation"));
    const renderingCard = findRatingCard(findHeading("rendering"));
    return !translationCard.querySelector('input[type="radio"]:checked') &&
      !renderingCard.querySelector('input[type="radio"]:checked');
  } catch (_error) {
    return false;
  }
}

function isRecoverableRunError(error) {
  const message = String(error?.message || error || "");
  if (/401|403|api\s*key|密钥|鉴权|认证|unauthorized|forbidden|余额|insufficient|quota|安全请求上限|语言方向不一致/i.test(message)) return false;
  return /截图|调试器|页面当前不可见|图片|图像|加载|切换|稳定|任务已切换|未找到翻译评分区域|读取网页原图|下一张按钮|评分已点击|页面.*接受|网络|failed\s+to\s+fetch|networkerror|timeout|timed\s*out|connection\s+refused|HTTP\s*(?:408|429|500|502|503|504)|internal[_ -]?server|service[_ -]?unavailable|temporar|resource\s+exhausted|throttl/i.test(message);
}

async function recoverBackgroundCapture(settings) {
  if (settings?.backgroundCapture !== true) return;
  await releaseBackgroundCapture();
  await prepareBackgroundCapture(settings);
}

async function captureCurrentPaneVisualState(backgroundCapture = false) {
  const heading = findHeading("translation");
  if (!heading) return "";
  const panes = detectImagePanes(heading);
  const nativeState = nativePaneVisualState(panes);
  // Transition polling must stay lightweight. Re-fetching/decoding two full
  // images every 700 ms can saturate a slow connection and delay Papago's own
  // next-item request. URL/canvas/highlight identities plus the page item key
  // are sufficient here; full-resolution images are read once in runOne.
  return { ...nativeState, source: "", target: "", sourceImage: "", targetImage: "" };
}

function paneVisualState(sourceImage, targetImage) {
  return { source: quickHash(sourceImage), target: quickHash(targetImage) };
}

function nativePaneVisualState(panes) {
  const domHighlight = detectDomHighlightRegion(panes?.source, panes?.source);
  const highlightIdentity = domHighlight?.rect
    ? [domHighlight.rect.left, domHighlight.rect.top, domHighlight.rect.width, domHighlight.rect.height]
      .map((value) => Math.round(value / 2)).join(",")
    : "";
  return {
    sourceNative: quickHash(`${paneMediaIdentity(panes?.source)}|highlight:${highlightIdentity}`),
    targetNative: paneMediaIdentity(panes?.target)
  };
}

async function detectHighlightInImage(dataUrl, sourceRect) {
  const image = await loadImage(dataUrl);
  const analysisScale = Math.min(1, 900 / Math.max(1, image.naturalWidth));
  const width = Math.max(1, Math.round(image.naturalWidth * analysisScale));
  const height = Math.max(1, Math.round(image.naturalHeight * analysisScale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const best = globalThis.PapagoHighlightDetector?.locate(
    context.getImageData(0, 0, width, height).data, width, height
  );
  if (!best) return null;
  return {
    rect: {
      left: sourceRect.left + (best.minX / width) * sourceRect.width,
      top: sourceRect.top + (best.minY / height) * sourceRect.height,
      width: Math.max(8, ((best.maxX - best.minX + 1) / width) * sourceRect.width),
      height: Math.max(8, ((best.maxY - best.minY + 1) / height) * sourceRect.height)
    },
    confidence: best.confidence,
    mode: best.mode,
    frameQuality: best.frameQuality || 0,
    candidateCount: best.candidateCount || 1,
    separation: best.separation || 1
  };
}

function detectDomHighlightRegion(pane, sourceRect) {
  if (!pane || !sourceRect?.width || !sourceRect?.height) return null;
  const paneRight = pane.left + pane.width;
  const paneBottom = pane.top + pane.height;
  const paneArea = Math.max(1, pane.width * pane.height);
  const roots = pane.element && typeof pane.element.querySelectorAll === "function"
    ? [pane.element, ...pane.element.querySelectorAll("*")]
    : typeof document?.querySelectorAll === "function" ? [...document.querySelectorAll("body *")] : [];
  const candidates = [];
  for (const element of new Set(roots)) {
    if (element instanceof HTMLImageElement || element instanceof HTMLCanvasElement || element === pane.element) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 6 || rect.width * rect.height > paneArea * 0.62) continue;
    const overlapWidth = Math.max(0, Math.min(rect.right, paneRight) - Math.max(rect.left, pane.left));
    const overlapHeight = Math.max(0, Math.min(rect.bottom, paneBottom) - Math.max(rect.top, pane.top));
    if (overlapWidth * overlapHeight < rect.width * rect.height * 0.72) continue;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || 1) < 0.04) continue;
    const colors = [style.borderTopColor, style.borderRightColor, style.borderBottomColor,
      style.borderLeftColor, style.outlineColor, style.stroke, element.getAttribute?.("stroke") || ""];
    const blueEdges = colors.filter(isThinFrameBlue).length;
    const borderWidths = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth,
      style.borderLeftWidth, style.outlineWidth].map((value) => parseFloat(value) || 0);
    const thinBorder = borderWidths.some((value) => value >= 0.5 && value <= 5);
    const warmFill = isMutedHighlightFill(style.backgroundColor) || isMutedHighlightFill(style.fill) ||
      isMutedHighlightFill(element.getAttribute?.("fill") || "");
    const semanticHint = /highlight|selected|active|focus|block|guide/i.test(
      `${element.className?.baseVal || element.className || ""} ${element.id || ""} ${element.getAttribute?.("data-testid") || ""}`
    );
    const shadowHint = /rgb\([^)]*(?:90|100|110|120|130|140|150|160|170|180|190|200)[^)]*\)/i.test(style.boxShadow || "") &&
      /(?:blue|cyan|#(?:[0-9a-f]{2}){3,4})/i.test(style.boxShadow || "");
    if (!((blueEdges >= 2 && thinBorder) || (blueEdges >= 1 && warmFill && thinBorder) || (semanticHint && blueEdges >= 1) || shadowHint)) continue;
    const score = blueEdges * 4 + (thinBorder ? 3 : 0) + (warmFill ? 4 : 0) + (semanticHint ? 2 : 0) +
      (shadowHint ? 1 : 0) - Math.max(0, rect.width * rect.height / paneArea - 0.22) * 8;
    candidates.push({ rect, score, blueEdges, warmFill });
  }
  candidates.sort((a, b) => b.score - a.score || (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));
  const best = candidates[0];
  if (!best || best.score < 8) return null;
  const clipped = intersectRects(plainRect(best.rect), sourceRect);
  if (!clipped) return null;
  const confidence = clampNumber(0.74 + best.blueEdges * 0.045 + (best.warmFill ? 0.07 : 0), 0, 0.96, 0.82);
  return {
    rect: clipped,
    confidence,
    mode: "blue-frame-dom",
    frameQuality: clampNumber(best.blueEdges / 4, 0, 1, 0.75),
    candidateCount: candidates.length,
    separation: candidates[1] ? Math.max(1, best.score / Math.max(0.1, candidates[1].score)) : 3
  };
}

function cssColorChannels(value) {
  const text = String(value || "").trim();
  const rgb = text.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] == null ? 1 : Number(rgb[4])];
  const hex = text.match(/^#([0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
  if (!hex) return null;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16),
    hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1];
}

function isThinFrameBlue(value) {
  const channels = cssColorChannels(value);
  if (!channels || channels[3] < 0.18) return false;
  const [red, green, blue] = channels;
  return blue >= 105 && blue >= red * 1.08 && blue >= green * 0.92 && green >= red * 0.72;
}

function isMutedHighlightFill(value) {
  const channels = cssColorChannels(value);
  if (!channels || channels[3] < 0.04) return false;
  const [red, green, blue] = channels;
  return red >= 100 && green >= 88 && red >= blue * 1.08 && green >= blue * 1.02 && Math.abs(red - green) < 95;
}

async function annotateHighlightOnImage(dataUrl, detection, reference) {
  const image = await loadImage(dataUrl);
  const box = boxFromDetection(detection, reference);
  const [left, top, right, bottom] = box;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(image, 0, 0);
  const x = left / 1000 * canvas.width;
  const y = top / 1000 * canvas.height;
  const width = Math.max(2, (right - left) / 1000 * canvas.width);
  const height = Math.max(2, (bottom - top) / 1000 * canvas.height);
  context.fillStyle = "rgba(190, 170, 92, 0.22)";
  context.fillRect(x, y, width, height);
  context.strokeStyle = "rgba(75, 145, 225, 0.96)";
  context.lineWidth = Math.max(1, Math.min(4, Math.max(canvas.width, canvas.height) / 900));
  context.strokeRect(x, y, width, height);
  return canvas.toDataURL("image/png");
}

function paneMediaIdentity(pane) {
  if (!pane) return "";
  const allMedia = typeof document.querySelectorAll === "function"
    ? [...document.querySelectorAll("img,canvas,video,[style*='background']")]
    : [];
  const nestedMedia = pane.element && typeof pane.element.querySelectorAll === "function"
    ? [...pane.element.querySelectorAll("img,canvas,video,[style*='background']")]
    : [];
  const roots = pane.element
    ? [pane.element, ...nestedMedia]
    : allMedia;
  const records = [...new Set(roots)]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const overlapWidth = Math.max(0, Math.min(rect.right, pane.left + pane.width) - Math.max(rect.left, pane.left));
      const overlapHeight = Math.max(0, Math.min(rect.bottom, pane.top + pane.height) - Math.max(rect.top, pane.top));
      const renderedArea = Math.max(1, rect.width * rect.height);
      const style = getComputedStyle(element);
      const visible = rect.width > 40 && rect.height > 40 && style.display !== "none" &&
        style.visibility !== "hidden" && Number(style.opacity || 1) > 0.05 &&
        overlapWidth * overlapHeight / renderedArea > 0.35;
      if (!visible) return null;
      const isImage = typeof HTMLImageElement !== "undefined" && element instanceof HTMLImageElement;
      const isVideo = typeof HTMLVideoElement !== "undefined" && element instanceof HTMLVideoElement;
      const isCanvas = typeof HTMLCanvasElement !== "undefined" && element instanceof HTMLCanvasElement;
      const source = isImage ? (element.currentSrc || element.src || "") :
        isVideo ? (element.currentSrc || element.src || "") :
          isCanvas ? `canvas:${element.width}x${element.height}:${canvasSampleHash(element)}` :
            `bg:${backgroundImageUrl(element)}`;
      const intrinsic = isImage
        ? `${element.naturalWidth}x${element.naturalHeight}:${element.complete ? 1 : 0}`
        : isCanvas ? `${element.width}x${element.height}`
          : `${Math.round(rect.width)}x${Math.round(rect.height)}`;
      return `${element.tagName}|${source}|${intrinsic}`;
    })
    .filter(Boolean)
    .sort()
    .slice(0, 8);
  // Include the pane geometry at coarse precision to distinguish a stale pane
  // from a newly mounted one without treating sub-pixel animation as a change.
  const geometry = [pane.left, pane.top, pane.width, pane.height].map((value) => Math.round(value / 4)).join(",");
  return quickHash(`${geometry}|${records.join("||")}`);
}

function canvasSampleHash(canvas) {
  try {
    const width = Math.min(24, Math.max(1, canvas.width));
    const height = Math.min(24, Math.max(1, canvas.height));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return "";
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    const strideX = Math.max(1, Math.floor(canvas.width / width));
    const strideY = Math.max(1, Math.floor(canvas.height / height));
    for (let y = 0; y < canvas.height; y += strideY) {
      for (let x = 0; x < canvas.width; x += strideX) {
        const offset = (y * canvas.width + x) * 4;
        hash ^= pixels[offset] || 0;
        hash = Math.imul(hash, 16777619);
        hash ^= pixels[offset + 1] || 0;
        hash = Math.imul(hash, 16777619);
        hash ^= pixels[offset + 2] || 0;
        hash = Math.imul(hash, 16777619);
      }
    }
    return (hash >>> 0).toString(16);
  } catch (_error) {
    return "";
  }
}

function collectContext(highlightDetection = null) {
  const progress = document.querySelector('input[class*="progress_current_input"]')?.value || "未知";
  const pageText = document.body.innerText || "";
  const guideMatch = pageText.match(/(?:^|\n)\s*(\d{1,4})\s*(?:원본\s*블록\s*가이드|原文\s*块\s*指南|Original\s*Block\s*Guide)/im);
  const guide = guideMatch?.[1] || "未知";
  const locationHint = highlightDetection?.confidence < 0.7
    ? "本次视觉高亮定位较弱，高清局部已自动扩大；必须结合全貌中的高亮和块编号确认同一文本块，不要把灯光、路标或背景色当高亮。"
    : "本次视觉高亮定位较明确。";
  return `任务序号：${progress}，当前原文块编号：${guide}。任务序号和块编号只用于定位，不是待评价文字。${locationHint}`;
}

function emitStatus(state, message, result = null) {
  runtimeView = { state, message: message || "", result: result || null, pagePath: location.pathname };
  return chrome.runtime.sendMessage({ type: "EVALUATOR_STATUS", state, message, result, pagePath: location.pathname }).catch(() => null);
}

async function prepareBackgroundCapture(settings = {}) {
  useExtensionTimers = false;
  if (settings.backgroundCapture !== true) return;
  const response = await chrome.runtime.sendMessage({ type: "PREPARE_BACKGROUND_CAPTURE" });
  if (!response?.ok) throw new Error(response?.error || "无法建立后台运行会话");
  useExtensionTimers = true;
}

function releaseBackgroundCapture() {
  useExtensionTimers = false;
  return chrome.runtime.sendMessage({ type: "RELEASE_BACKGROUND_CAPTURE" }).catch(() => null);
}

async function sleep(ms) {
  const delayMs = Math.max(0, Math.round(Number(ms) || 0));
  if (useExtensionTimers && document.hidden) {
    try {
      const response = await chrome.runtime.sendMessage({ type: "BACKGROUND_DELAY", ms: delayMs });
      if (response?.ok) return;
    } catch (_error) {
      // If the service worker is unavailable, fall back to the page timer.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function clampInt(value, min, max, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
