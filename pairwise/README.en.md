# Whole-image pairwise evaluator — public template

[Original Chinese module guide](README.md) · [Install](../docs/INSTALLATION.md) · [UI glossary](../docs/UI_GUIDE.md)

Current public release: **1.1.0-public.1**. Core maintainer: astkfu-cpu. The extension is free; users configure and pay for their own Qwen/DashScope API calls.

Read complete source/A/B images, verify per-item direction and identity, compare translation/rendering separately, retain specific reasons, and keep durable local records. Single-item analysis requires confirmation before filling; optional continuous mode fills only eligible results. Failures and insufficient evidence pause instead of becoming ties.

1. Load this directory through Edge/Chrome's Load unpacked, then allow file URLs.
2. Open an authorized fully extracted task package, or the self-authored public demo.
3. Configure a supported endpoint/key; analyze and review a single item first.
4. Use optional batches, stop/review controls and [archive exports](../docs/ARCHIVE_BACKUP.md) as needed.
5. Update in the same extension directory/profile to preserve ID, settings and records.

1.1.0 hides mismatched old advice, labels confidence as model self-reported, and supports versioned JSON backup with preview and additive duplicate/conflict-safe restoration. Exports are bounded to 500 records per batch. Official sheet results remain separate from plugin archives.

The public rubric is generic. Internal customer guidelines are excluded and require separate authorized configuration. Original private installations are maintained separately. Existing ZIPs retain their published bytes, including original-language documentation.

Run `npm test`, `npm run test:demo` and `npm run test:upgrade` from the repository root; see [testing](../docs/TESTING.md). The public demo and mocked API checks do not measure live model accuracy.
