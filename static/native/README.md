# ⚚ Hermes Native UI

> 为 Hermes Agent 量身打造的**视觉震撼、技术可控**原生 WebUI。
> 借鉴白龙马 (Bailongma) 的视觉设计语言，但数据结构对 Hermes 原生。
> 无框架，纯原生 JS + Web Components + D3.js。

---

## 项目状态

```
Phase 0 ✅ 项目初始化 + 方案文档
Phase 1 ✅ 视觉骨架（mock 数据，5 套主题，D3 图谱）
Phase 2 ⬜ 接入 Hermes 真实数据
Phase 3 ⬜ ACUI 卡片系统 + 多媒体
Phase 4 ⬜ Electron 桌面打包
```

## 快速开始

```bash
# 安装依赖（Phase 4 需要，Phase 1-3 无需）
npm install

# 开发模式（浏览器直接打开即可，无需 server）
# 直接用浏览器打开 index.html

# 或者用 serve
npx serve . -p 8789

# Electron 桌面模式（Phase 4）
npm start
```

## 项目结构

```
hermes-native-ui/
├── index.html              # 入口 → 浏览器直接打开
├── package.json            # 项目配置
├── README.md               # 本文件
├── DESIGN.md               # 架构设计文档
├── VISUAL.md               # 视觉设计系统文档
├── ROADMAP.md              # 实施路线图
├── styles/
│   ├── theme.css           # CSS 变量 + 5 套主题
│   ├── layout.css          # 三面板毛玻璃布局
│   └── animations.css      # 全局动画定义
├── src/
│   ├── app.js              # 主应用入口
│   ├── memory-graph.js     # D3 记忆图谱（独立模块-待拆分）
│   ├── chat.js             # 聊天系统（待拆分）
│   ├── thought-stream.js   # 思考流（待拆分）
│   └── acui/               # ACUI 卡片系统（Phase 3）
└── electron/               # Electron 配置（Phase 4）
```

## 主题预览

| Midnight | Aurora | Forest | Crimson | Abyss |
|:--------:|:------:|:------:|:-------:|:-----:|
| 暗黑科技蓝 | 极光紫 | 竹林绿 | 暗红暖 | 深海蓝 |

## 技术栈

- **框架**: 原生 JS (ES Modules) — 零依赖
- **可视化**: D3.js v7 — 力导向记忆图谱
- **样式**: CSS 变量驱动 — 5 套主题
- **实时**: SSE + WebSocket
- **打包**: Electron 33 (Phase 4)

## 参考

- 灵感来源: [BaiLongma](https://github.com/xiaoyuanda666-ship-it/BaiLongma) — 白龙马数字意识框架
- 后端: [Hermes Agent](https://hermes-agent.nousresearch.com/) — 持久记忆自主 Agent

## License

MIT
