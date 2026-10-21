# Real-world use and reviewable evidence

[中文](USAGE_EVIDENCE.zh-CN.md)

The maintainer reports providing both extensions free to multiple translators across two real evaluation task rounds, with users paying their own API costs. This is a statement about practical use, not official Papago affiliation or certification.

## Archive snapshot and method

Snapshot: **21 October 2026**, from **47 supplied pairwise HTML archive exports** containing **37,497 analysis records**. Deduplicate by `(evaluator label, sheet ID, pair ID)` and retain the latest updated record: **37,471 item records**, including **37,431 marked applied**. The snapshot contains **47 work accounts, three language groups and six directions**.

| Direction | Deduplicated records | Marked applied |
| --- | ---: | ---: |
| EN_JA | 7,531 | 7,495 |
| EN_ZH-CN | 5,544 | 5,542 |
| JA_EN | 7,600 | 7,600 |
| JA_ZH-CN | 5,596 | 5,594 |
| ZH-CN_EN | 5,600 | 5,600 |
| ZH-CN_JA | 5,600 | 5,600 |

The maintainer confirms that multiple translators used the accounts. These counts describe records and software save flags; they do not independently establish unique people, human review or client acceptance. The snapshot excludes the first online task round's complete usage. No telemetry-based download or active-user estimate is claimed.

[Machine-readable summary](../examples/usage-summary.json). Recompute locally with `python scripts/summarize-archives.py <archive-directory>`; the script is read-only and outputs aggregates rather than aliases, task IDs or local paths. Private source archives are not distributed.

## Actual anonymized example

One full source/A/B image set was selected without faces, contact details or customer communications. Public copies omit work-account mappings, task identifiers, device metadata and local paths.

- [Source](../examples/pairwise/images/source.jpg), [A](../examples/pairwise/images/A.jpg), [B](../examples/pairwise/images/B.jpg)
- [Stored model result](../examples/pairwise/evaluation-result.json)
- [English explanation](../examples/pairwise/REVIEW.en.md)
- [Offline HTML excerpt](../examples/pairwise/archive-sample.html)

The original model judgments/reasons remain intact. They may contain errors and are not a human gold standard or accuracy test. Names in the source archives are translators' working aliases, not legal names; public examples use additional anonymous identifiers.

| Complete source | A | B |
| --- | --- | --- |
| <img src="../examples/pairwise/images/source.jpg" width="220" alt="Complete source image"> | <img src="../examples/pairwise/images/A.jpg" width="220" alt="Complete candidate A"> | <img src="../examples/pairwise/images/B.jpg" width="220" alt="Complete candidate B"> |

## Maintenance evidence

[Commits](https://github.com/astkfu-cpu/papago-multimodel-evaluator/commits/main/) preserve existing public history and identify later imports of actual local 1.0.0, 1.0.1 and 1.0.2 snapshots. Absolute scoring was synchronized to maintained 0.28.1. Import dates are actual publication dates, not reconstructed development dates. Subsequent 1.1.0 work adds stale-result UI protection, archive recovery and a self-contained public fixture.

[Tests](TESTING.md), [changelog](../CHANGELOG.md) and [Releases](https://github.com/astkfu-cpu/papago-multimodel-evaluator/releases) document software verification. An independent human accuracy benchmark and consented public user interviews have not yet been completed; see the [evaluation plan](EVALUATION.md) and [feedback process](USER_FEEDBACK.md).
