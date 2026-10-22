# 背单词（Word Memo）

一个纯静态的单词记忆 PWA。电脑上传一次，手机浏览器打开、加到主屏幕，之后断网也能背。

**在线地址：https://chenbaitang388-dot.github.io/word-memo/**

- 没有任何后端，数据全部存在浏览器本地
- 没有构建步骤：改完直接刷新就是最新版
- 无第三方依赖，Node 版仅用于跑测试
- 部署方式：GitHub Pages（`main` 分支根目录），推送即发布

## 目录

```
index.html            页面骨架
styles.css            样式（含深色模式）
manifest.json         PWA 清单
sw.js                 Service Worker（离线缓存）
src/core.js           纯逻辑：导入解析 / 调度 / 出题 / 统计（可用 node 单测）
src/app.js            界面层（四个页面 + 学习流程）
assets/               PWA 图标（gen_icons.py 生成）
tests/core.test.mjs   逻辑单元测试（38 项）
lab/e2e.mjs           真浏览器端到端测试（38 项）
lab/offline.mjs       离线可用性验证（7 项）
lab/shots/            测试截图（不进版本库）
docs/                 说明
```

## 本地跑

```bash
# 任意静态服务器都行
python -m http.server 8123 --bind 0.0.0.0
# 然后开 http://127.0.0.1:8123/
```

注意：Service Worker 只在 `https://` 或 `127.0.0.1 / localhost` 下生效。
用局域网 IP（如 `http://192.168.x.x:8123`）访问时功能正常，但**不能离线、不能加到主屏**。

## 测试

```bash
node tests/core.test.mjs     # 纯逻辑，38 项
node lab/e2e.mjs             # 真浏览器点一遍，需要 8123 上有服务
node lab/offline.mjs         # 断网能不能打开
```

`lab/e2e.mjs` 用 Chrome 的 DevTools Protocol 驱动（Node 24 自带 WebSocket，不需要装包），
会把每一步截图存到 `lab/shots/`。

## 部署到 GitHub Pages

已经部署好了，仓库：`chenbaitang388-dot/word-memo`（公开仓库，Pages 免费档需要公开）。

改完代码重新发布只需：

```bash
git add -A && git commit -m "说明" && git push
```

注意把 `sw.js` 里的 `VERSION` 加一档，手机下次打开才会换新版（否则会一直用缓存里的旧版）。

首次从零部署的步骤（备查）：

1. 在 GitHub 建一个**公开**仓库（例如 `word-memo`）。
2. 把这个目录里的文件推到仓库根目录（`index.html` 要在根上）。
3. 仓库 Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`，目录 `/ (root)`。
4. 等 1~2 分钟，访问 `https://<用户名>.github.io/word-memo/`。
5. 手机上打开这个网址 → 分享 → 添加到主屏幕。

## 设计上的几个决定

- **进度按「单词」记，不按「词库」记。** 同一个词出现在两个词库里共用一份记忆状态，
  避免同一个词在两本书里各记一套。词库之间互不干扰的部分（不同词）本来就是独立的。
- **考察形式自动递进**：新词 → 卡片自评；熟了（第 2~3 阶）→ 英译中四选一；再熟（第 4 阶起）→ 中文回想拼写。
  设置里可以强制只用某一种。
- **干扰项来源**：优先同词性、词长相差 ≤2 的其他词；不够时依次放宽到同词性、全部词。
  词库太小会少给几个选项，界面上会说明。
- **「不认识」**：进入 10 分钟后再来，同时在这一轮里隔几个词重新出现一次。
- **遗忘曲线**：认识 → 1/3/7/15/30 天，之后每轮乘以熟练系数；模糊 → 1 天；不认识 → 10 分钟。
- **数据安全**：localStorage。iOS 加到主屏后比较稳，但仍建议每 7 天导出一份备份
  （首页会自动提醒），导出的 JSON 可以放 iCloud 或网盘。

## 已知限制

- 没有账号同步：换手机靠导出/导入。
- 一个词库一次最多显示前 200 个词（数据都在，只是列表截断）。
- 拼音/音标不做校验，只原样显示。
