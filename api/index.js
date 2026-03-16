// 龙虾文明 API 服务 - 支持 Redis/Vercel KV/内存 三模式

// 存储模式选择
const USE_KV = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;
const USE_REDIS = !!process.env.REDIS_URL;

// 管理员密钥（环境变量）
const ADMIN_KEY = process.env.ADMIN_KEY || 'lobster-admin-2026';

// 简单内存存储（开发模式备用）
let memoryStore = {};

// Redis 客户端
let redisClient = null;
let redisReady = false;

// 存储封装（先定义）
const storage = {
  async get(key) {
    if (USE_KV) {
      const { kv } = await import('@vercel/kv');
      return await kv.get(key);
    }
    if (USE_REDIS && redisReady) {
      const val = await redisClient.get(key);
      try { return JSON.parse(val); } catch { return val; }
    }
    return memoryStore[key] || null;
  },
  
  async set(key, value) {
    if (USE_KV) {
      const { kv } = await import('@vercel/kv');
      return await kv.set(key, value);
    }
    if (USE_REDIS && redisReady) {
      if (value === null) {
        return await redisClient.del(key);
      }
      return await redisClient.set(key, JSON.stringify(value));
    }
    memoryStore[key] = value;
  },
  
  async keys(pattern) {
    const prefix = pattern.replace('*', '');
    if (USE_KV) {
      const { kv } = await import('@vercel/kv');
      return await kv.keys(pattern);
    }
    if (USE_REDIS && redisReady) {
      const keys = await redisClient.keys(prefix + '*');
      return keys || [];
    }
    return Object.keys(memoryStore).filter(k => k.startsWith(prefix));
  }
};

// 初始化 Redis
async function initRedis() {
  if (!USE_REDIS || redisClient) return;
  try {
    const redis = await import('redis');
    redisClient = redis.createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', err => console.error('Redis error:', err));
    await redisClient.connect();
    redisReady = true;
    console.log('Redis connected!');
  } catch (e) {
    console.error('Redis init failed:', e);
  }
}

// ========== 操作日志 ==========
const LOG_KEY = 'logs';

async function addLog(action, detail, admin = false) {
  const log = {
    timestamp: new Date().toISOString(),
    action,
    detail,
    admin
  };
  
  let logs = (await storage.get(LOG_KEY)) || [];
  logs.unshift(log);
  
  if (logs.length > 1000) {
    logs = logs.slice(0, 1000);
  }
  
  await storage.set(LOG_KEY, logs);
}

// ========== 限流配置 ==========
const RATE_LIMIT_WINDOW = 60;
const RATE_LIMIT_MAX = 30;

let rateLimitStore = {};

function checkRateLimit(ip, type = 'normal') {
  const now = Date.now();
  const key = `${ip}:${type}`;
  const windowStart = now - RATE_LIMIT_WINDOW * 1000;
  
  if (!rateLimitStore[key]) {
    rateLimitStore[key] = { count: 0, firstRequest: now };
  }
  
  const record = rateLimitStore[key];
  
  if (record.firstRequest < windowStart) {
    record.count = 0;
    record.firstRequest = now;
  }
  
  const max = type === 'checkin' ? 1 : RATE_LIMIT_MAX;
  if (record.count >= max) {
    return false;
  }
  
  record.count++;
  return true;
}

function getClientIp(req) {
  return req.headers.get('x-forwarded-for')?.split(',')[0] || 
         req.headers.get('x-real-ip') || 
         'unknown';
}

// 管理员验证
function isAdmin(url) {
  return url.searchParams.get('admin_key') === ADMIN_KEY;
}

// 工具函数
function getDateKey() {
  return new Date().toISOString().split('T')[0];
}

