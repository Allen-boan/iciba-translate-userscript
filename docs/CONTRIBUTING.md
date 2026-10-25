Contribution
--------------
## 概览
项目使用了 `typescript` 和 `vue`，用 `webpack` 打包成最后的输出文件。

## 构建步骤

开发环境使用 Node.js 24.15.0（见 `.node-version`）和 Yarn Classic 1.22.22。
`package.json` 固定包管理器版本；可直接通过已有 Corepack 调用，无需全局安装 Yarn。
Git 的 `.gitattributes` 与 `.editorconfig` 统一使用 LF，适用于 Windows 和 Linux。

```shell
# 安装依赖
corepack yarn install --frozen-lockfile

# 单元测试、独立 lint 和生产构建
corepack yarn test --runInBand
corepack yarn lint --max-warnings 0
corepack yarn build

# 开启开发服务器
corepack yarn dev
```

下载源为 npm 官方 HTTPS 源。安装时保持 Node engines、TLS 和完整性校验开启。
若当前网络需要代理，只为当前终端设置 `HTTP_PROXY` / `HTTPS_PROXY`；
不要将个人代理地址写入项目或全局配置。
旧共享 ESLint 配置声明的 JSDoc 插件不支持 Node 24，因此仅通过 `resolutions`
固定 `eslint-plugin-jsdoc` 为 43.2.0，其子依赖由锁文件固定；ESLint 和 TypeScript 不升级。
Yarn 对旧插件范围的 resolution 警告属于该显式覆盖，不能用 `--ignore-engines` 替代此方案。

### Hot Reload
`yarn dev` 会运行 `webpack-dev-server`，dev server 会监听在 13333 端口。  
dev server 开启了 `writeToDisk`，使用 tampermonkey 并在脚本 metadata 中添加下面代码，刷新页面就会使用新的文件。
```js
// @require   file:///path/to/repo/iciba-translate-userscript/dist/iciba.user.js
```

> 无法在 @require 里用 http 协议，因为chrome会对文件缓存，刷新后仍为老版本

dev 模式下，已经打开的页面会向 dev server 建立 weboscket 链接，有 hot update 时会自动更新。  

> Hot Reload 使用 Websocket 来通讯。所以在CSP严格的页面(e.g. github.com)不会起作用。
