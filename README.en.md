# Papago Translation Evaluation Toolkit

[中文](README.md) · [Download packages](dist/README.md) · [Installation](docs/INSTALLATION.md) · [Usage evidence](docs/USAGE_EVIDENCE.md)

Two independently maintained Edge / Chrome extensions for Papago-related image translation evaluation: online absolute scoring and offline whole-image pairwise comparison.

**Core maintainer: [astkfu-cpu](https://github.com/astkfu-cpu).** Responsible for task requirements, workflow and rule adaptation, implementation, debugging, release maintenance and translator support, with AI-assisted development and testing where appropriate.

The maintainer has provided the extensions free of charge to multiple translators across two real evaluation task rounds, refining them through repeated use and feedback. **Users supply their own API keys and pay model API charges themselves.** This is an independent project, not an official NAVER / Papago integration or endorsement.

## Choose the right module

| Module | Version | Workflow | Load directory |
| --- | --- | --- | --- |
| Absolute evaluator | 0.28.1 | Papago Pro source/translated image target-block scoring | Repository root |
| Pairwise evaluator | 1.0.2 | Complete source/A/B images; independent translation and rendering winners | `pairwise/` |

The pairwise module reads complete local image resources, checks direction and item identity per question, records both reasons, supports optional batches and exports durable offline reports. It never treats an API or image-loading failure as a tie. The legacy absolute workflow has different scoring rules and fallback behavior; see [known limitations](docs/KNOWN_LIMITATIONS.md).

## Install

1. Download the corresponding ZIP from [dist](dist/README.md), or clone the repository, then extract fully.
2. Open `edge://extensions/` or `chrome://extensions/`, enable Developer mode, and load the module directory containing `manifest.json`.
3. For the offline module, enable **Allow access to file URLs** in extension details. Open your authorized task package's `index.html`.
4. Configure your own API key in the side panel. Test connectivity and review one item before starting a batch.
5. To update, stop work, export backups, overwrite the same extension directory, reload the extension and refresh the task page. Keep the existing extension installation to preserve its local settings and archive.

## Evidence and maintenance

The supplied pairwise archives contain 47 evaluator accounts, six language directions and 37,497 analysis records. After deduplicating by account, task and item, 37,471 item records remain, with 37,431 marked applied. The maintainer confirms the accounts were used by multiple translators; account and record counts are reported with their methodology rather than presented as telemetry or independently audited headcounts. See the [evidence report](docs/USAGE_EVIDENCE.md), [anonymized result](examples/pairwise/evaluation-result.json) and [offline archive excerpt](examples/pairwise/archive-sample.html).

Maintenance includes independent source/target localization, native-image cropping, background reading, progress consistency, direction isolation, bounded API retries, structured-result recovery and archive-preserving updates. [CHANGELOG](CHANGELOG.md) distinguishes archived local versions from previously public Git history; no commit dates have been backdated.

```sh
npm test
```

Tests use synthetic data and mocked model responses. Browser and upgrade checks are documented in [TESTING](docs/TESTING.md). They validate control flow and storage, not model accuracy. No speedup percentage or human-versus-model accuracy claim is made without a measured comparison.

## Feedback, privacy and license

Report reproducible issues at [GitHub Issues](https://github.com/astkfu-cpu/papago-multimodel-evaluator/issues). Include browser/extension versions, expected behavior and redacted error details; do not post credentials or private task exports.

See [PRIVACY](PRIVACY.md), [SECURITY](SECURITY.md), [MAINTAINERS](MAINTAINERS.md) and [MIT LICENSE](LICENSE). Public examples have their own [data notice](examples/README.md); the code license does not grant rights to private customer datasets or third-party brands/images.

Names and account labels in the source records are translators' working aliases, not legal names. Published examples use additional anonymous identifiers and do not disclose personal mappings.


The public pairwise module uses a generic evaluation template. Internal customer rubrics are excluded; task-specific configuration must be supplied separately in an authorized environment. Existing private installations and archives are unchanged.
