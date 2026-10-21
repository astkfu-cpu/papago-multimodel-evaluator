# Known limitations / 已知限制

- Browser page structures may change; adapters require maintenance and regression checks.
- Vision models can misread small text, numbers, names and complex layouts. Model confidence is not a calibrated accuracy score.
- API access, rate limits, network errors and provider content filters can interrupt requests.
- Structured output recovery is bounded and may still require manual review.
- Public comparison templates are generic; task owners must separately supply and verify their requirements.
- Browser-local archives depend on the existing installation/profile. Versioned JSON backups restore missing plugin records only; they do not restore official sheet progress, API settings or image files. Exports are bounded to 500 records per batch; keep every batch.
- Pairwise 1.1.0 hides mismatched advice on page-change notifications and rechecks identity during polling and before filling. A polling fallback can have a short delay; interrupted page adapters leave filling disabled.
- Usage statistics describe archived activity, not an accuracy benchmark, client acceptance or a measured speedup.
