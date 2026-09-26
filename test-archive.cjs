const { chromium } = require("playwright");
const http = require("http");
const path = require("path");
const assert = require("assert/strict");
const { browserLaunchOptions } = require("./test-browser-launch.cjs");

(async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>archive-test</title>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch(browserLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => {
      window.chrome = {
        runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} } },
        tabs: {}, debugger: {}, storage: { local: {} }
      };
    });
    await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("papago-evaluation-detailed-archive", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("evaluations", { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("accountLabel", "accountLabel", { unique: false });
        store.createIndex("accountTaskKey", "accountTaskKey", { unique: false });
        store.add({ id: "v17-record", accountLabel: "旧版本账号", taskId: "旧任务", accountTaskKey: "旧版本账号\u0000旧任务", sourceText: "旧记录", createdAt: 1 });
      };
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    }));
    await page.addScriptTag({ path: path.join(__dirname, "background.js") });
    const result = await page.evaluate(async () => {
      const first = await saveDetailedArchiveEntry({
        account_label: "审查账号A", task_id: "E2600999", task_route: "7001/8001", batch_code: "E2600999",
        item_index: 1, language_pair: "en-ja", model: "deepseek-flash",
        source_text: "source", target_text: "訳文", translation_score: 4,
        rendering_score: 3, confidence: 0.88, reason: "test"
      }, 1);
      const third = await saveDetailedArchiveEntry({
        account_label: "审查账号A", task_id: "E2600999", task_route: "7001/8001", batch_code: "E2600999",
        item_index: 3, language_pair: "en-ja", model: "deepseek-flash",
        source_text: "source-3", target_text: "訳文3", translation_score: 3,
        rendering_score: 4, confidence: 0.91, reason: "backfill-test"
      }, 1);
      await saveDetailedArchiveEntry({
        account_label: "审查账号B", task_id: "7002/8002", item_index: 2,
        language_pair: "ja-en", source_text: "原文", target_text: "target"
      }, 2);
      const summary = await getDetailedArchiveSummary();
      const records = await getDetailedArchivePage(0, 10);
      const root = await navigator.storage.getDirectory();
      const disk = await appendDetailedArchiveToDirectory(root, first);
      const backfill = await flushArchiveEntriesToDirectory(root, [first, third]);
      const backfillAgain = await flushArchiveEntriesToDirectory(root, [first, third]);
      const identityA = { taskId: "E2600999", taskRoute: "7001/8001", languagePair: "en-ja" };
      const identityB = { taskId: "E2600999", taskRoute: "7001/8002", languagePair: "ja-en" };
      const keyA = backupDirectoryConfigKey(identityA);
      const keyB = backupDirectoryConfigKey(identityB);
      const keyAWithCorrectedHeader = backupDirectoryConfigKey({ ...identityA, taskId: "E2601000" });
      await writeArchiveConfig({ key: keyA, name: "任务A目录", updatedAt: Date.now() });
      await writeArchiveConfig({ key: keyB, name: "任务B目录", updatedAt: Date.now() });
      const configA = await readArchiveConfig(keyA);
      const configB = await readArchiveConfig(keyB);
      const archiveRoot = await root.getDirectoryHandle(DISK_ARCHIVE_ROOT_NAME);
      const account = await archiveRoot.getDirectoryHandle("审查账号A");
      const task = await account.getDirectoryHandle("E2600999__7001-8001");
      const file = await (await task.getFileHandle("评价明细.jsonl")).getFile();
      const diskText = await file.text();
      return { summary, records, disk, diskText, backfill, backfillAgain, keyA, keyB, keyAWithCorrectedHeader, configA, configB };
    });
    assert.equal(result.summary.total, 4);
    assert.equal(result.summary.accounts.length, 3);
    assert.equal(result.records.length, 4);
    assert(result.records.some((record) => record.sourceText === "旧记录"), "v0.17 archive must survive v0.18 upgrade");
    const currentRecord = result.records.find((record) => record.sourceText === "source");
    assert.equal(Object.hasOwn(currentRecord, "apiKey"), false);
    assert.equal(currentRecord.taskId, "E2600999");
    assert.equal(currentRecord.taskRoute, "7001/8001");
    assert.equal(result.disk.saved, true);
    assert.match(result.diskText, /"taskId":"E2600999"/);
    assert.match(result.diskText, /"sourceText":"source-3"/);
    assert.equal(result.backfill.recovered, 1);
    assert.equal(result.backfillAgain.recovered, 0);
    assert.equal(result.configA.name, "任务A目录");
    assert.equal(result.configB.name, "任务B目录");
    assert.notEqual(result.keyA, result.keyB);
    assert.equal(result.keyA, result.keyAWithCorrectedHeader);
    await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(ARCHIVE_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }));
    console.log(JSON.stringify({ indexedDbUpgradePreserved: true, indexedDbWrite: true, diskJsonlAppend: true, diskBackfillDeduplicated: true, stableTaskStorageKey: true, perTaskBackupIsolation: true, groupedAccounts: 3, pagedRecords: 4, secretsExcluded: true }));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
