# Human comparison plan and evidence limits

[中文](EVALUATION.zh-CN.md)

An independent human comparison benchmark has not yet been completed. No accuracy, measured time saving or calibrated confidence is reported. The UI's model self-reported confidence is returned by the model; the default 0.85 automation threshold does not imply 85% correctness.

The demo repeats two self-authored direction-specific cases as eight workflow items. Reference decisions are designed by the author for software regression, not independently collected human judgments or eight independent benchmark cases.

## Proposed small-scale study

1. Select separately approved or self-authored complete source/A/B sets covering small text, numbers, omissions, overlap, clipping and actual ties. Start with a few representative independent cases and expand.
2. Qualified bilingual reviewers judge translation and rendering separately before seeing model output. Record evidence and disagreements; retain unresolved cases.
3. Record model/rule/image versions. Repeat with A/B swapped, normalize labels, and treat both orders as one underlying case.
4. Report per-dimension agreement, unresolved rates and swap consistency, with sample counts, failures and retries. Separate human-disagreement cases.
5. Only calibrate confidence thresholds when sample coverage supports it. Measure workflow time separately on the same task group; archive volume cannot establish time saved.

Suggested fields: case ID, image hashes, direction/order, human decisions/reasons, model decisions/reasons, self-reported confidence, retries, adjudication and elapsed time. Obtain publication consent and protect identities and task rights.
