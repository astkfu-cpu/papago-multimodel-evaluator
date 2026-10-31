# Tests and verified scope

[中文](TESTING.zh-CN.md)

## Local checks

Requirements: Node.js 20+, npm; browser regressions also need Playwright and a supported browser. The upgrade test uses Python (standard library only).

```sh
npm install
npm test
npm run verify:releases
npm run verify:docs
npx playwright install chromium
npm run test:demo
npm run test:upgrade
```

`npm test` covers absolute-module static/API-cache/target detection checks and 13 pairwise shared/backup unit tests. `verify:releases` checks ZIP digests and the recorded current source-file hashes; historical packages remain immutable.

`test:demo` runs actual extension browser workflows against the self-authored public fixture, with mocked Qwen responses in isolated profiles, then tests the archive UI. No customer package or real API key is needed. Windows defaults to installed Edge; Linux defaults to Playwright Chromium. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to select a browser.

`test:upgrade` opens actual archived public 1.0.2 code, creates records/settings, overwrites the same extension path with current code, and checks exact record/settings preservation and the same extension ID. It defaults to the immutable dist/1.0.2 ZIP. Set `PYTHON_EXECUTABLE` when Python is not available under the default command.

### Check Python on Windows

Run `python --version` first. A missing-Python message or Microsoft Store prompt means that command alias is not a working interpreter. If `py -3 --version` works, resolve the interpreter through the launcher in PowerShell:

```powershell
$env:PYTHON_EXECUTABLE = (py -3 -c "import sys; print(sys.executable)").Trim()
& $env:PYTHON_EXECUTABLE --version
npm run test:upgrade
```

If neither command works, install Python or set `PYTHON_EXECUTABLE` to the full path of an existing `python.exe`. The variable accepts an executable path, not a command with arguments such as `py -3`. This environment setting applies only to the current PowerShell session and its child processes; it does not update any installed extension.

## Verified release checks

The 1.1.0 Edge regression passed whole native image-byte checks, independent reasons, stale-advice hiding, cross-item write rejection, direction switching, bounded format recovery, throttling, stop/filter pauses and duplicate-page protection. Archive tests restored 514 records across 500-record cursor batches, preserved duplicate/conflicting existing rows, kept settings/keys isolated, and survived a browser restart. The file-selection/preview/confirm/download UI is also exercised.

GitHub Actions [run 39601728804](https://github.com/astkfu-cpu/papago-multimodel-evaluator/actions/runs/39601728804) passed unit and Linux browser jobs, including the public demo and upgrade checks. CI publishes isolated screenshots and summary artifacts. New documentation commits run CI again.

These tests verify application control flow, image reading and data protection. Mocked API responses do not measure live-provider availability, model accuracy, human agreement or speedup.

## Release verification regressions

`npm run verify:releases` first runs five isolated synthetic regressions, then checks the actual repository packages and recorded current source hashes. The regressions exercise the real verifier in a temporary fixture: valid current modules plus a historical package pass; a one-byte package change, changed/missing current source, or replaced historical package fails. Historical source may differ from today's source, but its package digest must still match. Fixtures contain synthetic bytes and never modify the repository's published ZIPs. These checks verify integrity enforcement, not ZIP extraction safety or model accuracy.

## Offline documentation links

`npm run verify:docs` runs synthetic checker regressions and validates inline local Markdown links/images and same-line reference destinations without network access. CI runs it in the unit job. Missing destinations, malformed URL encoding and paths outside the repository fail the check; diagnostics identify the file and line. Fenced/inline code examples and generated/dependency folders are excluded. Each reference definition is checked once, including unused definitions; diagnostics point to the definition rather than each use. External URLs, fragment anchors, HTML links, reference-use resolution (including undefined labels), and destinations on a following line are not validated, so passing this check does not establish that every documentation link works.

## CI installation and time budgets

The browser job reports Linux system-dependency installation and Chromium download as separate steps. This makes it easier to locate slow installation before tests begin; it does not make package mirrors faster. System dependencies have a 15-minute limit and Chromium download a 5-minute limit; the browser job has a 30-minute overall limit and the unit job a 10-minute limit. A timeout is an incomplete check, not a passing test or evidence of an extension defect. Review the failed step's logs before retrying. Test commands, mocked fixtures and archive-preserving upgrade checks remain the same.

## Optional separately authorized fixtures

Set `PAPAGO_PAIRWISE_PACKAGE` to a separately authorized local test package to replace the public fixture. `PAPAGO_PAIRWISE_PREVIOUS_ZIP` selects an archived upgrade package. Private customer fixtures/rubrics are excluded from the repository. Absolute browser tests are available through `npm run test:e2e`.

Earlier private maintenance records mention 10 unit checks, 18 browser scenarios and a 1.0.1-to-1.0.2 upgrade. These are historical controlled tests, not counts of human reviewers or public accuracy measurements.
