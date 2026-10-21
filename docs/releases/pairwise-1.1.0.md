# Pairwise 1.1.0-public.1 — 2026-10-21

- Hide stale suggestions and disable filling when item identity, image, direction or loading state changes. Existing backend checks remain in place.
- Label confidence as model self-reported confidence, not calibrated accuracy.
- Add versioned JSON archive backup, read-only preview, duplicate/conflict counts and transactional restore of missing records only. Existing records/settings and official sheet progress are never overwritten by restore.
- Bound exports to 500 records per batch, with current task/account and Beijing creation-date filters.
- Include a self-authored public browser fixture and extend browser regression to navigation, pagination and recovery. Generic public rubric only; no private customer guidelines.

Upgrade: stop the extension, export backups, overwrite the same public extension directory, reload and refresh the task page. Keep the extension ID and browser profile; do not uninstall. The archive database name/version remains unchanged. This public template is not a replacement for separately configured private client rules.

SHA-256 and source hashes: attached releases.json. Unzip the package and load the folder containing manifest.json. Free plugin; any real API use is billed to your own account.
