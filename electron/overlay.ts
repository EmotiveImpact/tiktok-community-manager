import http from 'node:http';
import type { NormalizedEvent, RoomInfo } from './tiktok';

let server: http.Server | null = null;
let clients: http.ServerResponse[] = [];
let latestRoom: RoomInfo | null = null;
let stats = { totalLikes: 0, totalDiamonds: 0, viewerCount: 0, giftCount: 0, followCount: 0, commentCount: 0 };

export function pushEvent(evt: NormalizedEvent) {
  if (evt.type === 'roomInfo') latestRoom = evt.info;
  if (evt.type === 'like') stats.totalLikes += evt.likeCount || 1;
  if (evt.type === 'gift') {
    stats.giftCount++;
    stats.totalDiamonds += (evt.diamondCount || 0) * (evt.repeatCount || 1);
  }
  if (evt.type === 'roomUser') stats.viewerCount = evt.viewerCount;
  if (evt.type === 'follow') stats.followCount++;
  if (evt.type === 'chat') stats.commentCount++;

  const data = JSON.stringify(evt);
  for (const res of clients) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch { /* client disconnected */ }
  }
}

export function resetStats() {
  stats = { totalLikes: 0, totalDiamonds: 0, viewerCount: 0, giftCount: 0, followCount: 0, commentCount: 0 };
  latestRoom = null;
}

