# 第四阶段：旧功能清理报告

日期：2026-10-25。分支：`feat/ai-translation`。本轮未 Commit、Push、安装脚本、调用真实 AI 或联网安装依赖。

## 删除范围

共删除 298 个经引用审计确认不再使用的文件：七个 Provider 的请求、签名、音频、接口和容器；Provider 注册/排序、旧 store、历史记录、热键、旧主弹窗和圆点、多来源与专属设置；不再使用的控件、图标、音频缓存、io-ts 辅助和 SVG/JSX 构建支持。旧 Google 音频本轮依用户明确授权删除；当前发音来自独立 SpeechSynthesis 模块。

启动入口不再初始化旧 store 或 Provider。设置页移除旧标签，保留原有 AI 表单、Modal、尺寸及滚动方式。旧浏览器 GM 存储中的历史或偏好数据不执行删除；AI 配置及密钥仍使用原有 `iciba_ai_config_v1` / `iciba_ai_secret_v1`，不做迁移或改写。脚本的 name、namespace、版本和元数据模板，以及 LICENSE 均保持原样。

## 依赖和锁文件

删除 18 项直接声明：`@types/crypto-js`、`base64-arraybuffer`、`crypto-js`、`fp-ts`、`io-ts`、`md5`、`resize-observer-polyfill`、`uuid`、`@types/md5`、`@types/uuid`、`@babel/cli`、`@types/rimraf`、`@vue/babel-plugin-jsx`、`autoprefixer`、`cache-loader`、`express`、`raw-loader`、`webpack-dev-middleware`。后八项已核对保留脚本与构建配置，无直接引用；仍被现有工具传递依赖的项保留在锁文件中。

根据剩余直接依赖、dependencies / optionalDependencies 及原 resolutions 遍历本地锁图，从 1,011 个条目中剪除 32 个不可达条目，保留 979 个。保留条目的原始文本逐块完全一致，版本、resolved 和 integrity 未修改，所有保留依赖边均有锁定目标。未执行安装、升级或删改 node_modules；已安装但不再声明的旧包暂留磁盘，不进入生产构建。原损坏依赖目录和已有缓存均保留。

## 验证

| 项目 | 结果 |
| --- | --- |
| 完整 Jest | 15 个套件、289 项测试通过 |
| ESLint | 0 错误、0 警告 |
| TypeScript | `tsc --noEmit -p tsconfig.json` 通过 |
| 生产构建 | 成功，Webpack 统计 0 errors / 0 warnings |
| 产物语法 | `node --check dist/iciba.user.js` 通过 |
| 生产模块及旧服务端点 | 292 个统计模块，无旧 Provider / 历史 / 翻译服务模块，无旧服务实际端点 |

原 296 项测试中删除旧历史功能对应的 8 项，保留全部 288 项 AI / 选区 / 语音测试；新增 1 项真实入口集成测试，合计 289 项。新增测试挂载生产入口、设置容器与 AI 表单，确认启动和打开设置零请求、零写入、读取现有配置且密钥不回填，外部关闭和重新打开仍可用，不读取或改写旧历史及偏好。

AI 服务、AI store、SpeechSynthesis、选区监听、整个 AI 弹窗、AI 设置表单及控制器与任务开始时的哈希一致。完整保留圆点点击才请求、两阶段翻译、缓存/超时/取消/重试、英美发音、拖动及内部滚动。构建控制台仍有原有 Browserslist 陈旧、Tailwind 旧配置和 Webpack API 弃用提示，不是 ESLint 警告，本轮未升级相关工具。

最终脚本：`F:\codex_ai_translate\dist\iciba.user.js`。体积从 1,365,581 字节降至 736,050 字节，减少 629,531 字节（46.1%）；SHA-256 `352df939f44d83fb219f29ea5eea67f64eca2a0f17c90a20a9e128c08b687bb1`。仍为 `wooooowu` 和原 Fork namespace，无 updateURL/downloadURL，保留 noe132 的 MIT 署名。元数据中的旧 `@exclude http://www.iciba.com*` 是保留的匹配排除规则，不是网络请求；已分别检查元数据和实际 JS 请求路径。

本轮未重新进行脚本猫实装，清理后仍需用户按需更新本地脚本进行体验回归。

## 删除文件完整清单

### 旧图标和专属样式（41 个）

