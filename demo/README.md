# 独立公开演示 / Self-contained demo

完整解压后直接用 Edge/Chrome 打开 `index.html`。输入任意无空格的演示称呼，点击“模拟分析当前题”，检查两项理由，再点击“确认模拟结果并填入”。可切题、切换语言方向、刷新保留进度、导出演示结果和模拟记录。无需安装扩展、联网或 API Key。

**模拟模式使用固定预设，不调用视觉模型，不是模型准确率或真实用户反馈。** 模拟记录只在当前页面会话中保留；演示表的判断进度保存在本浏览器。它的 JSON 不是客户正式结果，也不是插件归档恢复文件。

真实分析：加载仓库 `pairwise/` 扩展，允许访问文件 URL，打开本演示表并配置自己的千问视觉模型和 Key，再通过扩展面板分析完整原图/A/B图。该操作会调用你选择的 API 并产生费用。实际图片为 900×1400，滚动可查看底部小字。插件未启用任何生产环境的模拟接口。

所有图片和表格代码为本项目自行制作，以 MIT 许可公开。共 8 道流程演示题，4 道 EN→JA 和 4 道 JA→EN；每方向重复同一个自制案例，用来测试切题和方向切换，**不等于 8 个独立评测样本**。

自制参考：A 保留入场费 12，B 将其改成 21；A 的标题缩小，B 保持原字号。因此预设翻译 A 胜、渲染 B 胜。参考用于检查示例流程，不构成第三方人工标注。

Automated extension browser regression: from the repository root, run `npm install`, `npx playwright install chromium`, then `npm run test:demo`. It uses this public fixture and a mocked Qwen API in an isolated browser profile. No customer package or real API key is required. On Windows it uses Edge by default; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to select another browser.
