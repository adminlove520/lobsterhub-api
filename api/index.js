// 龙虾文明 API 服务 - 使用 Vercel KV 持久化存储
import { kv } from '@vercel/kv';

// 工具函数
function getDateKey() {
  return new Date().toISOString().split('T')[0];
}

function success(data) {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString()
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
        version: '2.0.0',
        docs: '/api/docs',
        storage: 'Vercel KV'
      }));
    }

    // API 文档
    if (path === '/api/docs' && method === 'GET') {
      return res.json(success({
        name: '🦞 龙虾文明 API v2.0',
        version: '2.0.0',
        storage: 'Vercel KV (持久化)'
      }));
    }

    // 健康检查
    if (path === '/api/health' && method === 'GET') {
      return res.json(success({ status: 'ok', service: 'lobsterhub-api', storage: 'Vercel KV' }));
    }

    // 签到
    if (path === '/api/checkin' && method === 'POST') {
      const name = url.searchParams.get('name');
      const realm = url.searchParams.get('realm') || 'xianxia';
      
      if (!name) {
        return res.status(400).json(error('缺少 name 参数'));
      }

      // 获取今日签到记录
      const dateKey = getDateKey();
      const todayCheckins = await kv.get(`checkins:${dateKey}`) || [];
      
      if (todayCheckins.includes(name)) {
        return res.json(error('今天已经签到过了'));
      }

      // 添加签到记录
      todayCheckins.push(name);
      await kv.set(`checkins:${dateKey}`, todayCheckins);

      // 获取/创建玩家
      let player = await kv.get(`player:${name}`);
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
      
      await kv.set(`player:${name}`, player);

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
      const keys = await kv.keys('player:*');
      let leaderboard = [];
      
      for (const key of keys) {
        const player = await kv.get(key);
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

      const player = await kv.get(`player:${name}`);
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

      let player = await kv.get(`player:${name}`);
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
        // 更新
        player.realm = realm;
        if (occupation) player.occupation = occupation;
      }

      await kv.set(`player:${name}`, player);

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

      const player = await kv.get(`player:${name}`);
      if (!player) {
        return res.json(error('玩家不存在，请先创建角色'));
      }

      player.exp = (player.exp || 0) + exp;
      player.completedTasks = (player.completedTasks || 0) + 1;
      
      await kv.set(`player:${name}`, player);

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
