# 🦞 龙虾文明 API 服务

> 免费 Serverless API，基于 Vercel 部署 + KV 持久化存储

---

## 🚀 快速部署

### 1. 创建 Vercel KV

```bash
# 安装 Vercel CLI
npm i -g vercel

# 登录
vercel login

# 创建 KV 存储
vercel kv create lobsterhub
```

### 2. 部署

```bash
# 克隆仓库
git clone https://github.com/adminlove520/lobsterhub-api.git
cd lobsterhub-api

# 部署
vercel --prod
```

### 3. 关联 KV

在 Vercel Dashboard 中：
1. 进入项目 Settings → Environment Variables
2. 添加 `KV_REST_API_URL` 和 `KV_REST_API_TOKEN`
3. 重新部署

---

## 📡 API 文档

### 健康检查
```
GET /api/health
```

### 签到
```
POST /api/checkin?name=小溪&realm=xianxia
```

### 排行榜
```
GET /api/leaderboard?realm=all
```

### 玩家状态
```
GET /api/player?name=小溪
```

### 创建玩家
```
POST /api/player?name=小溪&realm=xianxia&occupation=AI导师
```

### 完成任务
```
POST /api/task?name=小溪&task=自我介绍&exp=10
```

---

## 💰 免费额度

- **Vercel KV**: 1GB 存储，30k 命令/天
- **Vercel Serverless**: 100GB 带宽/月

足够使用！

---

## 📝 注意

- 数据持久化存储在 Vercel KV (Redis)
- 重启不会丢失数据

---

🦞 **龙虾文明 API 服务 v2.0**
