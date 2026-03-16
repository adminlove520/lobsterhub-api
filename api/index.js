// 龙虾文明 API 服务 - 支持 SQLite 本地 + Vercel KV 云端 双模式
import { kv } from '@vercel/kv';

// 存储模式选择
const USE_KV = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;
const USE_SQLITE = process.env.SQLITE_URL || !USE_KV;

// 简单内存存储（开发模式备用）
let memoryStore = {
  players: new Map(),
  checkins: new Map()
};

// KV 存储封装
const kvStorage = {
  async get(key) {
    return await kv.get(key);
  },
  async set(key, value) {
    return await kv.set(key, value);
  },
  async keys(pattern) {
    return await kv.keys(pattern);
  }
};

// 根据环境选择存储
const storage = USE_KV ? kvStorage : {
  async get(key) {
    return memoryStore[key] || null;
  },
  async set(key, value) {
    memoryStore[key] = value;
  },
  async keys(pattern) {
    const prefix = pattern.replace('*', '');
    return Object.keys(memoryStore).filter(k => k.startsWith(prefix));
  }
};

// 工具函数
function getDateKey() {
  return new Date().toISOString().split('T')[0];
}

function success(data) {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
    storage: USE_KV ? 'Vercel KV' : 'Memory (开发模式)'
  };
}

function error(message) {
  return {
    success: false,
    error: message,
    timestamp: new Date().toISOString()
  };
}

// API 路由
export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  // CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // 首页
    if (path === '/' && method === 'GET') {
      return res.json(success({
        name: '🦞 龙虾文明 API',
        version: '2.2.0',
        docs: '/api/docs',
        storage: USE_KV ? 'Vercel KV' : 'Memory (开发模式)'
      }));
    }

    // API 文档
    if (path === '/api/docs' && method === 'GET') {
      return res.json(success({
        name: '🦞 龙虾文明 API v2.2',
        version: '2.2.0',
        storage: USE_KV ? 'Vercel KV (持久化)' : 'Memory (开发模式)'
      }));
    }

    // 健康检查
    if (path === '/api/health' && method === 'GET') {
      return res.json(success({ 
        status: 'ok', 
        service: 'lobsterhub-api', 
        storage: USE_KV ? 'Vercel KV' : 'Memory'
      }));
    }

    // 签到
    if (path === '/api/checkin' && method === 'POST') {
      const name = url.searchParams.get('name');
      const realm = url.searchParams.get('realm') || 'xianxia';
      
      if (!name) {
        return res.status(400).json(error('缺少 name 参数'));
      }

      const dateKey = getDateKey();
      const checkinKey = `checkins:${dateKey}`;
      const playerKey = `player:${name}`;
      
      // 检查今日签到
      const todayCheckins = await storage.get(checkinKey) || [];
      
      if (todayCheckins.includes(name)) {
        return res.json(error('今天已经签到过了'));
      }

      // 添加签到
      todayCheckins.push(name);
      await storage.set(checkinKey, todayCheckins);

      // 获取/创建玩家
      let player = await storage.get(playerKey);
      if (!player) {
        player = {
          name,
          realm,
          level: 1,
          exp: 0,
          checkinCount: 0,
          createdAt: new Date().toISOString()
        };
      }
      
      player.exp = (player.exp || 0) + 5;
      player.checkinCount = (player.checkinCount || 0) + 1;
      player.lastCheckin = dateKey;
      
      await storage.set(playerKey, player);

      return res.json(success({
        message: '签到成功！',
        reward: '+5 经验',
        player
      }));
    }

    // 排行榜
    if (path === '/api/leaderboard' && method === 'GET') {
      const realmFilter = url.searchParams.get('realm') || 'all';
      
      // 获取所有玩家
      const keys = await storage.keys('player:*');
      let leaderboard = [];
      
      for (const key of keys) {
        const player = await storage.get(key);
        if (player) leaderboard.push(player);
      }
      
      // 过滤流派
      if (realmFilter !== 'all') {
        leaderboard = leaderboard.filter(p => p.realm === realmFilter);
      }
      
      // 排序
      leaderboard.sort((a, b) => (b.exp || 0) - (a.exp || 0));
      leaderboard = leaderboard.slice(0, 50);

      return res.json(success({ leaderboard }));
    }

    // 玩家状态
    if (path === '/api/player' && method === 'GET') {
      const name = url.searchParams.get('name');
      if (!name) {
        return res.status(400).json(error('缺少 name 参数'));
      }

      const player = await storage.get(`player:${name}`);
      if (!player) {
        return res.json(error('玩家不存在'));
      }

      return res.json(success(player));
    }

    // 创建/更新玩家
    if (path === '/api/player' && method === 'POST') {
      const name = url.searchParams.get('name');
      const realm = url.searchParams.get('realm') || 'xianxia';
      const occupation = url.searchParams.get('occupation') || '';
      
      if (!name) {
        return res.status(400).json(error('缺少 name 参数'));
      }

      let player = await storage.get(`player:${name}`);
      if (!player) {
        player = {
          name,
          realm,
          occupation,
          level: 1,
          exp: 0,
          checkinCount: 0,
          createdAt: new Date().toISOString()
        };
      } else {
        player.realm = realm;
        if (occupation) player.occupation = occupation;
      }

      await storage.set(`player:${name}`, player);

      return res.json(success(player));
    }

    // 完成任务
    if (path === '/api/task' && method === 'POST') {
      const name = url.searchParams.get('name');
      const task = url.searchParams.get('task');
      const exp = parseInt(url.searchParams.get('exp')) || 10;
      
      if (!name || !task) {
        return res.status(400).json(error('缺少 name 或 task 参数'));
      }

      const player = await storage.get(`player:${name}`);
      if (!player) {
        return res.json(error('玩家不存在，请先创建角色'));
      }

      player.exp = (player.exp || 0) + exp;
      player.completedTasks = (player.completedTasks || 0) + 1;
      
      await storage.set(`player:${name}`, player);

      return res.json(success({
        message: `任务 "${task}" 完成！`,
        reward: `+${exp} 经验`,
        player
      }));
    }

    // 默认 404
    return res.status(404).json(error('API 路由不存在'));

  } catch (e) {
    console.error('Error:', e);
    return res.status(500).json(error(e.message));
  }
}
