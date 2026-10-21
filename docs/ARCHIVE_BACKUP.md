# Plugin archive backup and restore

[中文](ARCHIVE_BACKUP.zh-CN.md) · [UI glossary](UI_GUIDE.md)

This feature restores the pairwise extension's analysis archive. Official task-page progress and API settings are separate. Restoring an archive does not write judgments back into the task page.

## Export all required batches

Stop evaluation. Expand **长期离线记录 → 筛选与分批导出 / 恢复** (Archive → Filter/export/restore). Choose all records or the current task/account, and optionally a creation-date range in Beijing time. Select JSON backup or HTML report.

Click **导出下一批** (Export next batch). Each file contains at most 500 records in record-ID order. Continue until the UI says the selected range is complete; keep every file. Changing the scope, dates or format resets the cursor; a reset button is also available. Keep the archive stable during export: newly inserted IDs can fall before an existing cursor, requiring a fresh export.

Shortcut report buttons export only the first 500 selected records. For a full backup, use the batch controls. HTML is for reading; only JSON with schema `papago_pairwise_assistant_backup/v1` supports restoration. This schema differs from official customer results.

## Preview and restore

Stop evaluation, select one plugin backup JSON, inspect the total/new/existing/conflicting counts, then explicitly confirm. Repeat for each batch.

Restoration is transactional and additive. Existing record IDs are always preserved. Same-ID content conflicts are counted and skipped. Reimporting the same batch adds no duplicates. Invalid schemas/records, duplicate IDs inside one file and official-result JSON are rejected before restoration; a write failure aborts the transaction.

Backups retain local image links, task/work-account identifiers, decisions, reasons, timestamps and archive save flags. They omit image bytes, API configuration/keys and private model reasoning. Image links may break when the original task folder moves; the text evidence remains readable. Keep working backups private and anonymize any separately approved public copy.

The database name/version remains unchanged. Preserve the same extension directory/ID and browser profile during upgrades. Public templates and customer-specific installations are maintained separately.