const CHAT_PAGE = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:transparent; font-family:-apple-system,BlinkMacSystemFont,sans-serif; overflow:hidden; }
  #feed { display:flex; flex-direction:column-reverse; height:100vh; padding:8px; gap:4px; }
  .msg { background:rgba(0,0,0,0.6); color:#fff; padding:6px 10px; border-radius:8px; font-size:14px;
         animation:slideIn .3s ease; max-width:100%; }
  .msg .name { color:#f472b6; font-weight:600; margin-right:6px; }
  @keyframes slideIn { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
</style></head><body>
<div id="feed"></div>
<script>
const feed = document.getElementById('feed');
const MAX = 15;
const es = new EventSource('/events');
es.onmessage = (e) => {
  const evt = JSON.parse(e.data);
  if (evt.type !== 'chat') return;
  const div = document.createElement('div');
  div.className = 'msg';
  div.innerHTML = '<span class="name">' + esc(evt.user?.nickname||'') + '</span>' + esc(evt.comment||'');
  feed.prepend(div);
  while (feed.children.length > MAX) feed.removeChild(feed.lastChild);
};
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
</script></body></html>`;

const STATS_PAGE = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:transparent; font-family:-apple-system,BlinkMacSystemFont,sans-serif; color:#fff; }
  .bar { display:flex; gap:16px; padding:10px 16px; background:rgba(0,0,0,0.6); border-radius:12px; }
  .stat { text-align:center; }
  .stat .val { font-size:22px; font-weight:700; font-variant-numeric:tabular-nums; }
  .stat .lbl { font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:#a1a1aa; }
</style></head><body>
<div class="bar" id="bar">
  <div class="stat"><div class="val" id="viewers">0</div><div class="lbl">Viewers</div></div>
  <div class="stat"><div class="val" id="likes">0</div><div class="lbl">Likes</div></div>
  <div class="stat"><div class="val" id="diamonds">0</div><div class="lbl">Diamonds</div></div>
  <div class="stat"><div class="val" id="gifts">0</div><div class="lbl">Gifts</div></div>
  <div class="stat"><div class="val" id="follows">0</div><div class="lbl">Follows</div></div>
</div>
<script>
const fmt = (n) => n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n);
const es = new EventSource('/events');
const s = {viewers:0,likes:0,diamonds:0,gifts:0,follows:0};
es.onmessage = (e) => {
  const evt = JSON.parse(e.data);
  if(evt.type==='roomUser') s.viewers=evt.viewerCount;
  if(evt.type==='like') s.likes+=evt.likeCount||1;
  if(evt.type==='gift'){s.gifts++;s.diamonds+=(evt.diamondCount||0)*(evt.repeatCount||1);}
  if(evt.type==='follow') s.follows++;
  document.getElementById('viewers').textContent=fmt(s.viewers);
  document.getElementById('likes').textContent=fmt(s.likes);
  document.getElementById('diamonds').textContent=fmt(s.diamonds);
  document.getElementById('gifts').textContent=fmt(s.gifts);
  document.getElementById('follows').textContent=fmt(s.follows);
};
</script></body></html>`;

const GIFTS_PAGE = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:transparent; font-family:-apple-system,BlinkMacSystemFont,sans-serif; overflow:hidden; }
  #feed { display:flex; flex-direction:column-reverse; height:100vh; padding:8px; gap:6px; }
  .gift { background:rgba(0,0,0,0.65); color:#fff; padding:8px 12px; border-radius:10px; font-size:14px;
          animation:pop .4s ease; display:flex; align-items:center; gap:8px; }
  .gift .name { color:#fbbf24; font-weight:600; }
  .gift .info { color:#d4d4d8; }
  .gift .diamonds { color:#a78bfa; font-weight:600; margin-left:auto; }
  @keyframes pop { from{opacity:0;transform:scale(0.8)} to{opacity:1;transform:scale(1)} }
</style></head><body>
<div id="feed"></div>
<script>
const feed = document.getElementById('feed');
const MAX = 10;
const es = new EventSource('/events');
es.onmessage = (e) => {
  const evt = JSON.parse(e.data);
  if (evt.type !== 'gift') return;
  const total = (evt.diamondCount||0)*(evt.repeatCount||1);
  const div = document.createElement('div');
  div.className = 'gift';
  div.innerHTML = '<span class="name">'+esc(evt.user?.nickname||'')+'</span>'
    +'<span class="info">'+esc(evt.giftName||'')+(evt.repeatCount>1?' x'+evt.repeatCount:'')+'</span>'
    +'<span class="diamonds">'+total+' diamonds</span>';
  feed.prepend(div);
  while(feed.children.length > MAX) feed.removeChild(feed.lastChild);
};
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
</script></body></html>`;

const FOLLOWER_PAGE = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:transparent;font-family:-apple-system,BlinkMacSystemFont,sans-serif;overflow:hidden}
  #banner{position:fixed;bottom:24px;left:24px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;padding:14px 20px;border-radius:14px;box-shadow:0 8px 32px rgba(59,130,246,0.4);transform:translateX(-120%);transition:transform .4s cubic-bezier(0.34,1.56,0.64,1);min-width:280px}
  #banner.show{transform:translateX(0)}
  #banner .lbl{font-size:11px;text-transform:uppercase;letter-spacing:1.5px;opacity:.8;margin-bottom:2px}
  #banner .name{font-size:18px;font-weight:700}
</style></head><body>
<div id="banner"><div class="lbl">✨ New Follower</div><div class="name" id="name">—</div></div>
<script>
const banner=document.getElementById('banner');const nm=document.getElementById('name');let timer=null;
const es=new EventSource('/events');
es.onmessage=(e)=>{const evt=JSON.parse(e.data);if(evt.type!=='follow')return;nm.textContent=evt.user?.nickname||'someone';banner.classList.add('show');clearTimeout(timer);timer=setTimeout(()=>banner.classList.remove('show'),5000);};
</script></body></html>`;

const TOP_GIFTERS_PAGE = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:transparent;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#fff;overflow:hidden}
  #card{background:linear-gradient(135deg,rgba(0,0,0,0.75),rgba(0,0,0,0.55));backdrop-filter:blur(8px);border-radius:14px;padding:14px 18px;width:300px}
  .title{font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#fbbf24;font-weight:700;margin-bottom:10px}
  .row{display:flex;align-items:center;gap:10px;padding:6px 0;font-size:14px}
  .rank{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0}
  .rank.r1{background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#451a03}
  .rank.r2{background:linear-gradient(135deg,#d4d4d8,#a1a1aa);color:#27272a}
  .rank.r3{background:linear-gradient(135deg,#fb923c,#ea580c);color:#431407}
  .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
  .amt{color:#fbbf24;font-weight:700;font-variant-numeric:tabular-nums}
</style></head><body>
<div id="card"><div class="title">💎 Top Gifters</div><div id="list"></div></div>
<script>
const list=document.getElementById('list');const tallies=new Map();
const fmt=(n)=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n);
function render(){const top=[...tallies.values()].sort((a,b)=>b.amt-a.amt).slice(0,5);list.innerHTML=top.map((t,i)=>'<div class="row"><div class="rank '+(i<3?'r'+(i+1):'')+'">'+(i+1)+'</div><div class="name">'+esc(t.name)+'</div><div class="amt">'+fmt(t.amt)+'</div></div>').join('')||'<div style="font-size:11px;color:#a1a1aa;padding:8px 0">Waiting for gifts…</div>';}
const es=new EventSource('/events');
es.onmessage=(e)=>{const evt=JSON.parse(e.data);if(evt.type!=='gift')return;const id=evt.user?.uniqueId||evt.user?.nickname;if(!id)return;const cur=tallies.get(id)||{name:evt.user?.nickname||id,amt:0};cur.amt+=(evt.diamondCount||0)*(evt.repeatCount||1);tallies.set(id,cur);render();};
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
render();
</script></body></html>`;

const GOAL_PAGE = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:transparent;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#fff;padding:8px}
  #card{background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);border-radius:12px;padding:14px 18px;width:380px}
  .head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
  .lbl{font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#fbbf24;font-weight:700}
  .progress{font-size:13px;font-variant-numeric:tabular-nums;color:#d4d4d8}
  .bar{height:10px;background:rgba(255,255,255,0.1);border-radius:5px;overflow:hidden}
  .fill{height:100%;background:linear-gradient(90deg,#fbbf24,#ec4899);border-radius:5px;transition:width .4s ease;box-shadow:0 0 16px rgba(236,72,153,0.4)}
  .pct{text-align:right;font-size:11px;color:#a1a1aa;margin-top:4px}
</style></head><body>
<div id="card">
  <div class="head"><div class="lbl" id="lbl">💎 Diamond Goal</div><div class="progress"><span id="cur">0</span> / <span id="goal">10000</span></div></div>
  <div class="bar"><div class="fill" id="fill" style="width:0%"></div></div>
  <div class="pct" id="pct">0%</div>
</div>
<script>
const params=new URLSearchParams(location.search);
const goal=parseInt(params.get('goal')||'10000',10);
const metric=params.get('metric')||'diamonds';
const labels={diamonds:'💎 Diamond Goal',likes:'❤️ Like Goal',followers:'⭐ Follower Goal',gifts:'🎁 Gift Goal'};
document.getElementById('lbl').textContent=labels[metric]||'Goal';
document.getElementById('goal').textContent=goal.toLocaleString();
let cur=0;
const fmt=(n)=>n.toLocaleString();
function update(){document.getElementById('cur').textContent=fmt(cur);const pct=Math.min((cur/goal)*100,100);document.getElementById('fill').style.width=pct+'%';document.getElementById('pct').textContent=pct.toFixed(1)+'%';}
const es=new EventSource('/events');
es.onmessage=(e)=>{const evt=JSON.parse(e.data);if(metric==='diamonds'&&evt.type==='gift')cur+=(evt.diamondCount||0)*(evt.repeatCount||1);else if(metric==='likes'&&evt.type==='like')cur+=evt.likeCount||1;else if(metric==='followers'&&evt.type==='follow')cur++;else if(metric==='gifts'&&evt.type==='gift')cur++;update();};
update();
</script></body></html>`;

const INDEX_PAGE = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body{background:#09090b;color:#e4e4e7;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:40px;max-width:600px;margin:0 auto}
  h1{font-size:20px;margin-bottom:16px;color:#f472b6}
  a{color:#60a5fa;text-decoration:none}a:hover{text-decoration:underline}
  .overlay{background:#18181b;border:1px solid #27272a;border-radius:8px;padding:16px;margin-bottom:12px}
  .overlay h3{font-size:14px;margin-bottom:4px} .overlay p{font-size:12px;color:#a1a1aa}
  code{background:#27272a;padding:2px 6px;border-radius:4px;font-size:12px}
</style></head><body>
<h1>LikeTapper OBS Overlays</h1>
<p style="margin-bottom:20px;color:#a1a1aa">Add these as Browser Sources in OBS. Set background to transparent.</p>
<div class="overlay"><h3><a href="/chat">Chat Overlay</a></h3><p>Live comment feed. Recommended size: <code>400x600</code></p></div>
<div class="overlay"><h3><a href="/stats">Stats Bar</a></h3><p>Viewers, likes, diamonds, gifts, follows. Recommended size: <code>500x60</code></p></div>
<div class="overlay"><h3><a href="/gifts">Gift Feed</a></h3><p>Gift notifications. Recommended size: <code>400x400</code></p></div>
<div class="overlay"><h3><a href="/follower">Latest Follower Banner</a></h3><p>Animated banner when someone follows. Recommended size: <code>360x80</code></p></div>
<div class="overlay"><h3><a href="/gifters">Top Gifters</a></h3><p>Live ranking of top diamond contributors. Recommended size: <code>320x260</code></p></div>
<div class="overlay"><h3><a href="/goal?metric=diamonds&goal=10000">Goal Bar</a></h3><p>Progress bar with custom goal. Use <code>?metric=diamonds|likes|followers|gifts&goal=NUMBER</code>. Recommended size: <code>400x90</code></p></div>
</body></html>`;

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = req.url ?? '/';

  if (url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    clients.push(res);
    req.on('close', () => {
      clients = clients.filter((c) => c !== res);
    });
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const path = url.split('?')[0];
  switch (path) {
    case '/chat':
      res.end(CHAT_PAGE);
      break;
    case '/stats':
      res.end(STATS_PAGE);
      break;
    case '/gifts':
      res.end(GIFTS_PAGE);
      break;
    case '/follower':
      res.end(FOLLOWER_PAGE);
      break;
    case '/gifters':
      res.end(TOP_GIFTERS_PAGE);
      break;
    case '/goal':
      res.end(GOAL_PAGE);
      break;
    default:
      res.end(INDEX_PAGE);
      break;
  }
}

export function startOverlayServer(port = 18910): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(port);
      return;
    }
    server = http.createServer(handleRequest);
    server.listen(port, '127.0.0.1', () => {
      console.log(`[overlay] OBS overlay server running on http://127.0.0.1:${port}`);
      resolve(port);
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        server = null;
        startOverlayServer(port + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

export function stopOverlayServer() {
  if (server) {
    for (const c of clients) {
      try { c.end(); } catch {}
    }
    clients = [];
    server.close();
    server = null;
  }
}

export function getOverlayPort(): number | null {
  if (!server) return null;
  const addr = server.address();
  if (typeof addr === 'object' && addr) return addr.port;
  return null;
}