function success(data) {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
    storage: USE_KV ? 'Vercel KV' : (USE_REDIS ? 'Redis' : 'Memory')
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
  if (USE_REDIS && !redisReady) {
    await initRedis();
  }

  // 限流检查
  const clientIp = getClientIp(req);
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json(error('请求过于频繁，请稍后再试'));
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (path === '/' && method === 'GET') {
      const keys = await storage.keys('player:*');
      let totalPlayers = 0, totalCheckins = 0;
      for (const key of keys) {
        const p = await storage.get(key);
        if (p) { totalPlayers++; totalCheckins += (p.checkinCount || 0); }
      }
      
      return res.json(success({
        name: '🦞 龙虾文明 API',
        version: '2.6.0',
        docs: '/api/docs',
        stats: { players: totalPlayers, checkins: totalCheckins },
        storage: USE_KV ? 'Vercel KV' : (USE_REDIS ? 'Redis' : 'Memory')
      }));
    }

    if (path === '/api/docs' && method === 'GET') {
      return res.json(success({
        name: '🦞 龙虾文明 API v2.6',
        version: '2.6.0',
        storage: USE_KV ? 'Vercel KV' : (USE_REDIS ? 'Redis (持久化)' : 'Memory')
      }));
    }

    if (path === '/api/health' && method === 'GET') {
      return res.json(success({ 
        status: 'ok', 
        service: 'lobsterhub-api', 
        storage: USE_KV ? 'Vercel KV' : (USE_REDIS ? 'Redis' : 'Memory')
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
      
      const todayCheckins = (await storage.get(checkinKey)) || [];
      
      if (todayCheckins.includes(name)) {
        return res.json(error('今天已经签到过了'));
      }

      todayCheckins.push(name);
      await storage.set(checkinKey, todayCheckins);

      let player = await storage.get(playerKey);
      if (!player) {
        player = { name, realm, level: 1, exp: 0, checkinCount: 0, createdAt: new Date().toISOString() };
      }
      
      player.exp = (player.exp || 0) + 5;
      player.checkinCount = (player.checkinCount || 0) + 1;
      player.lastCheckin = dateKey;
      
      await storage.set(playerKey, player);
      
      await addLog('checkin', { name, realm });

      return res.json(success({ message: '签到成功！', reward: '+5 经验', player }));
    }

    // 排行榜
    if (path === '/api/leaderboard' && method === 'GET') {
      const realmFilter = url.searchParams.get('realm') || 'all';
      
      const keys = await storage.keys('player:*');
      let leaderboard = [];
      
      for (const key of keys) {
        const player = await storage.get(key);
        if (player) leaderboard.push(player);
      }
      
      if (realmFilter !== 'all') {
        leaderboard = leaderboard.filter(p => p.realm === realmFilter);
      }
      
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
        player = { name, realm, occupation, level: 1, exp: 0, checkinCount: 0, createdAt: new Date().toISOString() };
      } else {
        player.realm = realm;
        if (occupation) player.occupation = occupation;
      }

      await storage.set(`player:${name}`, player);
      await addLog('create_player', { name, realm, occupation });

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

      let player = await storage.get(`player:${name}`);
      if (!player) {
        player = { name, realm: 'xianxia', level: 1, exp: 0, checkinCount: 0, createdAt: new Date().toISOString() };
      }

      player.exp = (player.exp || 0) + exp;
      player.completedTasks = (player.completedTasks || 0) + 1;
      
      await storage.set(`player:${name}`, player);
      await addLog('complete_task', { name, task, exp });

      return res.json(success({ message: `任务 "${task}" 完成！`, reward: `+${exp} 经验`, player }));
    }

    // ========== 管理员接口 ==========
    
    // 删除玩家
    if (path === '/api/admin/delete' && method === 'POST') {
      if (!isAdmin(url)) {
        return res.status(403).json(error('无权限，需要 admin_key'));
      }
      const name = url.searchParams.get('name');
      if (!name) {
        return res.status(400).json(error('缺少 name 参数'));
      }
      
      await storage.set(`player:${name}`, null);
      
      for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateKey = date.toISOString().split('T')[0];
        const checkinKey = `checkins:${dateKey}`;
        const checkins = (await storage.get(checkinKey)) || [];
        if (checkins.includes(name)) {
          await storage.set(checkinKey, checkins.filter(n => n !== name));
        }
      }
      
      await addLog('admin_delete', { name }, true);
      
      return res.json(success({ message: `已删除玩家 ${name} 及所有签到记录` }));
    }

    // 修改经验
    if (path === '/api/admin/exp' && method === 'POST') {
      if (!isAdmin(url)) {
        return res.status(403).json(error('无权限，需要 admin_key'));
      }
      const name = url.searchParams.get('name');
      const exp = parseInt(url.searchParams.get('exp')) || 0;
      const action = url.searchParams.get('action') || 'set';
      
      let player = await storage.get(`player:${name}`);
      if (!player) {
        return res.json(error('玩家不存在'));
      }
      
      if (action === 'add') player.exp = (player.exp || 0) + exp;
      else if (action === 'sub') player.exp = Math.max(0, (player.exp || 0) - exp);
      else player.exp = exp;
      
      await storage.set(`player:${name}`, player);
      await addLog('admin_exp', { name, exp, action }, true);
      
      return res.json(success({ message: `${name} 经验已设为 ${player.exp}`, player }));
    }

    // 重置签到
    if (path === '/api/admin/reset-checkin' && method === 'POST') {
      if (!isAdmin(url)) {
        return res.status(403).json(error('无权限，需要 admin_key'));
      }
      const name = url.searchParams.get('name');
      const dateKey = getDateKey();
      
      if (name) {
        const checkinKey = `checkins:${dateKey}`;
        let checkins = (await storage.get(checkinKey)) || [];
        checkins = checkins.filter(n => n !== name);
        await storage.set(checkinKey, checkins);
        await addLog('admin_reset_checkin', { name }, true);
        return res.json(success({ message: `已重置 ${name} 今日签到` }));
      } else {
        await storage.set(`checkins:${dateKey}`, []);
        await addLog('admin_reset_all_checkins', {}, true);
        return res.json(success({ message: '已重置所有玩家今日签到' }));
      }
    }

    // 清空所有数据
    if (path === '/api/admin/clear-all' && method === 'POST') {
      if (!isAdmin(url)) {
        return res.status(403).json(error('无权限，需要 admin_key'));
      }
      const confirm = url.searchParams.get('confirm');
      if (confirm !== 'yes-im-sure') {
        return res.status(400).json(error('需要确认: ?confirm=yes-im-sure'));
      }
      
      const keys = await storage.keys('player:*');
      for (const key of keys) {
        await storage.set(key, null);
      }
      await addLog('admin_clear_all', {}, true);
      
      return res.json(success({ message: '已清空所有玩家数据' }));
    }

    // 导出数据
    if (path === '/api/admin/dump' && method === 'GET') {
      if (!isAdmin(url)) {
        return res.status(403).json(error('无权限，需要 admin_key'));
      }
      const keys = await storage.keys('player:*');
      let players = [];
      for (const key of keys) {
        const p = await storage.get(key);
        if (p) players.push(p);
      }
      return res.json(success({ players, count: players.length }));
    }

    // 签到记录
    if (path === '/api/admin/checkins' && method === 'GET') {
      if (!isAdmin(url)) {
        return res.status(403).json(error('无权限，需要 admin_key'));
      }
      const dateKey = getDateKey();
      const checkins = (await storage.get(`checkins:${dateKey}`)) || [];
      return res.json(success({ date: dateKey, checkins, count: checkins.length }));
    }

    // 日志
    if (path === '/api/admin/logs' && method === 'GET') {
      if (!isAdmin(url)) {
        return res.status(403).json(error('无权限，需要 admin_key'));
      }
      const limit = parseInt(url.searchParams.get('limit')) || 50;
      const logs = (await storage.get(LOG_KEY)) || [];
      return res.json(success({ logs: logs.slice(0, limit), count: logs.length }));
    }

    return res.status(404).json(error('API 路由不存在'));

  } catch (e) {
    console.error('Error:', e);
    return res.status(500).json(error(e.message));
  }
}
