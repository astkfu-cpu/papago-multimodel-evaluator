# Changelog

[中文](CHANGELOG.zh-CN.md)

Local historical versions were publicly imported on **21 October 2026**. Existing GitHub history remains intact; import timestamps are actual publication dates and were not backfilled.

## English review documentation — 21 October 2026

- Make English the default repository README, retaining the Chinese entry point.
- Add English installation, evidence, tests, backup/restore, maintainer, privacy, contribution, feedback and evaluation documentation.
- Provide an English UI glossary and an English explanation alongside the unchanged original anonymized example.
- Preserve published runtime/package bytes and checksums; translations are repository documentation updates.

## Pairwise 1.1.0-public.1 — 21 October 2026

- Hide mismatched suggestions on item/image/direction changes and disable filling; retain backend identity checks.
- Label confidence as model self-reported and uncalibrated.
- Add versioned plugin JSON backup, read-only preview, duplicate/conflict counts and transactional insertion of missing archive records only.
- Add date/current-task filters and at most 500 records per export batch.
- Add a self-authored public demo, mocked-API browser CI, package verification and formal Releases.
- Document future human evaluation/user-feedback collection without claiming completed results.

## Pairwise 1.0.2

- Require all output fields; normalize unambiguous wrappers and valid enum casing.
- Separate bounded JSON/status/reason recovery from image-evidence rechecking, with at most two extra full-image format attempts.
- Retain content-filter, uncertainty and image-state pauses; technical errors do not become ties.
- Preserve the IndexedDB database/settings and test overwrite upgrades.

## Pairwise 1.0.1

- Respect the configured batch limit and remove the software-enforced 25% pause/acknowledgment.
- Preserve submission reminders, error/review pauses and manual stop.
- Check progress boundaries, direction changes and archive retention.

## Pairwise 1.0.0

- Introduce whole-image source/A/B comparison, separate translation/rendering winners and reasons.
- Verify per-item direction, image loading, identity and page save state; protect against duplicate sheets and stale writes.
- Introduce durable IndexedDB archives and offline HTML reports.

## Absolute 0.28.1 and earlier

Check actual image/block transitions together with progress. Historical 0.26/0.27 notes describe cache separation, optional comment cleanup and failure/recovery distinctions. Existing 0.25.0 public commits remain preserved. See the [English history summary](docs/ABSOLUTE_HISTORY.en.md) and [original history](docs/ABSOLUTE_HISTORY.md).

Public pairwise releases use a generic template. Private customer guidelines and installations are maintained separately.
