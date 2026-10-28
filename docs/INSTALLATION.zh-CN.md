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

需要帮助时按 [反馈入口](https://github.com/astkfu-cpu/papago-multimodel-evaluator/issues/new/choose) 提交版本、复现步骤和脱敏错误信息。


公开版成对模块使用通用评价模板，已移除客户内部规则；实际任务中的专用规则需另行获准配置。本机既有客户专用插件和归档未被修改。
