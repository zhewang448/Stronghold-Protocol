# 本库特色与上游对照展示页

黑绿终端风格的独立静态站，按七个场景展示本库相对上游的改进。正文为中文，界面文案使用项目的 `t()`；说明文字和版本对照由 `catalogue.json` 提供，不启动游戏服务、不连接玩家资料或主机控制台。

## 构建与预览

需要 Node.js 22 或 24，无需下载游戏素材、安装 npm 依赖或运行游戏服务器：

```sh
node tools/build-site.mjs --out .cache/site-dist
python -m http.server 8080 --directory .cache/site-dist
```

打开 `http://localhost:8080`。产物也可放到 `/Stronghold-Protocol/` 子路径，所有页面资源使用相对链接。构建核对图鉴中每张截图的路径和哈希，只发布引用的截图、首屏资源及静态运行文件。可重复使用上次的构建目录，旧版产物会整体替换。如果目录含清单之外的文件，请使用空目录。

## 更新内容

- `catalogue.json`：七章和每项的标题、收益、上游流程、入口、默认值、限制、来源与图片标注；条目 ID 同时是稳定深链接。
- `content-audit.json`：固定源码对照、文件摘要与图片来源。两库功能对照以锁定版本为准，不能把上游后续进展视为缺失。
- `assets/sources.json`：真实截图来源、原图与发布图 SHA-256；图片说明保留演示数据、历史截图与相关画面的区别。
- `DESIGN.md`：已确认的 A 构图和项目视觉；`design/` 保留用户确认前的完整分段稿，不进入站点发布产物。

扩展正式版读取 `server/release-version.js`，基础版本读取根 `package.json`，启动器读取项目 `.csproj`。扩展版本变化时构建会要求先重新核对图鉴，避免发布旧对照。没有通过浏览器验收或不存在的图像不能作为新版本实拍。

## GitHub Pages

`.github/workflows/pages.yml` 在相关源码进入 main 后构建，并只在本库 main 部署。仓库 Settings → Pages 的构建来源设为 GitHub Actions；首次启用需要仓库管理员权限。默认地址为 `https://zhewang448.github.io/Stronghold-Protocol/`。本页面为项目介绍，在线游戏仍由现有 Node 服务提供。

所有源码沿用 GPL-3.0-or-later。截图中的游戏美术与数据权利沿用根 `NOTICE.md`，不因为网页代码采用 GPL 而改变。
