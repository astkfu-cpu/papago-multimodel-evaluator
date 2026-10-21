# 参与贡献

感谢参与改进。提交前请确认：

1. 不包含 API Key、账号、真实任务截图或浏览器归档。
2. 修改定位、切页、缓存或评分逻辑时，同时补充相应回归测试。
3. 运行 `npm install`，再运行 `npm test`；涉及浏览器归档或裁剪时再运行 `npm run test:e2e`。
4. 在 Edge 或 Chrome 中以“加载解压缩的扩展”方式进行人工验证。

端到端测试优先使用 Windows 上已安装的 Microsoft Edge；也可以通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定 Chromium/Chrome。未指定且找不到 Edge 时，测试会使用 Playwright 自带的 Chromium。

请用清晰的复现步骤说明缺陷。不要上传第三方平台的受限数据，也不要把自动化用于未经授权的任务。

