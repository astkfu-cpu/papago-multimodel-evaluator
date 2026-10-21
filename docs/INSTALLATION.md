# Installation, first use and updates

[中文](INSTALLATION.zh-CN.md) · [UI glossary](UI_GUIDE.md)

## Download and load

| Use case | Package | Directory to load |
| --- | --- | --- |
| Online absolute scoring | [0.28.1 ZIP](../dist/papago-absolute-evaluator-0.28.1.zip) | Extracted folder containing manifest.json |
| Offline whole-image comparison | [1.1.0 ZIP](../dist/papago-pairwise-evaluator-1.1.0.zip) | Extracted folder containing manifest.json |
| No-key demonstration | [Public demo ZIP](../dist/papago-public-demo-1.0.0.zip) | Open index.html directly |

When cloning the entire repository, load the root for absolute scoring, or `pairwise/` for comparison. These are separate extensions.

1. Open `edge://extensions/` or `chrome://extensions/` in a normal browser profile.
2. Enable Developer mode, select **Load unpacked**, and select the corresponding module directory.
3. For the pairwise extension, open its Details and enable **Allow access to file URLs**.
4. Open an authorized task: the supported online page for absolute scoring, or the fully extracted offline package's index.html for pairwise comparison. Preserve the assigned evaluator ID and language directions. Keep one offline task page open.
5. Open the extension side panel and configure your own model API key and supported official endpoint. The plugin is free; API usage is charged to your account.
6. Test connectivity, analyze one item, check complete image evidence and both reasons, then choose whether to fill or start an optional batch.

## Separate official results from plugin archives

The original task page saves judgments in the browser. Use its **결과 내보내기 / Export results** and **결과 가져오기 / Import results** for the official result format. Follow the task owner's submission requirements and preserve exported official filenames/content.

The extension's HTML reports and versioned JSON backups contain model evidence and archive status. They do not replace official result files; restoring a plugin backup does not restore task-page progress. See [archive recovery](ARCHIVE_BACKUP.md).

## Update safely

Stop evaluation and export the appropriate backups. Overwrite files in the same extension directory, reload the existing extension and refresh the task page. Preserve its extension ID and browser profile; uninstalling or clearing extension data can remove local records. Update the two modules separately.

The public pairwise module has a generic template; it does not supply private customer rules or automatically update a private client installation.

## Troubleshooting

- Cannot connect to the offline sheet: verify the loaded directory, file-URL permission and refreshed page.
- HTTP 401: check the provider key, region and model access.
- DataInspectionFailed/content filtering: a provider response restriction; inspect the item manually. It is not a JSON-format error.
- Missing output fields: bounded full-image format recovery may run; persistent failure pauses without filling.
- Changed item/direction/images: old mismatched advice is hidden and filling disabled. Reanalyze the current item.

Report extension/browser versions, steps and redacted errors through [Issues](https://github.com/astkfu-cpu/papago-multimodel-evaluator/issues/new/choose).
