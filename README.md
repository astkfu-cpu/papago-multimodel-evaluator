# Papago Translation Evaluation Toolkit

[中文说明](README.zh-CN.md) · [Releases](https://github.com/astkfu-cpu/papago-multimodel-evaluator/releases) · [Install](docs/INSTALLATION.md) · [Evidence](docs/USAGE_EVIDENCE.md) · [Maintainer](MAINTAINERS.md)

[![Tests](https://github.com/astkfu-cpu/papago-multimodel-evaluator/actions/workflows/ci.yml/badge.svg)](https://github.com/astkfu-cpu/papago-multimodel-evaluator/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

Two Edge / Chrome extensions that assist image-translation evaluation: online absolute scoring and offline whole-image A/B comparison. They help reviewers collect image evidence, compare translation and rendering separately, keep reasons, and organize local records.

**Core maintainer: [astkfu-cpu](https://github.com/astkfu-cpu)** — requirements, workflow adaptation, implementation, bug reproduction, regression checks, releases and translator support, with Codex-assisted development.

The maintainer has provided the tools free to multiple translators across two real evaluation task rounds. **The plugins are free; users configure their own API keys and pay model API charges.** This independent project adapts Papago-related evaluation workflows; it has no official NAVER/Papago affiliation or endorsement.

## Start with the public demo

[Download the standalone demo](https://github.com/astkfu-cpu/papago-multimodel-evaluator/releases/tag/demo-v1.0.0), unzip it and open `index.html` in Edge/Chrome. Its built-in simulation needs no extension, customer package, network access or API key. All demo images and page code are self-authored. Simulated decisions are explicitly labelled; they are not a model accuracy benchmark.

For a real model call on these public images, load the pairwise extension and configure your own key. See [demo instructions](demo/README.en.md) and the [English UI guide](docs/UI_GUIDE.md).

![Self-authored offline demo with an explicitly simulated result](docs/screenshots/public-demo.png)

## Choose a module

| Module | Current version | Input and output | Load directory |
| --- | --- | --- | --- |
| [Absolute evaluator](docs/ABSOLUTE.md) | 0.28.1 | Source/translated image target blocks; translation/rendering scores | Repository root |
| [Pairwise evaluator](pairwise/README.en.md) | 1.1.0-public.1 | Complete source/A/B images; separate A/tie/B decisions, reasons and archives | `pairwise/` |

The modules have separate manifests, databases and evaluation rules. The public pairwise release uses a generic comparison template; internal customer rubrics are excluded and require separately authorized configuration.

## Install and use

1. Download a module ZIP from [Releases](https://github.com/astkfu-cpu/papago-multimodel-evaluator/releases) and extract it fully.
2. Open `edge://extensions/` or `chrome://extensions/`, enable Developer mode, then load the folder containing `manifest.json`.
3. For offline comparison, enable **Allow access to file URLs** and open the extracted task's `index.html`.
4. Configure your own Qwen/DashScope or DeepSeek key as supported by the selected module. Review a single item before using optional continuous mode.
5. Before updating, stop work and export backups. Overwrite the same extension directory, reload the existing extension and refresh the task page. Keep the same installation/profile to preserve its ID and records.

[Full installation guide](docs/INSTALLATION.md) · [Archive backup and restore](docs/ARCHIVE_BACKUP.md) · [Known limitations](docs/KNOWN_LIMITATIONS.md)

## What can be verified

| Evidence | Scope |
| --- | --- |
| Two task rounds and use by multiple translators | Maintainer-reported practice; free plugins, user-funded APIs |
| 47 archive files / 47 work accounts | Supplied pairwise HTML archive snapshot, 21 October 2026 |
| 37,471 deduplicated item records | 37,497 raw analysis records; 37,431 marked applied |
| Three language groups / six directions | English, Japanese and Simplified Chinese |
| Automated browser and upgrade checks | Mocked API responses and isolated browser profiles |

The [evidence report](docs/USAGE_EVIDENCE.md) gives the counting method and limitations. Account labels are translators' working aliases, not legal names; public examples are further anonymized. Activity counts are not independently audited headcounts, client acceptance or accuracy results.

[Actual anonymized example](examples/README.md) · [English explanation of the stored model result](examples/pairwise/REVIEW.en.md) · [Machine-readable summary](examples/usage-summary.json)

## Maintenance and tests

Pairwise 1.1.0 adds stale-suggestion invalidation, a clear model self-reported confidence label, versioned JSON backup/restore with duplicate/conflict preservation, and filtered exports of at most 500 records per batch. Backend item checks remain in place before filling. An API or image-loading failure is never automatically converted into a tie.

```sh
npm install
npm test
npm run verify:releases
npx playwright install chromium
npm run test:demo
npm run test:upgrade
```

The public fixture lets reviewers reproduce browser checks without a customer package or paid API call. See [testing](docs/TESTING.md), [changelog](CHANGELOG.md), [Releases](https://github.com/astkfu-cpu/papago-multimodel-evaluator/releases) and [commit history](https://github.com/astkfu-cpu/papago-multimodel-evaluator/commits/main/). Local historical versions were imported on the actual publication date; commit dates were not backfilled.

No independent human accuracy benchmark or public user interview has been completed. The [evaluation plan](docs/EVALUATION.md) and [feedback process](docs/USER_FEEDBACK.md) explain what remains to collect. Model confidence is self-reported and uncalibrated.

## Contribute, privacy and license

Use [GitHub Issues](https://github.com/astkfu-cpu/papago-multimodel-evaluator/issues/new/choose) for reproducible, redacted reports. See [contribution guidance](CONTRIBUTING.md), [security](SECURITY.md), [English privacy notice](PRIVACY.en.md) and [MIT License](LICENSE).

Current extension UI labels and stored model rationales are primarily Chinese. The English documentation and UI glossary provide a review path; translated example commentary is kept separate from original records. Existing release ZIPs retain their published bytes and checksums. Private customer-specific installations and archives are maintained separately.
