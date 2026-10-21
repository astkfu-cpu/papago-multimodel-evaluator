# English guide to the current UI

The current extension/demo interface and most stored rationales are Chinese. This glossary maps the actual controls for English-speaking reviewers. It does not change the package/runtime language.

| Visible label | Meaning |
| --- | --- |
| 分析当前张 | Analyze current item; does not fill automatically in single-item mode |
| 开始连续评价 | Start optional continuous evaluation |
| 停止 | Stop |
| 确认两项建议并填入 | Confirm both suggested judgments and fill |
| 重新分析（不使用缓存） | Reanalyze without cache |
| 翻译 / 渲染 | Translation / rendering |
| A 胜 / 平局 / B 胜 | A wins / tie / B wins |
| 模型自评置信度 | Model self-reported confidence, not calibrated accuracy |
| 千问设置 / 保存设置 / 测试接口 | Qwen settings / save settings / test connectivity |
| 连续每批数量 / 模型自评阈值 | Batch size / self-reported-confidence threshold |
| 长期离线记录 | Durable local archive |
| 筛选与分批导出 / 恢复 | Filter, batch export and restore |
| 导出下一批 / 从第一批开始 | Export next batch / reset to first batch |
| 确认补入缺失归档 | Confirm restoration of missing archive records only |
| 当前题目已变化，请重新分析 | Item changed; reanalyze before filling |

## Standalone demo controls

| Visible label | Meaning |
| --- | --- |
| 公开自制演示 · 非客户任务包 | Self-authored public demonstration |
| 模拟分析当前题 | Show predetermined simulated analysis |
| 确认模拟结果并填入 | Confirm simulated choices and fill the demo page |
| 导出模拟记录 | Export simulated-session records |
| 导出演示结果 | Export demo-page judgments |
| 上一题 / 下一题 / 旋转 | Previous / next / rotate |

The demo clearly identifies simulation. For actual extension testing, run the mocked-API browser regression or configure your own API for real analysis. See [demo instructions](../demo/README.en.md).
