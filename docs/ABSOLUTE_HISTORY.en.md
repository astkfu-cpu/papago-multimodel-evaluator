# Absolute module: English maintenance summary

This summary accompanies the retained [original Chinese maintenance history](ABSOLUTE_HISTORY.md). It distinguishes implemented maintenance themes from separately archived public source snapshots.

- Current maintained source: 0.28.1. It checks both reported progress and actual image/target-block changes before advancing, avoiding repeated scoring when only a counter changes.
- 0.27 maintenance notes distinguish image retrieval, visual failure, untranslated content, absent output and API errors; they strengthen rereading and recovery of the current item.
- 0.26 notes cover optional comment cleanup and separate localization/scoring cache pipeline versions to avoid unrelated UI changes invalidating caches.
- Earlier work covers independent source/target location, high-resolution cropping, background image reading, direction/provider isolation, persistent API caches, durable browser archives and migration.
- Earlier experimental disk-backup behavior was later replaced; the original notes are historical, not a promise that every old feature remains current.

The public project retains its original 0.25.0 Git history. Maintained 0.28.1 source was imported on 21 October 2026. There are no invented standalone patches for versions without independent archived source, and no backdated commits.

The old absolute module can use a 3/3 localization-failure fallback. It is distinct from pairwise evidence-based pause handling and should not be presented as human-confirmed scoring.
