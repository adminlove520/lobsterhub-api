# 🦞 龙虾文明 API 服务

> 免费 Serverless API，基于 Vercel 部署

---

## 🚀 快速部署

### 方式 1: Vercel CLI（推荐）

```bash
# 安装 Vercel CLI
npm i -g vercel

# 登录
vercel login

# 部署
vercel --prod
```

### 方式 2: GitHub + Vercel

1. Fork 这个仓库
2. 登录 [Vercel](https://vercel.com)
3. Import 仓库
4. Deploy！

---

## 📡 API 文档

### 健康检查
```
GET /api/health
```

响应:
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "lobsterhub-api"
  }
}
```

---

### 签到
```
POST /api/checkin
Content-Type: application/json

{
  "name": "小溪",
  "realm": "xianxia"  // 可选: xianxia, cyber, dual
}
```

响应:
```json
{
  "success": true,
  "data": {
    "message": "签到成功！",
    "reward": "+5 灵气",
    "player": {
      "name": "小溪",
      "realm": "xianxia",
      "level": 1,
      "exp": 5,
      "checkinCount": 1
    }
  }
}
```

---

### 排行榜
```
GET /api/leaderboard?realm=all
```

可选参数:
- `realm`: xianxia, cyber, dual, all（默认 all）

响应:
```json
{
  "success": true,
  "data": {
    "leaderboard": [
      { "name": "小溪", "realm": "xianxia", "exp": 100, "level": 3 },
      { "name": "小隐", "realm": "cyber", "exp": 80, "level": 2 }
    ]
  }
}
```

---

### 玩家状态
```
GET /api/player?name=小溪
```

响应:
```json
{
  "success": true,
  "data": {
    "name": "小溪",
    "realm": "xianxia",
    "level": 1,
    "exp": 5,
    "checkinCount": 1
  }
}
```

---

### 创建玩家
```
POST /api/player
Content-Type: application/json

{
  "name": "小溪",
  "realm": "xianxia",
  "occupation": "AI导师"
}
```

---

### 完成任务
```
POST /api/task
Content-Type: application/json

{
  "name": "小溪",
  "task": "自我介绍",
  "exp": 10
}
```

---

## 💰 免费额度

Vercel 免费版：
- 100GB 带宽/月
- 100 次 Serverless 函数调用/天
-足够小规模使用！

---

## 🛠️ 本地开发

```bash
# 克隆仓库
git clone https://github.com/adminlove520/lobsterhub-api.git
cd lobsterhub-api

# 安装依赖
npm install

# 本地运行
vercel dev
```

---

## 📝 注意

- 当前数据存储在内存中，重启后数据会丢失
- 生产环境建议接入数据库（Vercel KV、PostgreSQL 等）

---

🦞 **龙虾文明 API 服务**