- `src/assets/img/checked_291201.svg`
- `src/assets/img/close.svg`
- `src/assets/img/drag_462998.svg`
- `src/assets/img/expand_128456.svg`
- `src/assets/img/history.svg`
- `src/assets/img/like_179655.svg`
- `src/assets/img/loading.svg`
- `src/assets/img/magnify_929469.svg`
- `src/assets/img/mdi/baseline-check_box-24px.svg`
- `src/assets/img/mdi/baseline-check_box_outline_blank-24px.svg`
- `src/assets/img/mdi/baseline-radio_button_checked-24px.svg`
- `src/assets/img/mdi/baseline-radio_button_unchecked-24px.svg`
- `src/assets/img/minus.svg`
- `src/assets/img/pin_25474.svg`
- `src/assets/img/play/speaker-filled-audio-tool_59284.svg`
- `src/assets/img/plus.svg`
- `src/assets/img/providerIcon/aliApiTranslate/aliApi.svg`
- `src/assets/img/providerIcon/baiduTranslate/baidu.svg`
- `src/assets/img/providerIcon/baiduTranslate/baiduCircle.svg`
- `src/assets/img/providerIcon/bingTranslate/flat.svg`
- `src/assets/img/providerIcon/bingTranslate/gold.svg`
- `src/assets/img/providerIcon/bingTranslate/outline.svg`
- `src/assets/img/providerIcon/bingTranslate/round.svg`
- `src/assets/img/providerIcon/googleDict/type_0_google.svg`
- `src/assets/img/providerIcon/googleDict/type_2_search_281764.svg`
- `src/assets/img/providerIcon/googleDict/type_3_search_281781.svg`
- `src/assets/img/providerIcon/googleDict/type_4_google_356049.svg`
- `src/assets/img/providerIcon/googleTranslate/type_1_translate_281759.svg`
- `src/assets/img/providerIcon/googleTranslate/type_2_translate_281776.svg`
- `src/assets/img/providerIcon/googleTranslate/type_2_translate_324121.svg`
- `src/assets/img/providerIcon/googleTranslate/type_3_google_814137.svg`
- `src/assets/img/providerIcon/iciba/iciba_1362193.svg`
- `src/assets/img/providerIcon/iciba/search.svg`
- `src/assets/img/providerIcon/sougouTranslate/icon_no_circle.svg`
- `src/assets/img/providerIcon/sougouTranslate/icon_with_circle.svg`
- `src/assets/img/providerIcon/urbanDictionary/urbanDictionary.svg`
- `src/assets/img/providerIcon/vocabulary/logo.svg`
- `src/assets/img/settings_149837.svg`
- `src/assets/img/translate_2406387.svg`
- `src/assets/styles/ripple.sass`
- `src/assets/styles/variables.sass`

### 旧专属组件（39 个）

- `src/components/Foldable/Foldable.ts`
- `src/components/Foldable/Foldable.vue`
- `src/components/IIcon/IIcon.ts`
- `src/components/IIcon/IIcon.vue`
- `src/components/IconRadioGroup/IconRadioGroup.sass`
- `src/components/IconRadioGroup/IconRadioGroup.ts`
- `src/components/IconRadioGroup/IconRadioGroup.vue`
- `src/components/Scrollable/Scrollable.sass`
- `src/components/Scrollable/Scrollable.ts`
- `src/components/Scrollable/Scrollable.vue`
- `src/components/checkbox/checkbox.sass`
- `src/components/checkbox/checkbox.ts`
- `src/components/checkbox/checkbox.vue`
- `src/components/checkboxLine/checkboxLine.tsx`
- `src/components/hotkeyInput/hotkeyInput.sass`
- `src/components/hotkeyInput/hotkeyInput.ts`
- `src/components/hotkeyInput/hotkeyInput.vue`
- `src/components/providerCommon/providerCommon.ts`
- `src/components/providerCommon/providerCommon.vue`
- `src/components/radio/radio.sass`
- `src/components/radio/radio.ts`
- `src/components/radio/radio.vue`
- `src/components/radioGroup/radioGroup.tsx`
- `src/components/slider/slider.sass`
- `src/components/slider/slider.ts`
- `src/components/slider/slider.vue`
- `src/components/tab/tab.vue`
- `src/components/tabItem/tabItem.tsx`
- `src/components/tabItem/tabItem.vue`
- `src/components/tabs/tabs.sass`
- `src/components/tabs/tabs.tsx`
- `src/components/tabs/tabs.vue`
- `src/components/tabsItems/tabsItems.sass`
- `src/components/tabsItems/tabsItems.tsx`
- `src/components/tabsItems/tabsItems.vue`
- `src/components/textInput/textInput.sass`
- `src/components/textInput/textInput.ts`
- `src/components/textInput/textInput.vue`
- `src/components/textInputLine/textInputLine.tsx`

### 其他旧支持代码（3 个）

