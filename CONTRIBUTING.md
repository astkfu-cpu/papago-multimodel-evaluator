# Contributing

[中文](CONTRIBUTING.zh-CN.md)

Include reproducible steps, expected behavior and affected extension/browser versions. Keep credentials, real work accounts, private screenshots and customer archives out of commits and public issues.

For changes to image localization, navigation, caching, scoring or archive handling, add relevant regression coverage. Run `npm install` and `npm test`. For pairwise workflows run `npm run test:demo` and `npm run test:upgrade`; for absolute archive/crop changes use `npm run test:e2e`. See [testing](docs/TESTING.md) for browser and Python requirements.

Manually check the affected extension in Edge/Chrome using Load unpacked. Use self-authored, synthetic or separately approved anonymized fixtures. Keep absolute and pairwise criteria distinct, preserve existing data during upgrades, and document meaningful limitations.
