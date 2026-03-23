# AuthorClaw 启动与运维指南

用于快速查阅 AuthorClaw 的启动、停止与远程访问方式。

---

## 本地电脑（Windows 直连）

### 启动服务
```bash
cd C:\Users\chris\OneDrive\Documents\Automations\AuthorClaw\authorclaw
npm start
```

### 开发模式（自动重载）
```bash
npm run dev
```

### 停止服务
在终端按 `Ctrl+C`，或执行：
```bash
taskkill /F /FI "WINDOWTITLE eq *authorclaw*"
```

### 控制台地址
- `http://localhost:3847`

---

## VPS / 远程服务器（Docker）

### 首次部署
```bash
# 1. 克隆仓库
git clone https://github.com/hbyxyan/authorclaw.git
cd authorclaw

# 2. 安装 Node 22+（若不用 Docker）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 3. 创建 .env（写入你的 vault key）
echo "AUTHORCLAW_VAULT_KEY=your-64-char-hex-key-here" > .env
chmod 600 .env

# 4. 安装依赖（若不用 Docker）
npm ci
```

### Docker 启动
```bash
npm run docker:up
npm run docker:logs
npm run docker:down
```

### 非 Docker 启动
```bash
npm start
```

---

## 远程访问（推荐 SSH 隧道）

AuthorClaw 默认绑定 `127.0.0.1`，不会直接暴露到公网。

```bash
ssh -L 3847:localhost:3847 user@your-vps-ip
```

然后在本机浏览器打开：
- `http://localhost:3847`

如需公网访问，请配置 Nginx/Caddy + HTTPS + 身份验证。

---

## 关键路径

| 项目 | 路径 |
|---|---|
| 主入口 | `gateway/src/index.ts` |
| 控制台 | `dashboard/dist/index.html` |
| 技能 | `skills/{core,author,marketing}/` |
| 配置 | `config/default.json`、`config/user.json` |
| 加密 vault | `config/.vault/vault.enc` |
| 项目输出 | `workspace/projects/` |
| 作者人设 | `workspace/.config/personas.json` |

---

## API Key 配置（控制台 > 设置）

1. 打开 `http://localhost:3847`
2. 进入 **设置**
3. 填写并保存 API Key（AES-256-GCM 加密存储）

---

## Telegram 机器人

1. 在 Telegram 联系 `@BotFather` 并执行 `/newbot`
2. 复制 bot token
3. 控制台 **设置** 中粘贴并保存
4. 在 **Telegram** 页面填写你的用户 ID 并保存

---

## 常用命令

```bash
# 服务状态
curl http://localhost:3847/api/status

# TypeScript 编译检查（无输出即通过）
npx tsc --noEmit

# 项目列表
curl http://localhost:3847/api/projects/list | node -e "const d=require('fs').readFileSync(0,'utf8');JSON.parse(d).projects.forEach(p=>console.log(p.id,p.title,p.status,p.progress+'%'))"
```

---

## 安全检查清单

- [ ] `.env` 权限为 600
- [ ] Vault Key 使用独立 64 位十六进制字符串
- [ ] 不在明文文件中保存 API Key
- [ ] 仅通过隧道或 HTTPS 反向代理进行远程访问
- [ ] 服务继续绑定 `127.0.0.1`