- `src/constants/index.ts`
- `src/types/modules/svg.d.ts`
- `utils/plugin/injectH.js`

### 七个 Provider 及注册框架（157 个）

- `src/provider/AliApiTranslate/aliApiLanguages.ts`
- `src/provider/AliApiTranslate/container/data.ts`
- `src/provider/AliApiTranslate/container/index.sass`
- `src/provider/AliApiTranslate/container/index.ts`
- `src/provider/AliApiTranslate/container/index.vue`
- `src/provider/AliApiTranslate/icons.ts`
- `src/provider/AliApiTranslate/index.ts`
- `src/provider/AliApiTranslate/settings/aliApiAppKey/aliApiAppKey.sass`
- `src/provider/AliApiTranslate/settings/aliApiAppKey/aliApiAppKey.ts`
- `src/provider/AliApiTranslate/settings/aliApiAppKey/aliApiAppKey.vue`
- `src/provider/AliApiTranslate/settings/index.ts`
- `src/provider/AliApiTranslate/settings/index.vue`
- `src/provider/AliApiTranslate/store/index.ts`
- `src/provider/AliApiTranslate/translate.ts`
- `src/provider/AliApiTranslate/types/index.ts`
- `src/provider/BaiduTranslate/baiduLanguages.ts`
- `src/provider/BaiduTranslate/container/data.ts`
- `src/provider/BaiduTranslate/container/index.sass`
- `src/provider/BaiduTranslate/container/index.ts`
- `src/provider/BaiduTranslate/container/index.vue`
- `src/provider/BaiduTranslate/helpers/calcToken.js`
- `src/provider/BaiduTranslate/helpers/token.ts`
- `src/provider/BaiduTranslate/icons.ts`
- `src/provider/BaiduTranslate/index.ts`
- `src/provider/BaiduTranslate/playAudio.ts`
- `src/provider/BaiduTranslate/settings/index.ts`
- `src/provider/BaiduTranslate/settings/index.vue`
- `src/provider/BaiduTranslate/store/index.ts`
- `src/provider/BaiduTranslate/translate.ts`
- `src/provider/GoogleDict/constant.ts`
- `src/provider/GoogleDict/container/GoogleDictContainer.sass`
- `src/provider/GoogleDict/container/GoogleDictContainer.ts`
- `src/provider/GoogleDict/container/GoogleDictContainer.vue`
- `src/provider/GoogleDict/container/GoogleDictModal.sass`
- `src/provider/GoogleDict/container/GoogleDictModal.ts`
- `src/provider/GoogleDict/container/GoogleDictModal.vue`
- `src/provider/GoogleDict/container/components/common/fragment/fragment.ts`
- `src/provider/GoogleDict/container/components/common/fragment/fragment.vue`
- `src/provider/GoogleDict/container/components/common/phonetics/phonetics.sass`
- `src/provider/GoogleDict/container/components/common/phonetics/phonetics.ts`
- `src/provider/GoogleDict/container/components/common/phonetics/phonetics.vue`
- `src/provider/GoogleDict/container/components/container/simpleEntry/simpleEntry.sass`
- `src/provider/GoogleDict/container/components/container/simpleEntry/simpleEntry.ts`
- `src/provider/GoogleDict/container/components/container/simpleEntry/simpleEntry.vue`
- `src/provider/GoogleDict/container/components/modal/entry/entry.ts`
- `src/provider/GoogleDict/container/components/modal/entry/entry.vue`
- `src/provider/GoogleDict/container/components/modal/etymology/etymology.ts`
- `src/provider/GoogleDict/container/components/modal/etymology/etymology.vue`
- `src/provider/GoogleDict/container/components/modal/exampleGroups/exampleGroups.ts`
- `src/provider/GoogleDict/container/components/modal/exampleGroups/exampleGroups.vue`
- `src/provider/GoogleDict/container/components/modal/imageLoader/imageLoader.sass`
- `src/provider/GoogleDict/container/components/modal/imageLoader/imageLoader.ts`
- `src/provider/GoogleDict/container/components/modal/imageLoader/imageLoader.vue`
- `src/provider/GoogleDict/container/components/modal/labelSet/labelSet.ts`
- `src/provider/GoogleDict/container/components/modal/labelSet/labelSet.vue`
- `src/provider/GoogleDict/container/components/modal/labels/labels.sass`
- `src/provider/GoogleDict/container/components/modal/labels/labels.ts`
- `src/provider/GoogleDict/container/components/modal/labels/labels.vue`
- `src/provider/GoogleDict/container/components/modal/morphUnit/morphUnit.ts`
- `src/provider/GoogleDict/container/components/modal/morphUnit/morphUnit.vue`
- `src/provider/GoogleDict/container/components/modal/note/note.ts`
- `src/provider/GoogleDict/container/components/modal/note/note.vue`
- `src/provider/GoogleDict/container/components/modal/senseItem/senseItem.sass`
- `src/provider/GoogleDict/container/components/modal/senseItem/senseItem.ts`
- `src/provider/GoogleDict/container/components/modal/senseItem/senseItem.vue`
- `src/provider/GoogleDict/container/components/modal/thesaurus/thesaurus.sass`
- `src/provider/GoogleDict/container/components/modal/thesaurus/thesaurus.ts`
- `src/provider/GoogleDict/container/components/modal/thesaurus/thesaurus.vue`
- `src/provider/GoogleDict/container/components/modal/thesaurus/thesaurusRow/thesaurusRow.ts`
- `src/provider/GoogleDict/container/components/modal/thesaurus/thesaurusRow/thesaurusRow.vue`
- `src/provider/GoogleDict/container/components/modal/usageOvertime/usageOvertime.ts`
- `src/provider/GoogleDict/container/components/modal/usageOvertime/usageOvertime.vue`
- `src/provider/GoogleDict/container/data.ts`
- `src/provider/GoogleDict/icons.ts`
- `src/provider/GoogleDict/index.ts`
- `src/provider/GoogleDict/playAudio.ts`
- `src/provider/GoogleDict/settings/index.ts`
- `src/provider/GoogleDict/settings/index.vue`
- `src/provider/GoogleDict/store/index.ts`
- `src/provider/GoogleDict/translate.ts`
- `src/provider/GoogleDict/types/check.ts`
- `src/provider/GoogleDict/types/index.ts`
- `src/provider/GoogleTranslate/container/data.ts`
- `src/provider/GoogleTranslate/container/index.sass`
- `src/provider/GoogleTranslate/container/index.ts`
- `src/provider/GoogleTranslate/container/index.vue`
- `src/provider/GoogleTranslate/googleLanguages.ts`
- `src/provider/GoogleTranslate/icons.ts`
- `src/provider/GoogleTranslate/index.ts`
- `src/provider/GoogleTranslate/playAudio.ts`
- `src/provider/GoogleTranslate/settings/index.ts`
- `src/provider/GoogleTranslate/settings/index.vue`
- `src/provider/GoogleTranslate/store/index.ts`
- `src/provider/GoogleTranslate/translate.ts`
- `src/provider/GoogleTranslate/types/index.ts`
- `src/provider/Iciba/container/components/pronunciation-item.sass`
- `src/provider/Iciba/container/components/pronunciation-item.ts`
- `src/provider/Iciba/container/components/pronunciation-item.vue`
- `src/provider/Iciba/container/data.ts`
- `src/provider/Iciba/container/index.sass`
- `src/provider/Iciba/container/index.ts`
- `src/provider/Iciba/container/index.vue`
- `src/provider/Iciba/icons.ts`
- `src/provider/Iciba/index.ts`
- `src/provider/Iciba/playAudio.ts`
- `src/provider/Iciba/settings/index.ts`
- `src/provider/Iciba/settings/index.vue`
- `src/provider/Iciba/store/index.ts`
- `src/provider/Iciba/translate.ts`
- `src/provider/Iciba/types/abbreviation.ts`
- `src/provider/Iciba/types/baseInfo.ts`
- `src/provider/Iciba/types/bidec.ts`
- `src/provider/Iciba/types/cet.ts`
- `src/provider/Iciba/types/check.ts`
- `src/provider/Iciba/types/chinese.ts`
- `src/provider/Iciba/types/collins.ts`
- `src/provider/Iciba/types/derivation.ts`
- `src/provider/Iciba/types/eeMean.ts`
- `src/provider/Iciba/types/gaokao.ts`
- `src/provider/Iciba/types/identityDicNew.ts`
- `src/provider/Iciba/types/index.ts`
- `src/provider/Iciba/types/phrase.ts`
- `src/provider/Iciba/types/sameAnalysis.ts`
- `src/provider/Iciba/types/stemsAffix.ts`
- `src/provider/Iciba/types/thesaurus.ts`
- `src/provider/Iciba/types/tikWordInfo.ts`
- `src/provider/Iciba/types/tradeMean.ts`
- `src/provider/UrbanDictionary/container/bus.ts`
- `src/provider/UrbanDictionary/container/component/UKeyword/UKeyword.ts`
- `src/provider/UrbanDictionary/container/component/UKeyword/UKeyword.vue`
- `src/provider/UrbanDictionary/container/data.ts`
- `src/provider/UrbanDictionary/container/index.sass`
- `src/provider/UrbanDictionary/container/index.ts`
- `src/provider/UrbanDictionary/container/index.vue`
- `src/provider/UrbanDictionary/getApiKey.ts`
- `src/provider/UrbanDictionary/icons.ts`
- `src/provider/UrbanDictionary/index.ts`
- `src/provider/UrbanDictionary/settings/index.ts`
- `src/provider/UrbanDictionary/settings/index.vue`
- `src/provider/UrbanDictionary/store/index.ts`
- `src/provider/UrbanDictionary/translate.ts`
- `src/provider/UrbanDictionary/types/check.ts`
- `src/provider/UrbanDictionary/types/index.ts`
- `src/provider/Vocabulary/container/data.ts`
- `src/provider/Vocabulary/container/index.sass`
- `src/provider/Vocabulary/container/index.ts`
- `src/provider/Vocabulary/container/index.vue`
- `src/provider/Vocabulary/icons.ts`
- `src/provider/Vocabulary/index.ts`
- `src/provider/Vocabulary/playAudio.ts`
- `src/provider/Vocabulary/settings/index.ts`
- `src/provider/Vocabulary/settings/index.vue`
- `src/provider/Vocabulary/store/index.ts`
- `src/provider/Vocabulary/translate.ts`
- `src/provider/Vocabulary/types/index.ts`
- `src/provider/create.ts`
- `src/provider/index.ts`

