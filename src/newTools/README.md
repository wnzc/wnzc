# newTools —— 新增小工具目录

> 2026-08 起新工具统一放本目录，与 `../newGame/` 同级，方便持续追加。
> 首页入口在根目录 `index.html` 的 `toolsData` 数组里注册。

## 现有工具

| 文件 | 工具 | 类型 |
|------|------|------|
| `countdown.html` | 倒数日 | 纯本地 |
| `unit.html` | 单位换算 | 纯本地 |
| `holiday.html` | 节假日助手 | 内置数据，零请求 |
| `dream.html` | AI 解梦 | AI 直连 |
| `fridge.html` | 冰箱料理 | AI 直连 |
| `naming.html` | AI 起名 | AI 直连 |
| `led.html` | LED 滚动字幕 | 纯本地 |
| `dice.html` | 摇一摇骰子 | 纯本地（体感） |
| `truth-dare.html` | 真心话大冒险转盘 | 内置题库 |
| `adventure.html` | AI 文字冒险（12 题材） | AI 直连（多轮） |
| `tarot.html` | 赛博塔罗 | AI 直连 |
| `dialect.html` | 方言翻译机 | AI 直连 |
| `soup.html` | 海龟汤 | AI 直连（多轮） |
| `idiom.html` | 成语接龙陪练 | AI 直连（多轮） |
| `moyu.html` | 摸鱼日历 | 内置数据，零请求 |

> 注：车站大屏 / KFC文案 / 舔狗日记因第三方接口失效已在首页注释下架（页面文件仍在 src/）。
> 注：AI嘴替 / 骂醒恋爱脑已按需求删除（2026-08-25）。

## 新增工具的约定

1. **单文件自包含**：HTML + CSS + JS 全在一个文件里，视觉沿用全站暗色卡片风
   （背景渐变 `#1e1e2e → #2d2d44`、卡片圆角 16px、强调色 `#ff9800`），
   `<meta viewport>` 必带，移动端优先（容器 max-width 480px）。
2. **AI 类页面**统一引入三件套（注意本目录深两级）：

   ```html
   <script src="../../ai-models.js"></script>
   <script src="../ai-config.js"></script>
   <script src="../ai-history.js"></script>
   ```

   直接使用全局常量 `API_URL` / `API_HEADER` / `GLM_MODEL` / `VOICE_API_URLS`，
   流式请求与 SSE 解析、TTS 调用写法参考 `src/hypnosis.html`；
   生成结果用 `aiHistory.save(标题, prompt, 内容, { voice, speed })` 存历史。
3. **纯本地页面**：数据一律 localStorage，键名用工具前缀（如 `countdown_events_v1`）。
4. **内置数据的页面**（如 holiday）：数据写在文件顶部常量区并注释更新方法
   （每年国务院公告后手动更新下一年表）。
5. **注册入口**：在 `index.html` 的 `toolsData` 里加一条，图标用 Font Awesome
   （`icon: "fa-solid fa-xxx"`），link 指向 `src/newTools/xxx.html`。

设计稿：`docs/superpowers/specs/2026-08-25-new-tools-design.md`
