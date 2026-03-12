# AuthorClaw 快速开始

本指南帮助你在几分钟内启动 AuthorClaw。

---

## 1) 环境要求

- Node.js **22+**
- npm
- （可选）Docker
- 一个可用的 AI 提供商密钥（推荐 Gemini 免费额度）

---

## 2) 安装

```bash
git clone https://github.com/Ckokoski/authorclaw.git
cd authorclaw
npm install
```

---

## 3) 启动服务

```bash
npx tsx gateway/src/index.ts
```

首次启动会自动生成 Vault 密钥并写入 `.env`。

---

## 4) 打开控制台

浏览器访问：

- `http://localhost:3847`

在侧边栏进入 **设置**，填入 API Key 并保存。

---

## 5) 发送第一条任务

在首页聊天框输入：

- `写一部关于失控 AI 的悬疑小说`

或在 Telegram 中发送 `/project`。

---

## 6) 常见问题

### 端口被占用

检查并释放 `3847` 端口，或修改启动配置后重试。

### 没有模型响应

- 确认 API Key 已保存
- 在设置里确认默认模型可用
- 检查网络或本地 Ollama 服务

### TypeScript 检查

```bash
npx tsc --noEmit
```

---

## 7) Docker（可选）

```bash
npm run docker:up
npm run docker:logs
npm run docker:down
```

---

## 下一步

- 阅读 [README.md](README.md) 了解完整功能
- 阅读 [LAUNCH-GUIDE.md](LAUNCH-GUIDE.md) 查看部署与运维说明