### 旧业务服务及 store（16 个）

- `src/service/audioCache/index.ts`
- `src/service/globalBus/index.ts`
- `src/service/globalBus/types.ts`
- `src/service/history/index.ts`
- `src/service/history/type.ts`
- `src/service/hotkey/index.ts`
- `src/service/scrollBarWidth/index.tsx`
- `src/service/store/core.ts`
- `src/service/store/index.ts`
- `src/service/store/provider.ts`
- `src/service/toast/Toast/index.sass`
- `src/service/toast/Toast/index.ts`
- `src/service/toast/Toast/index.vue`
- `src/service/toast/index.tsx`
- `src/service/toast/types.ts`
- `src/service/translate/index.ts`

### 旧辅助代码（20 个）

- `src/util/cachePromise.ts`
- `src/util/calcMouseEventPosition.ts`
- `src/util/copy.ts`
- `src/util/diretives/click-outside.ts`
- `src/util/diretives/ripple.js`
- `src/util/events.ts`
- `src/util/extendIoTs/enum.ts`
- `src/util/extendIoTs/excess.ts`
- `src/util/extendIoTs/fallback.ts`
- `src/util/extendIoTs/never.ts`
- `src/util/extendIoTs/provider.ts`
- `src/util/getSelectionText.ts`
- `src/util/gmapi/__mocks__/index.ts`
- `src/util/gmapi/types.ts`
- `src/util/index.ts`
- `src/util/insideOf.ts`
- `src/util/lazyLoadHoc.tsx`
- `src/util/playAudio.ts`
- `src/util/scrollbar-width.ts`
- `src/util/useIncrement.ts`

