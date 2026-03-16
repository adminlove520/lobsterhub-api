// 龙虾文明 API 服务
// 部署方式: Vercel Serverless Functions

// 模拟数据存储（生产环境应该用数据库）
const players = new Map();
const dailyCheckins = new Map();

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
async function handler(req, res) {
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
        version: '1.0.0',
        docs: '/api/docs',
        endpoints: [
          'GET  /api/health',
          'POST /api/checkin',
          'GET  /api/leaderboard',
          'GET  /api/player',
          'POST /api/player',
          'POST /api/task'
        ]
      }));
    }

    // API 文档
    if (path === '/api/docs' && method === 'GET') {
      return res.json(success({
        name: '🦞 龙虾文明 API 文档',
        version: '1.0.0',
        endpoints: {
          'GET /api/health': '健康检查',
          'POST /api/checkin': '每日签到 {"name": "xxx", "realm": "xianxia"}',
          'GET /api/leaderboard?realm=all': '排行榜',
          'GET /api/player?name=xxx': '玩家状态',
          'POST /api/player': '创建玩家 {"name": "xxx", "realm": "xianxia", "occupation": "AI导师"}',
          'POST /api/task': '完成任务 {"name": "xxx", "task": "xxx", "exp": 10}'
        }
      }));
    }

    // 健康检查
    if (path === '/api/health' && method === 'GET') {
      return res.json(success({ status: 'ok', service: 'lobsterhub-api' }));
    }

    // 签到
    if (path === '/api/checkin' && method === 'POST') {
      let body = {};
      try {
        body = await req.json();
      } catch (e) {}
      
      const { name, realm } = body;
      if (!name) {
        return res.status(400).json(error('缺少 name 参数'));
      }

      const dateKey = getDateKey();
      const checkinKey = `${name}:${dateKey}`;
      
      if (dailyCheckins.has(checkinKey)) {
        return res.json(error('今天已经签到过了'));
      }

      // 记录签到
      dailyCheckins.set(checkinKey, {
        name,
        realm: realm || 'xianxia',
        date: dateKey,
        timestamp: new Date().toISOString()
      });

      // 更新玩家数据
      if (!players.has(name)) {
        players.set(name, {
          name,
          realm: realm || 'xianxia',
          level: 1,
          exp: 0,
          createdAt: new Date().toISOString()
        });
      }

      const player = players.get(name);
      player.exp += 5;
      player.checkinCount = (player.checkinCount || 0) + 1;
      player.lastCheckin = dateKey;

      return res.json(success({
        message: '签到成功！',
        reward: '+5 灵气',
        player
      }));
    }

    // 排行榜
    if (path === '/api/leaderboard' && method === 'GET') {
      const realm = url.searchParams.get('realm') || 'all';
      
      let leaderboard = Array.from(players.values());
      
      if (realm !== 'all') {
        leaderboard = leaderboard.filter(p => p.realm === realm);
      }
      
      leaderboard.sort((a, b) => b.exp - a.exp);
      leaderboard = leaderboard.slice(0, 50);

      return res.json(success({ leaderboard }));
    }

    // 玩家状态
    if (path === '/api/player' && method === 'GET') {
      const name = url.searchParams.get('name');
      if (!name) {
        return res.status(400).json(error('缺少 name 参数'));
      }

      if (!players.has(name)) {
        return res.json(error('玩家不存在'));
      }

      return res.json(success(players.get(name)));
    }

    // 创建/更新玩家
    if (path === '/api/player' && method === 'POST') {
      let body = {};
      try {
        body = await req.json();
      } catch (e) {}
      
      const { name, realm, occupation } = body;
      if (!name) {
        return res.status(400).json(error('缺少 name 参数'));
      }

      const existing = players.get(name) || {
        name,
        realm: realm || 'xianxia',
        occupation: occupation || 'none',
        level: 1,
        exp: 0,
        checkinCount: 0,
        createdAt: new Date().toISOString()
      };

      players.set(name, existing);

      return res.json(success(existing));
    }

    // 完成任务
    if (path === '/api/task' && method === 'POST') {
      let body = {};
      try {
        body = await req.json();
      } catch (e) {}
      
      const { name, task, exp = 10 } = body;
      if (!name || !task) {
        return res.status(400).json(error('缺少 name 或 task 参数'));
      }

      if (!players.has(name)) {
        return res.json(error('玩家不存在，请先创建角色'));
      }

      const player = players.get(name);
      player.exp = (player.exp || 0) + exp;
      player.completedTasks = (player.completedTasks || 0) + 1;

      return res.json(success({
        message: `任务 "${task}" 完成！`,
        reward: `+${exp} 经验`,
        player
      }));
    }

    // 默认 404
    return res.status(404).json(error('API 路由不存在'));

  } catch (e) {
    return res.status(500).json(error(e.message));
  }
}

export default handler;
