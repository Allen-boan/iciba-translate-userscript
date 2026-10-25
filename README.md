# wooooowu · AI 划词词典

> **项目来源与维护**：本 AI 版本由 **Allen-boan** 基于 **noe132** 原作 [iciba 划词翻译](https://github.com/Firefox-Pro-Coding/iciba-translate-userscript) 重构与维护。原项目作者为 **noe132**；保留其版权声明，并继续遵循 [MIT 许可证](LICENSE)。

选中文字后显示半透明小圆点，点击才请求基础翻译；需要进一步学习时，再点击“深入解析”。支持独立的浏览器原生美式/英式朗读、标题栏拖动和正文内部滚动。

## 使用

将本地构建产物 `dist/iciba.user.js` 导入脚本猫等支持 GM API 的脚本管理器。此 AI 版本拥有独立 name 和 namespace，没有原作者发布地址的自动更新链接。

通过脚本管理器菜单或翻译窗口进入“AI 设置”。默认 DeepSeek，官方地址自动填写；也可选择 OpenAI 或自定义兼容接口（直接填写 HTTPS 基础地址）。输入 API Key 后点击“验证密钥并获取模型”，搜索并选择返回的候选模型，再保存配置。接口不提供 `/models` 时，可在高级设置手动输入服务商提供的模型 ID；不会回退成无关服务商的默认模型。

获取模型只向当前选定地址发送一次 GET 请求，不调用生成接口，不自动测试每个模型。列表按名称和元数据过滤明显非聊天项，但不保证所有候选项都支持翻译；已有有效配置可以继续使用。高级设置中的“测试选中模型”需要主动点击，会产生一次生成请求，可能产生服务商费用。

单纯选字、复制、拖动和滚动不发送 AI 请求。基础翻译与深入解析分别请求和缓存；切换选区或关闭窗口会取消旧请求和朗读。发音使用 SpeechSynthesis，不消耗 AI Token；浏览器缺少对应口音时显示不可用。

密钥保存在脚本管理器 GM 存储，切换接口时不会自动向新地址发送旧密钥。升级本版本保留原有 AI 配置存储键。只发送用户主动翻译的选中文本，不自动附带网页其他内容。

## 本地开发

使用项目约定的 Node.js 24.15.0 和 Yarn Classic 1.22.22。安装依赖时使用冻结锁文件，不关闭 TLS 或完整性校验。

```sh
corepack yarn install --frozen-lockfile
corepack yarn test --runInBand --modulePathIgnorePatterns 'node_modules[.]corrupt-20261024'
corepack yarn lint --max-warnings 0
corepack yarn tsc --noEmit -p tsconfig.json
corepack yarn webpack --config build/config/webpack.prod.conf.js --stats errors-warnings
corepack yarn ts-node -P utils/tsconfig-util.json utils/addMetaData.ts
node --check dist/iciba.user.js
```

最后两步构建命令应按顺序运行，元数据封装每次只执行一次。以上方式不会先清空已有 `dist` 文件。测试使用模拟响应，不需要真实 API Key。

第四阶段已移除传统 Provider、多来源切换、旧历史及专属设置；相关清理与验收见 [清理报告](docs/LEGACY_CLEANUP.md)，AI 设计与历史验证记录见 [AI_API.md](docs/AI_API.md)。

## 许可证与署名

本项目基于 [noe132 / Firefox-Pro-Coding 的 iciba 划词翻译](https://github.com/Firefox-Pro-Coding/iciba-translate-userscript)，继续保留原作者署名和 [MIT 许可证](LICENSE)。当前 Fork 为 [Allen-boan/iciba-translate-userscript](https://github.com/Allen-boan/iciba-translate-userscript)。
