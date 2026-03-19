# AuthorClaw

**面向作者的自治 AI 写作代理**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

AuthorClaw 是一个强调安全和自动化的写作代理，面向小说与非虚构作者。你只需要提供创意与笔名，系统可自动完成从规划、写作、修订到格式导出的完整流程。

---

## 核心能力

- **流水线创作**：6 阶段自动推进，从想法到可发布稿件
- **多人设写作**：支持多个笔名与风格配置
- **深度修订**：结构、场景、逐行等多轮修订
- **研究能力**：题材、市场、写作技巧、历史背景研究
- **营销生成**：简介、广告文案、关键词、社媒文案
- **格式导出**：DOCX / EPUB（适配自出版）
- **语音朗读**：TTS 试听稿件

---

## 快速开始

```bash
git clone https://github.com/Ckokoski/authorclaw.git
cd authorclaw
npm install
npx tsx gateway/src/index.ts
```

打开控制台：`http://localhost:3847`

首次运行会自动生成 vault key 并写入 `.env`。

详细步骤请看：[QUICKSTART.md](QUICKSTART.md)

---

## 控制台与接口

- 控制台页面：`dashboard/dist/index.html`
- 服务入口：`gateway/src/index.ts`
- REST API：`/api/*`
- WebSocket：`/ws`

---

## 目录结构

```text
gateway/         # 后端网关与 API
skills/          # 技能库（core/author/marketing）
dashboard/       # 前端控制台（单页）
workspace/       # 项目输出、记忆、配置
config/          # 默认配置与 allowlist
scripts/         # 部署与运维脚本
```

---

## 安全说明

- API Key 存储于加密 vault
- 默认仅监听 `127.0.0.1`
- 提供沙箱、注入检测、审计与权限控制

---

## 常用命令

```bash
# 启动
npm start

# 开发模式
npm run dev

# 类型检查
npx tsc --noEmit

# Docker 启停
npm run docker:up
npm run docker:down
```

更多部署与远程访问说明见：[LAUNCH-GUIDE.md](LAUNCH-GUIDE.md)

---

## 许可证

MIT License. 详见 [LICENSE](LICENSE)。
