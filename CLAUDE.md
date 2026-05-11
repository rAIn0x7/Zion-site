# Zion Personal Site — CLAUDE.md

个人品牌网站 [qizh.space](https://qizh.space)，纯静态 HTML/CSS/JS，托管于 GitHub Pages（仓库 `rAIn0x7/Zion-site`，`main` 分支自动部署）。

---

## 文件结构

```
Zion-site/
├── index.html      # 主页（Hero / About / Projects / Writing / Contact）
├── writing.html    # 文章列表页
├── post.html       # 单篇文章页（当前为 Vibe Coding 首篇）
└── CNAME           # 自定义域名 qizh.space
```

无构建工具、无框架、无依赖。直接编辑 HTML 文件即可。

---

## 设计系统

### CSS 变量（所有文件共用相同 token）

```css
--black:   #080808      /* 背景 */
--white:   #f4f1ec      /* 正文 */
--gold:    #c9a84c      /* 主强调色 */
--gold-lt: #e8c97a      /* 悬停高亮 */
--dim:     #3a3a3a      /* 次要元素 */
--muted:   #6b6b6b      /* 辅助文字 */
--border:  rgba(201,168,76,.18)  /* 描边 */
```

### 字体

| 用途 | 字体 | 变量 |
|------|------|------|
| 大标题 | Bebas Neue | `--font-display` |
| 正文衬线/引用 | Instrument Serif | `--font-serif` |
| 正文 | Outfit | `--font-body` |
| 代码/标签/mono | DM Mono | `--font-mono` |

### 视觉特效

- **自定义光标**：金色小点 + 滞后圆环（JS 动画，`#cursor` / `#cursorRing`）
- **噪点纹理**：`body::before` SVG 滤镜叠加，固定定位
- **网格线**：`.grid-lines` 四栏竖线，金色极低透明度
- **滚动淡入**：`.fade-up` + `IntersectionObserver`，延迟类 `.fade-up-d1~d4`

---

## 页面结构（index.html）

| 锚点 | 节 | 说明 |
|------|----|------|
| `#hero` | Hero | 大标题 + bio + 统计数字 |
| `.marquee-wrap` | 跑马灯 | 关键词滚动展示 |
| `#about` | Manifesto | 左：宣言文字；右：价值观列表 |
| `#projects` | Ventures | 项目卡片网格（1 featured + 2 small） |
| `#writing` | Writing | 精选文章 + 文章列表 |
| `#contact` | Connect | 联系方式 + 表单 |

---

## 常见修改指南

### 修改个人信息 / Bio
`index.html` → `#hero` → `.hero-bio` 段落

### 修改统计数字
`index.html` → `.hero-stats` → `.stat-num` / `.stat-label`

### 添加新项目
在 `#projects` → `.projects-grid` 中复制 `.project-card.project-small-card` 块，按结构填写：
- `.project-tag`：类别标签
- `.project-name`：项目名（可用 `<span class="gold">` 高亮部分文字）
- `.project-tagline`：斜体副标题
- `.project-desc`：描述文字
- `.project-arrow`：`↗` 或 `→`

### 添加新文章

**writing.html**：在 `.essays-grid` 中复制一个 `.essay-card` 并填写内容，`href` 指向对应的 `post-xxx.html`。

**index.html → #writing**：将新文章加入 `.writing-list` 侧边列表（`.writing-list-item`）。

**新建文章页**：复制 `post.html`，修改 `<title>`、文章 header、`.post-body` 内容。

### 修改联系方式
`index.html` → `#contact` → `.contact-links` 中三个 `.contact-link`：Email / Twitter / WeChat。

### 修改跑马灯文字
`index.html` → `.marquee-track`，修改 `.marquee-item` 内的 `<span>` 文字。需保持两份（实现无缝循环）。

### 修改颜色主题
修改 `:root` 中的 CSS 变量即可，所有文件同步生效（每个文件各自内嵌样式，需同步修改所有文件的 `:root`）。

---

## 部署（一键推送到 GitHub Pages）

```bash
cd /home/test/Zion-site

# 查看修改
git diff

# 提交
git add index.html writing.html post.html   # 只加修改过的文件
git commit -m "描述本次修改内容"

# 推送 → GitHub Pages 自动更新 qizh.space（约 30 秒生效）
git push origin main
```

GitHub Pages 设置：仓库 Settings → Pages → Source: `main` 分支根目录，自定义域名 `qizh.space`。

---

## 注意事项

- 样式内嵌在每个 HTML 文件内，修改设计 token（颜色/字体）需要同步改 `index.html`、`writing.html`、`post.html`。
- 表单（Contact）纯前端展示，无后端处理。若需实际收件，接入 Formspree 或 EmailJS。
- 图片资源目前无本地文件，全部使用 CSS/SVG 实现视觉效果。
- `cursor: none` 隐藏系统光标，自定义光标通过 JS 驱动，移动端会自动退化（不影响触控）。
