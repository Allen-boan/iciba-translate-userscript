# 极简 AI 划词翻译｜多语言·深入解析

选中文字后显示半透明小圆点，点击才请求基础翻译；需要进一步学习时，再点击“深入解析”。自动识别原文语言，基础翻译和深入解析使用你选择的目标语言。支持浏览器原生多语言朗读（英语保留美式/英式独立按钮）、标题栏拖动和正文内部滚动。

## 使用

从 [Greasy Fork 脚本 602070](https://greasyfork.org/zh-CN/scripts/602070) 安装，或将本地构建产物 `dist/iciba.user.js` 导入脚本猫等支持 GM API 的脚本管理器。本次仅更新同一 Greasy Fork 脚本 602070，namespace 与 AI 配置存储键保持不变，保留原有配置。请通过脚本管理器更新已有脚本，不要新建重复实例；没有原作者发布地址的自动更新链接。

通过脚本管理器菜单或翻译窗口进入“AI 设置”。默认 DeepSeek，官方地址自动填写；也可选择 OpenAI 或自定义兼容接口（直接填写 HTTPS 基础地址）。输入 API Key 后点击“验证密钥并获取模型”，搜索并选择返回的候选模型，再选择「翻译与解析语言」并保存配置。接口不提供 `/models` 时，可在高级设置手动输入服务商提供的模型 ID；不会回退成无关服务商的默认模型。

获取模型只向当前选定地址发送一次 GET 请求，不调用生成接口，不自动测试每个模型。列表按名称和元数据过滤明显非聊天项，但不保证所有候选项都支持翻译；已有有效配置可以继续使用。高级设置中的“测试选中模型”需要主动点击，会产生一次生成请求，可能产生服务商费用。

单纯选字、复制、拖动和滚动不发送 AI 请求。基础翻译与深入解析分别请求和缓存；切换选区或关闭窗口会取消旧请求和朗读。发音使用 SpeechSynthesis，不消耗 AI Token；只匹配原文对应的真实可用语音，浏览器缺少对应语言/口音时明确显示不可用，不会用英语或其他语音冒充。可主动停止朗读；切换选区或关闭弹窗也会停止。浏览器/系统语音的可用性及是否联网取决于其自身实现。

密钥保存在脚本管理器 GM 存储，切换接口时不会自动向新地址发送旧密钥。升级本版本保留原有 AI 配置存储键。只发送用户主动翻译的选中文本，不自动附带网页其他内容。

## 多语言（4.12.0）

原文默认自动识别，不需要手动选择。目标语言默认简体中文，可选择英语、印尼语、日语、韩语、西班牙语、法语、德语、葡萄牙语、俄语、阿拉伯语、泰语和越南语，共 13 项。

基础翻译通过一次请求同时获得源语言标记与译文，界面只展示译文，不额外发送语言识别请求。源语言标记缺失时保留「未知」，不猜测英语；格式损坏时安全提示重试，不显示元数据。深入解析只在点击后请求，按原文实际语言讲解语法、词形、表达与语气，并使用所选目标语言，避免机械套用英语模板。两类缓存分别包含目标语言。

旧配置缺少目标语言字段时直接按简体中文读取，不会自动改写密钥。未知原文语言暂不提供发音；语音列表延迟加载后会刷新可用状态。

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

AI 版本开发与维护：Allen-boan。正式中文名称使用界面与 @name:zh-CN 展示；默认 @name 保留已安装版本的识别名称，@namespace 保持不变。
