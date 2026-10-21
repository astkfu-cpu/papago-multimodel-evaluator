# Privacy and data handling

[Original Chinese notice](PRIVACY.md)

- The root extension runs on supported online evaluation pages; the pairwise extension reads authorized local task files.
- Images selected for real analysis are sent to the configured DeepSeek or Alibaba Cloud DashScope API. Keys are stored in the browser extension's local settings; real credentials are excluded from the repository.
- There is no telemetry/usage tracking service. Public usage statistics are computed from maintainer-supplied archive exports.
- Each extension uses its own browser-profile IndexedDB archive. Keep the same installation/ID during updates; uninstalling or clearing the profile can remove records. Pairwise JSON backups restore missing plugin records, not official page progress or settings.
- Public actual examples are separately selected and anonymized, removing original accounts, customer task IDs, local paths, request tracing IDs and private filename mappings. Source names are working aliases rather than legal names; personal mappings are not published.
- Private raw archives, official customer result files, communications and complete task packages are excluded. Published examples retain original model judgments and are not a human gold standard.
- The public pairwise template excludes internal customer rubrics. Self-authored simulated demos are explicitly identified. The code license does not transfer rights to private or third-party task data.

The original Chinese notice included in earlier released ZIPs retains its published bytes. This English notice describes the same project data boundaries and the current archive backup feature.
