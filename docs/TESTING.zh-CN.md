# 测试与可验证范围

[English](TESTING.md)

## 本地检查

需要 Node.js 20+ 和 npm；浏览器回归另需 Playwright 和支持的浏览器。升级测试需要 Python，仅使用标准库。

在仓库根目录运行：

```sh
npm install
npm test
npm run verify:releases
npx playwright install chromium
npm run test:demo
npm run test:upgrade
```

`npm test` 包括绝对评价模块的静态、API 缓存、定位检测和目标流水线检查，以及成对模块的 13 项 shared/backup 单元测试。两套模块使用各自的评价规则。`verify:releases` 核验 ZIP 摘要和清单中的当前源文件哈希，历史安装包保持不变。

`test:demo` 默认使用仓库自制的公开 `demo/`，在隔离浏览器配置中运行扩展流程和归档界面检查，使用模拟 Qwen 响应，无需客户任务包或真实 API Key。Windows 默认使用已安装的 Edge，Linux 默认使用 Playwright Chromium；可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定浏览器。

`test:upgrade` 默认读取不可变的公开 `dist/papago-pairwise-evaluator-1.0.2.zip`。测试先用真实旧版代码建立合成记录和设置，再在隔离目录中同路径覆盖为当前版，核对扩展 ID、记录和设置完全保留，无需私有旧版安装包。可用 `PYTHON_EXECUTABLE` 指定 Python。

### Windows 下检查 Python

先运行 `python --version`。若提示找不到 Python 或打开 Microsoft Store，不要把该命令别名当作已安装的解释器。如果 `py -3 --version` 能正常输出版本，可在 PowerShell 中使用启动器找到实际解释器：

```powershell
$env:PYTHON_EXECUTABLE = (py -3 -c "import sys; print(sys.executable)").Trim()
& $env:PYTHON_EXECUTABLE --version
npm run test:upgrade
```

若两个命令都不可用，需要先安装 Python，或将 `PYTHON_EXECUTABLE` 设置为已有 `python.exe` 的完整路径。此变量只填可执行文件路径，不填 `py -3` 这样的命令加参数。上述环境变量仅对当前 PowerShell 会话及其子进程生效，不会更新已安装的扩展。

## 已验证的发布检查

1.1.0 的隔离 Edge 回归已覆盖完整原图字节、翻译与渲染各自理由、切题后旧建议隐藏、跨题填入拒绝、方向切换、有限格式恢复、限流、停止/内容过滤暂停和重复页面保护。归档测试覆盖 500 条游标分批、514 条记录恢复、重复和冲突不覆盖、设置与密钥隔离，以及浏览器重启保留。文件选择、预览、确认和下载界面也有覆盖。

GitHub Actions [运行 39601728804](https://github.com/astkfu-cpu/papago-multimodel-evaluator/actions/runs/39601728804) 的单元和 Linux 浏览器作业通过，包含公开演示及覆盖升级检查。CI 保存隔离测试截图和摘要；新的文档提交也会重新运行 CI。

这些测试验证流程、取图和数据保护。模拟 API 结果不能证明真实服务可用率、模型准确率、人工一致率或效率提升。

## CI 安装阶段与等待上限

浏览器作业将 Linux 系统依赖安装和 Chromium 下载分为两个步骤，便于定位测试开始前的耗时；这不会加速软件源。系统依赖步骤限时 15 分钟、Chromium 下载限时 5 分钟；浏览器作业整体限时 30 分钟，单元作业限时 10 分钟。超时表示检查未完成，不代表测试通过或已确认扩展缺陷；应查看失败步骤日志后再决定是否重跑。测试命令、模拟数据和保留归档的升级回归保持不变。

## 可选的另行授权测试包

只有需要替换默认公开演示时，才设置 `PAPAGO_PAIRWISE_PACKAGE` 指向另行获准使用的本地测试包。`PAPAGO_PAIRWISE_PREVIOUS_ZIP` 可指定已归档的升级包；默认值已是公开 1.0.2 ZIP。客户原始任务包和内部规则不随公开仓库提供。绝对评价模块的浏览器归档/裁剪检查可运行 `npm run test:e2e`。

早期私有维护记录中的 10 项单元检查、18 项浏览器场景和 1.0.1 到 1.0.2 升级检查属于历史受控测试，不代表真实用户数量或公开准确率。本机客户专用插件和私人归档与公开版本分开维护。
