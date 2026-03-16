// 龙虾文明 API 服务 - 支持 Redis/Vercel KV/内存 三模式

// 存储模式选择
const USE_KV = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;
const USE_REDIS = !!process.env.REDIS_URL;

// 管理员密钥列表（环境变量，逗号分隔）
const DEFAULT_KEY = 'lobster-admin-2026'; // 默认密钥
const ADMIN_KEYS = (process.env.ADMIN_KEYS || process.env.ADMIN_KEY || DEFAULT_KEY).split(',').map(k => k.trim()).filter(k => k);

// 如果没有配置密钥，自动生成默认密钥
if (ADMIN_KEYS.length === 0) {
  ADMIN_KEYS.push('lobster-admin-' + Math.random().toString(36).slice(2, 10));
}

// ========== 邀请系统 ==========
const INVITE_KEY = 'invite_codes';

function generateInviteCode() {
  return 'LOB' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// 生成新密钥
function generateAdminKey() {
  return 'lobster-' + Math.random().toString(36).slice(2, 12);
}

// 验证管理员
function isAdmin(url) {
  const key = url.searchParams.get('admin_key');
  return ADMIN_KEYS.includes(key);
}

// 操作日志（Redis 持久化，最多500条）
const LOG_KEY = 'lobster_logs';

async function addLog(storage, action, detail, admin = false) {
  try {
    const logs = (await storage.get(LOG_KEY)) || [];
    logs.unshift({ timestamp: new Date().toISOString(), action, detail, admin });
    if (logs.length > 500) logs.length = 500;
    await storage.set(LOG_KEY, logs);
  } catch(e) { console.error('log error:', e); }
}

// 简单内存存储（开发模式备用）
let memoryStore = {};

// Redis 客户端
let redisClient = null;
let redisReady = false;

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

// 存储封装
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
  // 初始化 Redis
  if (USE_REDIS && !redisReady) {
    await initRedis();
  }

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
      const keys = await storage.keys('player:*');
      let totalPlayers = 0, totalCheckins = 0;
      for (const key of keys) {
        const p = await storage.get(key);
        if (p) { totalPlayers++; totalCheckins += (p.checkinCount || 0); }
      }
      
      return res.json(success({
        name: '🦞 龙虾文明 API',
        version: '2.5.0',
        docs: '/api/docs',
        stats: { players: totalPlayers, checkins: totalCheckins },
        storage: USE_KV ? 'Vercel KV' : (USE_REDIS ? 'Redis' : 'Memory')
      }));
    }

    // API 文档
    if (path === '/api/docs' && method === 'GET') {
      return res.json(success({
        name: '🦞 龙虾文明 API v2.5',
        version: '2.5.0',
        storage: USE_KV ? 'Vercel KV' : (USE_REDIS ? 'Redis (持久化)' : 'Memory')
      }));
    }

    // 健康检查
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
      
      // 检查今日签到
      const todayCheckins = (await storage.get(checkinKey)) || [];
      
      if (todayCheckins.includes(name)) {
        return res.json(error('今天已经签到过了'));
      }

      // 添加签到
      todayCheckins.push(name);
      await storage.set(checkinKey, todayCheckins);

      // 获取/创建玩家
      let player = await storage.get(playerKey);
      if (!player) {
        player = { name, realm, level: 1, exp: 0, checkinCount: 0, createdAt: new Date().toISOString() };
      }
      
      player.exp = (player.exp || 0) + 5;
      player.checkinCount = (player.checkinCount || 0) + 1;
      player.lastCheckin = dateKey;
      
      await storage.set(playerKey, player);
      await addLog(storage, '签到', { name, realm: player.realm });

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

    // 创建/更新玩家（需要邀请码）
    if (path === '/api/player' && method === 'POST') {
      const name = url.searchParams.get('name');
      const realm = url.searchParams.get('realm') || 'xianxia';
      const occupation = url.searchParams.get('occupation') || '';
      const inviteCode = url.searchParams.get('invite_code') || '';
      
      if (!name) {
        return res.status(400).json(error('缺少 name 参数'));
      }

      // 验证邀请码（如果玩家不存在）
      let player = await storage.get(`player:${name}`);
      if (!player) {
        // 新玩家需要邀请码
        if (!inviteCode) {
          return res.status(400).json(error('需要邀请码，请联系管理员获取'));
        }
        
        // 验证邀请码
        const inviteData = await storage.get(`${INVITE_KEY}:${inviteCode}`);
        if (!inviteData) {
          return res.status(400).json(error('邀请码无效'));
        }
        
        // 检查是否已使用
        if (inviteData.used) {
          return res.status(400).json(error('邀请码已使用'));
        }
        
        // 标记为已使用
        inviteData.used = true;
        inviteData.usedBy = name;
        inviteData.usedAt = new Date().toISOString();
        await storage.set(`${INVITE_KEY}:${inviteCode}`, inviteData);
        
        player = { 
          name, 
          realm, 
          occupation, 
          level: 1, 
          exp: inviteData.bonus || 10, // 邀请奖励
          checkinCount: 0, 
          createdAt: new Date().toISOString(),
          invitedBy: inviteData.creator
        };
        
        // 给邀请人奖励
        if (inviteData.creator) {
          const inviter = await storage.get(`player:${inviteData.creator}`);
          if (inviter) {
            inviter.exp = (inviter.exp || 0) + 5; // 邀请奖励
            await storage.set(`player:${inviteData.creator}`, inviter);
          }
        }
      } else {
        // 老玩家更新
        player.realm = realm;
        if (occupation) player.occupation = occupation;
      }

      await storage.set(`player:${name}`, player);
      await addLog(storage, '创建玩家', { name, realm, occupation, inviteCode: inviteCode ? '已使用' : '老玩家' });

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
      await addLog(storage, '完成任务', { name, task, exp });

      return res.json(success({ message: `任务 "${task}" 完成！`, reward: `+${exp} 经验`, player }));
    }

    // 玩家生成邀请码
    if (path === '/api/invite' && method === 'POST') {
      const name = url.searchParams.get('name');
      
      if (!name) {
        return res.status(400).json(error('缺少 name 参数'));
      }
      
      // 验证玩家存在
      const player = await storage.get(`player:${name}`);
      if (!player) {
        return res.status(400).json(error('玩家不存在，请先创建角色'));
      }
      
      // 检查玩家是否已有邀请码
      const existingCode = await storage.get(`${INVITE_KEY}:player:${name}`);
      if (existingCode) {
        return res.json(success({ 
          message: '你已有邀请码！',
          code: existingCode.code,
          bonus: existingCode.bonus,
          usedCount: existingCode.usedCount || 0
        }));
      }
      
      // 生成邀请码
      const code = generateInviteCode();
      const bonus = 10; // 默认奖励
      
      await storage.set(`${INVITE_KEY}:${code}`, {
        code,
        creator: name,
        bonus,
        used: false,
        usedBy: null,
        usedAt: null,
        createdAt: new Date().toISOString()
      });
      
      // 记录玩家的邀请码
      await storage.set(`${INVITE_KEY}:player:${name}`, {
        code,
        bonus,
        usedCount: 0
      });
      
      await addLog(storage, '玩家生成邀请码', { creator: name, code });
      
      return res.json(success({ 
        message: '邀请码生成成功！',
        code: code,
        bonus: bonus,
        hint: '邀请朋友加入，双方都获得 ' + bonus + ' 经验奖励！'
      }));
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
      
      // 删除玩家
      await storage.set(`player:${name}`, null);
      
      // 清理该玩家的所有签到记录（遍历最近7天）
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
      
      return res.json(success({ message: `已删除玩家 ${name} 及所有签到记录` }));
    }

    // 修改经验
    if (path === '/api/admin/exp' && method === 'POST') {
      if (!isAdmin(url)) {
        return res.status(403).json(error('无权限，需要 admin_key'));
      }
      const name = url.searchParams.get('name');
      const exp = parseInt(url.searchParams.get('exp')) || 0;
      const action = url.searchParams.get('action') || 'set'; // set, add, sub
      
      let player = await storage.get(`player:${name}`);
      if (!player) {
        return res.json(error('玩家不存在'));
      }
      
      if (action === 'add') player.exp = (player.exp || 0) + exp;
      else if (action === 'sub') player.exp = Math.max(0, (player.exp || 0) - exp);
      else player.exp = exp;
      
      await storage.set(`player:${name}`, player);
      await addLog(storage, '修改经验', { name, exp, action }, true);
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
        // 重置单个玩家
        const checkinKey = `checkins:${dateKey}`;
        let checkins = (await storage.get(checkinKey)) || [];
        checkins = checkins.filter(n => n !== name);
        await storage.set(checkinKey, checkins);
        await addLog(storage, '重置签到', { name }, true);
        return res.json(success({ message: `已重置 ${name} 今日签到` }));
      } else {
        // 重置所有今日签到
        const checkinKey = `checkins:${dateKey}`;
        await storage.set(checkinKey, []);
        await addLog(storage, '重置所有签到', {}, true);
        return res.json(success({ message: '已重置所有玩家今日签到' }));
      }
    }

    // 清空所有数据（危险！）
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
      await addLog(storage, '清空数据', {}, true);
      return res.json(success({ message: '已清空所有玩家数据' }));
    }

    // 查看所有数据
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

    // 查看签到记录
    if (path === '/api/admin/checkins' && method === 'GET') {
      if (!isAdmin(url)) {
        return res.status(403).json(error('无权限，需要 admin_key'));
      }
      const dateKey = getDateKey();
      const checkins = (await storage.get(`checkins:${dateKey}`)) || [];
      return res.json(success({ date: dateKey, checkins, count: checkins.length }));
    }

    // 获取管理员列表
    if (path === '/api/admin/admins' && method === 'GET') {
      if (!isAdmin(url)) {
        return res.status(403).json(error('无权限，需要 admin_key'));
      }
      const safeKeys = ADMIN_KEYS.map(k => k.slice(0, 4) + '****');
      return res.json(success({ admins: safeKeys, count: safeKeys.length }));
    }

    // 生成邀请码
    if (path === '/api/admin/gen-invite' && method === 'POST') {
      if (!isAdmin(url)) {
        return res.status(403).json(error('无权限，需要 admin_key'));
      }
      const code = generateInviteCode();
      const creator = url.searchParams.get('creator') || 'admin';
      const bonus = parseInt(url.searchParams.get('bonus')) || 10;
      
      await storage.set(`${INVITE_KEY}:${code}`, {
        code,
        creator,
        bonus,
        used: false,
        createdAt: new Date().toISOString()
      });
      
      await addLog(storage, '生成邀请码', { code, creator, bonus }, true);
      
      return res.json(success({ 
        message: '邀请码已生成！',
        code: code,
        bonus: bonus,
        hint: '新玩家使用此码注册可获得 ' + bonus + ' 经验奖励'
      }));
    }

    // 查看邀请码列表
    if (path === '/api/admin/invites' && method === 'GET') {
      if (!isAdmin(url)) {
        return res.status(403).json(error('无权限，需要 admin_key'));
      }
      const keys = await storage.keys(`${INVITE_KEY}:*`);
      let invites = [];
      for (const key of keys) {
        const inv = await storage.get(key);
        if (inv) invites.push(inv);
      }
      return res.json(success({ invites, count: invites.length }));
    }

    // 生成新的管理员密钥
    if (path === '/api/admin/gen-key' && method === 'POST') {
      if (!isAdmin(url)) {
        return res.status(403).json(error('无权限，需要 admin_key'));
      }
      const newKey = generateAdminKey();
      ADMIN_KEYS.push(newKey);
      await addLog(storage, '生成密钥', {}, true);
      return res.json(success({ 
        message: '新密钥已生成（仅显示一次，请妥善保管！）',
        newKey: newKey,
        hint: '设置环境变量 ADMIN_KEYS=' + ADMIN_KEYS.join(',') + ' 永久保存'
      }));
    }

    // 查看日志
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
