# Standalone public demo

[中文](README.md) · [UI glossary](../docs/UI_GUIDE.md)

Unzip the [demo release](https://github.com/astkfu-cpu/papago-multimodel-evaluator/releases/tag/demo-v1.0.0) and open index.html in Edge/Chrome. Enter any space-free demo alias, select **模拟分析当前题** (Simulate analysis), review both reasons, then **确认模拟结果并填入** (Confirm simulated result and fill). Navigate, switch direction, reload saved page progress and export demonstration records.

The built-in simulation requires no API key, extension or network. It uses predetermined decisions, clearly labelled as simulation. It does not run a vision model or measure accuracy. Simulation records last for the current page session; task-page judgments are stored in the browser.

For real model analysis, separately load `pairwise/`, allow file URLs and configure your own Qwen vision key. Use the extension panel; complete 900×1400 source/A/B images are sent to the configured API and incur charges. Scroll each image to inspect bottom text. Production extension code does not install a mock API.

All demo page code/images are self-authored and MIT licensed. Eight workflow items repeat two direction-specific cases, four EN→JA and four JA→EN; these are not eight independent benchmark samples. Author-designed reference: A retains admission price 12 while B changes it to 21; A shrinks the title while B keeps the source size. Hence simulated translation A / rendering B.

Demonstration result JSON, simulated-record JSON, plugin archive JSON and official customer result JSON are separate formats. The English repository guide accompanies the immutable original-language demo package.

Automated extension checks: `npm install`, `npx playwright install chromium`, `npm run test:demo`. They use this public fixture and mocked Qwen responses in isolated browser profiles. See [test scope](../docs/TESTING.md).
