# 安装、首次使用与备份

[English](INSTALLATION.md)

## 选择与下载

- 在线 Papago Pro 打分：下载 [绝对打分 0.28.1](../dist/papago-absolute-evaluator-0.28.1.zip)。
- 本地离线 A/B 比较：下载 [成对评价 1.1.0](../dist/papago-pairwise-evaluator-1.1.0.zip)。

完整解压 ZIP，浏览器加载包含 `manifest.json` 的文件夹。若克隆整个仓库，在线插件加载根目录，成对插件加载 `pairwise`，不要同时将根目录误当作离线插件。

## 解压前核对下载包

从同一份 [GitHub Release](https://github.com/astkfu-cpu/papago-multimodel-evaluator/releases) 下载模块 ZIP 及附件 `releases.json`，放在同一个下载文件夹。在该文件夹打开 PowerShell，执行以下公开版成对安装包示例；检查其他清单内的包时只需修改 `$zipPath`：

```powershell
$zipPath = '.\papago-pairwise-evaluator-1.1.0.zip'
$manifest = Get-Content -LiteralPath '.\releases.json' -Raw | ConvertFrom-Json
$entry = @($manifest | Where-Object { $_.filename -eq (Split-Path -Leaf $zipPath) })
if ($entry.Count -ne 1) { throw 'Expected exactly one matching package in releases.json.' }
$actual = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
if ($actual -ine $entry[0].sha256) { throw 'SHA-256 mismatch. Download the ZIP and manifest again before installing.' }
'SHA-256 matches the release manifest.'
```

脚本只读取下载文件，不修改安装包或已安装扩展。出现匹配提示后再继续解压；若清单没有对应文件、文件缺失或哈希不一致，先停止安装并核对下载。哈希匹配说明 ZIP 与发布清单一致，不等于独立安全审计。预期值也可在仓库的[发布清单](../dist/releases.json)中查看。

## Node.js 跨平台替代方式

已有 Node.js 20+ 和仓库副本时，可在仓库根目录执行 `npm run verify:download -- "/path/to/package.zip"`。命令默认读取 ZIP 旁边的 `releases.json`；若清单在其他位置，在命令后追加清单路径作为第二个参数。包含空格的路径要加引号。成功时输出包名和 SHA-256；文件缺失、清单条目错误/重复或哈希不匹配时以非零状态退出，不解压、不安装、不改文件。这是上方 PowerShell 示例的替代方式，哈希含义相同。维护者可运行 `npm run test:download` 执行合成回归。

可运行 `npm run verify:download -- --help`（或 `-h`）查看用法，不读取安装包或清单。支持开头带 BOM 文件头的 UTF-8 清单；错误 JSON 或哈希不一致仍会失败，不改写原文件。

若浏览器给下载文件改名（例如添加 `(1)`），可在 ZIP 和可选清单参数之后追加 `--filename "原文件名.zip"`，指定可信发布清单中的精确原文件名。例如：`npm run verify:download -- "/path/to/package (1).zip" --filename "package.zip"`。工具读取改名后的文件，以指定的唯一清单条目校验内容，不改文件名，也不凭相同哈希猜测模块。条目缺失、重复或文件内容不一致仍会失败。不使用此选项时，下载文件名仍须与清单完全一致。

供脚本调用时，可加 `--json`，成功后仅输出一个包含 `filename`（选中的清单文件名）和 `sha256` 的 JSON 对象。例如：`node scripts/verify-download.mjs "/path/to/package.zip" --json`，也可与 `--filename` 组合。失败仍非零退出，诊断写入 stderr，stdout 为空；使用结果前应先检查退出状态。解析 stdout 时直接调用 Node，避免 npm 自身的命令提示混入输出。默认的人读输出保持不变。

### 可选：只读检查解压后的扩展目录

已有 Node.js 20+ 和仓库副本时，可在仓库根目录运行 `npm run check:unpacked -- "/path/to/extracted-extension"`，在“加载解压缩的扩展”前检查目录。选择直接包含 `manifest.json` 的文件夹。检查仓库副本时，绝对评价用 `npm run check:unpacked -- .`，成对模块用 `npm run check:unpacked -- ./pairwise`。可用 `--help` 查看用法。

工具检查 Manifest V3 的名称/版本字段，以及声明的后台 service worker、侧栏页面、内容脚本 JavaScript/CSS 文件。缺文件、用目录代替文件、列表格式错误或绝对/越界声明路径会以非零状态失败。成功时输出名称、版本和去重后声明文件数的 JSON 摘要。不安装、不改文件或浏览器设置、不读取归档、不调用 API。`npm run test:unpacked` 使用合成样本和两个公开模块目录，在 Windows/Ubuntu CI 执行。

这是有限范围的安装前检查，不代表浏览器已成功加载，也不是安全或哈希审计。它不追踪 import/HTML 引用，不验证所有 manifest 字段、图标、权限或浏览器版本兼容性；仍须执行本指南中的 ZIP 校验和浏览器步骤。独立演示是网页，没有扩展 manifest。

## 安装与配置

1. Edge 打开 `edge://extensions/`，Chrome 打开 `chrome://extensions/`。
2. 开启“开发人员模式”，点击“加载解压缩的扩展”，选择对应文件夹。
3. 成对插件点击“详细信息”，开启“允许访问文件 URL/网址”。
4. 在线插件打开获准访问的 Papago Pro 评价页；成对插件先完整解压自己的任务包，再用普通浏览器窗口打开 `index.html`，保持任务方预选语言方向和评价员 ID。
5. 点击扩展图标打开侧栏，输入自己的 API Key 和官方接口。插件免费，调用费用由自己的 API 账号承担。
6. 先“测试接口”，再“分析当前张/只评当前张”，核对完整内容、两项建议和理由，最后选择是否填入或连续评价。

## 离线任务的保存与恢复

- 原表自动保存已选答案。每天结束或提交节点点击原表顶部“결과 내보내기”，保留下载 JSON 的原名和内容。
- 右侧“导出当前任务报告”保存模型理由与复核信息，HTML 可离线查看；它不能代替客户要求的正式 JSON。
- 原表“결과 가져오기”用于恢复原表结果，导入可能覆盖同题答案；不要随意导入别人的或过期的文件。
- 模型内容审核或格式自动恢复后仍无效时，本题不自动填入；可在原表人工判断，再继续。
- 原表页码与侧栏分析题号可能在手动切题后不同，请核对当前题号，不拿旧建议修改新题。

## 更新

停止连续任务，先导出两种备份。将新版文件覆盖在当前安装目录，点击原扩展卡片的“重新加载”，刷新任务页。不要卸载扩展、删除浏览器配置、清除扩展数据或改用另一个目录安装，以保留同一扩展 ID 和归档。在线与离线插件各自更新。

## 常见问题

“无法连接离线表”：检查加载目录、文件 URL 权限及是否刷新原表。“密钥错误/401”：检查账号、地域与模型权限。“DataInspectionFailed”：模型平台审核拦截，与格式校验不同；人工复核当前项。“返回理由缺失”：1.0.2 会携带完整图片有界重试，失败则暂停。

### 在线绝对评价模块：取图错误恢复

以下提示来自加载仓库根目录的在线绝对评价模块。调整取图设置前先停止当前运行，核对原任务标签页和当前题目，再明确重试单题分析。

| 错误提示 | 恢复方法 |
| --- | --- |
| `Papago页面当前不可见` | 选中原 Papago 标签页，恢复最小化的窗口，并让该浏览器窗口获得焦点。前台取图同时检查这三个条件；页面仅在其他标签页或失焦窗口中打开仍不满足要求。 |
| `后台取图权限尚未授权` 或 `Edge 未授予后台取图权限` | 在同一浏览器配置中，从原扩展卡片重新加载扩展；仅在确实希望授予权限时接受权限提示，然后刷新任务页。权限仍被拒绝时，让“切换标签页或最小化后继续”保持未勾选，使用上方前台取图方式。保留已有扩展安装和归档。 |
| `无法连接后台Papago页面`，并提示开发者工具 | 停止运行，关闭该任务页附带的开发者工具，让原任务窗口回到前台后重试。仍失败时保留错误供脱敏反馈，不要清除扩展数据。 |

“切换标签页或最小化后继续”是绝对评价模块的后台取图选项。恢复可见性或权限不代表分析已成功；填入前仍须核对新结果。

需要帮助时按 [反馈入口](https://github.com/astkfu-cpu/papago-multimodel-evaluator/issues/new/choose) 提交版本、复现步骤和脱敏错误信息。


公开版成对模块使用通用评价模板，已移除客户内部规则；实际任务中的专用规则需另行获准配置。本机既有客户专用插件和归档未被修改。