### 旧弹窗和设置子页（20 个）

- `src/view/HistoryModal/HistoryModal.sass`
- `src/view/HistoryModal/HistoryModal.ts`
- `src/view/HistoryModal/HistoryModal.vue`
- `src/view/IcibaCircle/IcibaCircle.sass`
- `src/view/IcibaCircle/IcibaCircle.ts`
- `src/view/IcibaCircle/IcibaCircle.vue`
- `src/view/IcibaMain/IcibaMain.sass`
- `src/view/IcibaMain/IcibaMain.ts`
- `src/view/IcibaMain/IcibaMain.vue`
- `src/view/IcibaMain/LoadingText/LoadingText.tsx`
- `src/view/SettingPage/subpage/about/about.ts`
- `src/view/SettingPage/subpage/about/about.vue`
- `src/view/SettingPage/subpage/coreSetting/coreSetting.sass`
- `src/view/SettingPage/subpage/coreSetting/coreSetting.ts`
- `src/view/SettingPage/subpage/coreSetting/coreSetting.vue`
- `src/view/SettingPage/subpage/coreSetting/providerSort/providerSort.sass`
- `src/view/SettingPage/subpage/coreSetting/providerSort/providerSort.ts`
- `src/view/SettingPage/subpage/coreSetting/providerSort/providerSort.vue`
- `src/view/SettingPage/subpage/hotKey/hotKey.ts`
- `src/view/SettingPage/subpage/hotKey/hotKey.vue`

### 旧历史测试与 SVG mock（2 个）

- `test/__mocks__/svg.ts`
- `test/service/history.spec.ts`
