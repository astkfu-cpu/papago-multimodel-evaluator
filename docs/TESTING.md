# 测试与可验证范围

```sh
npm test
npm run test:absolute
npm run test:pairwise
```

以上只使用合成数据或代码校验，无需真实 API Key，不访问客户任务包。根目录和成对模块使用各自的测试规则。

浏览器检查需要安装 Playwright（`npm install`）及 Edge/Chrome；可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定浏览器。

```sh
npm run test:e2e
# 单独验证成对模块；必须显式设置自有、获准使用的本地测试包：
cd pairwise
# PAPAGO_PAIRWISE_PACKAGE=/path/to/authorized/package
node test-browser.cjs
# PAPAGO_PAIRWISE_PREVIOUS_ZIP=/path/to/v1.0.1.zip
# PYTHON_EXECUTABLE=/path/to/python
node test-upgrade.cjs
```

成对端到端检查在隔离浏览器配置中使用模拟 Qwen 响应，核验完整图片字节、格式恢复、重试上限、方向切换、原表保存、归档与报告；本地正式任务包只读，不改正式进度。升级测试用真实旧版代码建立测试记录，再在同一路径覆盖为新版，核对记录与设置完全一致。公开仓库不提供客户原始工作包和旧版私有安装包；运行者需自行准备。

维护期间记录的成对 v1.0.2 回归结果为 10 项单元检查、18 项浏览器场景及旧版覆盖升级检查。这些是受控流程验证，不是 18 位译员、真实 API 成功率或模型准确率证明。


公开版成对模块使用通用评价模板，已移除客户内部规则；实际任务中的专用规则需另行获准配置。本机既有客户专用插件和归档未被修改。
