/** CONFIGURATION */
const APP_PREFIX = "sky-battle-v5-"; 
const ADMIN_PASSWORD = "8007"; 
const WORLD_SIZE = 3000; 
const MAX_SPEED = 12;
const MIN_SPEED = 3;

// -- GLOBALS --
let peer = null, conn = null, connections = [];
let isHost = false, myId = null, isAdmin = false;
let myName = "Pilot";
let feedMessages = [];

// Game State
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let players = {};
let projectiles = [];
let lasers = [];
let particles = [];
let stars = [];

// Inputs (Case insensitive mapping)
const keys = { w:false, a:false, s:false, d:false, Space:false, m:false, l:false, Shift:false };

// Init Background
for(let i=0; i<200; i++) {
    stars.push({
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
        size: Math.random() * 2 + 1
    });
}

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resize);
resize();

// --- UI FUNCTIONS ---
function toggleAdminPanel() {
    const panel = document.getElementById('adminPanel');
    panel.style.display = (panel.style.display === 'block') ? 'none' : 'block';
}

function setStatus(msg) { document.getElementById('statusMsg').innerText = msg; }
function notify(msg) { 
    const n = document.getElementById('notification'); n.innerText = msg; 
    setTimeout(() => n.innerText = '', 2000); 
}

function addKillFeed(msg) {
    const feed = document.getElementById('killFeed');
    const div = document.createElement('div');
    div.className = 'kill-msg';
    div.innerText = msg;
    feed.appendChild(div);
    setTimeout(() => { div.style.opacity = 0; setTimeout(()=>div.remove(), 1000); }, 4000);
}

function startGameUI(code) {
    document.getElementById('menu').style.display = 'none';
    document.getElementById('connectionStatus').innerText = `ROOM: ${code}`;
}

// --- ADMIN ---
function unlockAdmin() {
    const pass = document.getElementById('adminPass').value;
    if (isHost) {
        if (pass === ADMIN_PASSWORD) activateAdminUI();
        else notify("WRONG PIN");
    } else if (conn) {
        conn.send({ type: 'admin_req', pass: pass });
    }
}

function activateAdminUI() {
    isAdmin = true;
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('cheatSection').style.display = 'block';
    notify("ADMIN ACCESS GRANTED");
}

function toggleCheat(cheat) {
    if (!isAdmin) return;
    if (cheat === 'nuke') {
        // Nuke Logic
        if (isHost) performNuke(myId);
        else conn.send({ type: 'cheat_toggle', cheat: 'nuke' });
        return;
    }

    const btn = document.getElementById('btn' + cheat.charAt(0).toUpperCase() + cheat.slice(1));
    btn.classList.toggle('active');

    if (isHost) {
        const p = players[myId];
        if (cheat === 'god') p.godMode = !p.godMode;
        if (cheat === 'speed') p.superSpeed = !p.superSpeed;
        if (cheat === 'rapid') p.rapidFire = !p.rapidFire;
        if (cheat === 'laser') p.hasLaser = !p.hasLaser;
    } else {
        conn.send({ type: 'cheat_toggle', cheat: cheat });
    }
}

function performNuke(sourceId) {
    // Kill everyone except the source (Admin)
    for(let pid in players) {
        if (pid !== sourceId) {
            takeDamage(players[pid], 9999, players[sourceId].name);
        }
    }
    notify("☢️ TACTICAL NUKE DETONATED ☢️");
}

// --- NETWORKING ---
function getUsername() {
    const name = document.getElementById('username').value.trim();
    return name || "Pilot " + Math.floor(Math.random()*100);
}

function hostGame() {
    myName = getUsername();
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    setStatus("Initializing World...");
    
    peer = new Peer(APP_PREFIX + code);

    peer.on('open', (id) => {
        myId = id;
        isHost = true;
        startGameUI(code);
        players[myId] = createPlayer(myId, true, myName);
        requestAnimationFrame(gameLoopHost);
    });

    peer.on('connection', (c) => {
        connections.push(c);
        c.on('data', (data) => handlePacket(data, c.peer));
        c.on('close', () => { 
            delete players[c.peer]; 
            connections = connections.filter(x => x.peer !== c.peer); 
        });
    });
    
    peer.on('error', err => alert("Net Error: " + err.type));
}

function joinGame() {
    myName = getUsername();
    const code = document.getElementById('joinCode').value;
    if (code.length !== 4) return alert("Code must be 4 digits");
    
    setStatus("Connecting...");
    peer = new Peer(); 

    peer.on('open', (id) => {
        myId = id;
        const hostId = APP_PREFIX + code;
        conn = peer.connect(hostId);

        conn.on('open', () => {
            isHost = false;
            startGameUI(code);
            conn.send({ type: 'join', name: myName });
        });

        conn.on('data', (data) => handlePacket(data));
        conn.on('close', () => { alert("Host Ended Session"); location.reload(); });
    });
    
    peer.on('error', err => {
         if (err.type === 'peer-unavailable') alert("Game ID not found!");
         else alert("Error: " + err.type);
    });
}

function handlePacket(data, senderId) {
    if (isHost) {
        // HOST LOGIC
        if (data.type === 'join') {
            players[senderId] = createPlayer(senderId, false, data.name || "Unknown");
            addKillFeed(`${data.name} joined the airspace`);
        }
        const p = players[senderId];
        if (!p) return;

        if (data.type === 'input') p.keys = data.keys;
        if (data.type === 'admin_req') {
            if (data.pass === ADMIN_PASSWORD) {
                const c = connections.find(x => x.peer === senderId);
                if(c) c.send({ type: 'admin_granted' });
            }
        }
        if (data.type === 'cheat_toggle') {
            if (data.cheat === 'god') p.godMode = !p.godMode;
            if (data.cheat === 'speed') p.superSpeed = !p.superSpeed;
            if (data.cheat === 'rapid') p.rapidFire = !p.rapidFire;
            if (data.cheat === 'laser') p.hasLaser = !p.hasLaser;
            if (data.cheat === 'nuke') performNuke(senderId);
        }
    } else {
        // CLIENT LOGIC
        if (data.type === 'update') {
            players = data.players;
            projectiles = data.projectiles;
            lasers = data.lasers;
            particles = data.particles;
            
            // Sync feed
            if (data.newKills) {
                data.newKills.forEach(msg => addKillFeed(msg));
            }
            
            drawGame();
            updateHUD();
        }
        if (data.type === 'admin_granted') activateAdminUI();
    }
}

// --- GAME ENGINE ---
function createPlayer(id, isHost, name) {
    return {
        id: id,
        name: name,
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
        angle: Math.random() * 6.28,
        color: `hsl(${Math.random() * 360}, 100%, 50%)`,
        keys: { w:false, a:false, s:false, d:false, Space:false, m:false, l:false, Shift:false },
        hp: 100, maxHp: 100, dead: false,
        speed: 5, throttle: 0.5,
        bulletCD: 0, missileCD: 0, laserCD: 0, boostFuel: 100,
        godMode: false, rapidFire: false, hasLaser: false, superSpeed: false
    };
}

function gameLoopHost() {
    let newKills = [];

    // 1. Process Players
    for (let id in players) {
        const p = players[id];
        if (p.dead) {
            if (Math.random() < 0.005) { 
                p.dead = false; p.hp = 100; p.boostFuel = 100;
                p.x = Math.random()*WORLD_SIZE; p.y = Math.random()*WORLD_SIZE; 
            }
            continue;
        }

        const input = (id === myId) ? keys : p.keys;

        // Steering (Adjusted for "Stickiness" bug by ensuring case insensitive keys)
        if (input.a) p.angle -= 0.08;
        if (input.d) p.angle += 0.08;

        // Throttle System
        if (input.w && p.throttle < 1.0) p.throttle += 0.01;
        if (input.s && p.throttle > 0.2) p.throttle -= 0.02;

        // Boost Logic
        let boostMult = 1;
        if (input.Shift && p.boostFuel > 0) {
            boostMult = 1.5;
            p.boostFuel -= 1;
        } else if (p.boostFuel < 100) {
            p.boostFuel += 0.2;
        }

        // Calculate Speed
        let baseMax = p.superSpeed ? 25 : MAX_SPEED;
        p.speed = p.throttle * baseMax * boostMult;

        // Movement
        p.x += Math.cos(p.angle) * p.speed;
        p.y += Math.sin(p.angle) * p.speed;

        // Boundaries
        if(p.x < 0) p.x = 0; if(p.x > WORLD_SIZE) p.x = WORLD_SIZE;
        if(p.y < 0) p.y = 0; if(p.y > WORLD_SIZE) p.y = WORLD_SIZE;

        // Actions
        if (input.Space) fireBullet(p);
        if (input.m) fireMissile(p);
        if ((input.l && p.hasLaser)) fireLaser(p);

        if (p.bulletCD > 0) p.bulletCD--;
        if (p.missileCD > 0) p.missileCD--;
        if (p.laserCD > 0) p.laserCD--;
    }

    // 2. Projectiles & Physics
    updateProjectiles(newKills);
    updateParticles();

    // Sync
    const packet = { type: 'update', players, projectiles, lasers, particles, newKills };
    connections.forEach(c => c.send(packet));
    
    // Host local feed update
    newKills.forEach(msg => addKillFeed(msg));

    drawGame();
    updateHUD();
    requestAnimationFrame(gameLoopHost);
}

function fireBullet(p) {
    if (p.bulletCD > 0) return;
    projectiles.push({ x: p.x, y: p.y, angle: p.angle, speed: p.speed + 12, type: 'bullet', owner: p.id, life: 50 });
    p.bulletCD = p.rapidFire ? 4 : 10;
}

function fireMissile(p) {
    if (p.missileCD > 0) return;
    let targetId = null, minDist = Infinity;
    for(let pid in players) {
        if(pid !== p.id && !players[pid].dead) {
            const d = Math.hypot(players[pid].x - p.x, players[pid].y - p.y);
            if(d < minDist) { minDist = d; targetId = pid; }
        }
    }
    projectiles.push({ x: p.x, y: p.y, angle: p.angle, speed: p.speed + 5, type: 'missile', owner: p.id, target: targetId, life: 200 });
    p.missileCD = p.rapidFire ? 15 : 100;
}

function fireLaser(p) {
    if (p.laserCD > 0) return;
    lasers.push({ x: p.x, y: p.y, angle: p.angle, owner: p.id, life: 10 }); 
    p.laserCD = p.rapidFire ? 10 : 80;
}

function updateProjectiles(killList) {
    // Projectiles
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const proj = projectiles[i];
        
        if (proj.type === 'missile' && proj.target && players[proj.target] && !players[proj.target].dead) {
            const t = players[proj.target];
            const desired = Math.atan2(t.y - proj.y, t.x - proj.x);
            let diff = desired - proj.angle;
            while (diff <= -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            proj.angle += Math.sign(diff) * 0.1;
        }

        proj.x += Math.cos(proj.angle) * proj.speed;
        proj.y += Math.sin(proj.angle) * proj.speed;
        proj.life--;

        // Collision
        let hit = false;
        if (proj.x < 0 || proj.x > WORLD_SIZE || proj.y < 0 || proj.y > WORLD_SIZE) hit = true;
        
        for (let pid in players) {
            const p = players[pid];
            if (p.id !== proj.owner && !p.dead && !p.godMode) {
                if (Math.hypot(p.x - proj.x, p.y - proj.y) < 25) {
                    let killerName = players[proj.owner] ? players[proj.owner].name : "Unknown";
                    if (takeDamage(p, proj.type === 'missile' ? 40 : 10, killerName, killList)) {
                        // Killed
                    }
                    hit = true;
                    createExplosion(proj.x, proj.y, 'orange');
                    break;
                }
            }
        }
        if (hit || proj.life <= 0) projectiles.splice(i, 1);
    }

    // Lasers
    for (let i = lasers.length - 1; i >= 0; i--) {
        const l = lasers[i];
        l.life--;
        if (players[l.owner]) { l.x = players[l.owner].x; l.y = players[l.owner].y; l.angle = players[l.owner].angle; }

        for (let pid in players) {
            const p = players[pid];
            if (p.id !== l.owner && !p.dead && !p.godMode) {
                const dx = p.x - l.x, dy = p.y - l.y;
                const dot = dx * Math.cos(l.angle) + dy * Math.sin(l.angle);
                const dist = Math.abs(dy * Math.cos(l.angle) - dx * Math.sin(l.angle));
                
                if (dist < 20 && dot > 0 && dot < 2000) {
                    let killerName = players[l.owner] ? players[l.owner].name : "Laser";
                    takeDamage(p, 5, killerName, killList);
                    createExplosion(p.x, p.y, 'cyan', 1);
                }
            }
        }
        if (l.life <= 0) lasers.splice(i, 1);
    }
}

function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        pt.x += pt.vx; pt.y += pt.vy; pt.life--;
        if (pt.life <= 0) particles.splice(i, 1);
    }
}

function takeDamage(p, amt, killerName, killList) {
    p.hp -= amt;
    if (p.hp <= 0 && !p.dead) {
        p.dead = true; p.hp = 0;
        createExplosion(p.x, p.y, 'white', 50);
        if (killList) killList.push(`${killerName} splashed ${p.name}`);
        return true;
    }
    return false;
}

function createExplosion(x, y, color, count=10) {
    for(let i=0; i<count; i++) {
        particles.push({
            x, y, vx: (Math.random()-0.5)*15, vy: (Math.random()-0.5)*15,
            life: Math.random()*20+10, color
        });
    }
}

// --- RENDER ---
function drawGame() {
    if (!players[myId]) return;
    const me = players[myId];

    // Camera Center
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    const cx = canvas.width / 2 - me.x;
    const cy = canvas.height / 2 - me.y;
    ctx.translate(cx, cy);

    // World Boundary
    ctx.strokeStyle = '#333'; ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);

    // Stars
    ctx.fillStyle = '#fff';
    stars.forEach(s => { ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI*2); ctx.fill(); });

    // Projectiles & Lasers
    lasers.forEach(l => {
        ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.angle);
        ctx.strokeStyle = '#0ff'; ctx.lineWidth = 6; ctx.shadowBlur = 10; ctx.shadowColor = '#0ff';
        ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(2000,0); ctx.stroke(); ctx.restore();
    });

    projectiles.forEach(p => {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
        if (p.type === 'bullet') { ctx.fillStyle = 'yellow'; ctx.fillRect(-4, -2, 8, 4); }
        else { ctx.fillStyle = 'red'; ctx.fillRect(-6, -3, 12, 6); }
        ctx.restore();
    });

    // Players
    for (let id in players) {
        const p = players[id];
        if (p.dead) continue;
        
        ctx.save(); ctx.translate(p.x, p.y); 
        
        // Stats
        ctx.fillStyle = 'white'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center';
        ctx.fillText(p.name, 0, -40);
        ctx.fillStyle = 'red'; ctx.fillRect(-20, -35, 40, 4);
        ctx.fillStyle = '#0f0'; ctx.fillRect(-20, -35, 40 * (p.hp/p.maxHp), 4);
        // Boost Bar
        ctx.fillStyle = '#0ff'; ctx.fillRect(-20, -30, 40 * (p.boostFuel/100), 2);

        ctx.rotate(p.angle);
        ctx.fillStyle = p.godMode ? 'gold' : p.color;
        ctx.beginPath(); ctx.moveTo(20,0); ctx.lineTo(-15,15); ctx.lineTo(-5,0); ctx.lineTo(-15,-15); ctx.fill();
        
        if (p.throttle > 0) {
            ctx.fillStyle = inputActive(p, 'Shift') ? '#0ff' : 'orange';
            ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(-25 - (p.throttle*10), 0); ctx.lineTo(-15, 5); ctx.fill();
        }
        if (p.hasLaser || p.godMode) { ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke(); }
        ctx.restore();
    }

    particles.forEach(pt => { ctx.fillStyle = pt.color; ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI*2); ctx.fill(); });

    ctx.restore();

    // --- MINIMAP (Admin Only) ---
    if (isAdmin) drawMinimap(me);
}

function inputActive(p, k) {
    if (p.id === myId) return keys[k];
    return p.keys[k];
}

function drawMinimap(me) {
    const mapSize = 150;
    const padding = 10;
    const startX = canvas.width - mapSize - padding;
    const startY = canvas.height - mapSize - padding;

    // Background
    ctx.fillStyle = 'rgba(0, 20, 0, 0.8)';
    ctx.fillRect(startX, startY, mapSize, mapSize);
    ctx.strokeStyle = '#0f0'; ctx.lineWidth = 2;
    ctx.strokeRect(startX, startY, mapSize, mapSize);

    // Players
    for (let id in players) {
        const p = players[id];
        if (p.dead) continue;
        
        const mapX = startX + (p.x / WORLD_SIZE) * mapSize;
        const mapY = startY + (p.y / WORLD_SIZE) * mapSize;

        ctx.fillStyle = (id === myId) ? '#fff' : 'red';
        ctx.beginPath(); ctx.arc(mapX, mapY, 3, 0, Math.PI*2); ctx.fill();
    }
}

function updateHUD() {
    if (players[myId]) {
        const p = players[myId];
        const pct = Math.max(0, (p.hp / p.maxHp) * 100);
        document.getElementById('healthBar').style.width = pct + '%';
        document.getElementById('speedGauge').innerText = `THRUST: ${Math.round(p.throttle * 100)}% | BOOST: ${Math.round(p.boostFuel)}%`;
        if (p.dead) notify("WASTED - Respawning...");
    }
}

// --- INPUTS ---
// Fix: Use e.key.toLowerCase() to prevent Stuck Keys / Caps Lock issues
window.addEventListener('keydown', e => {
    if (document.activeElement.tagName === 'INPUT') return; // Don't move if typing in box
    
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
    
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') keys.w = true;
    if (k === 's' || e.key === 'ArrowDown') keys.s = true;
    if (k === 'a' || e.key === 'ArrowLeft') keys.a = true;
    if (k === 'd' || e.key === 'ArrowRight') keys.d = true;
    if (k === ' ') keys.Space = true;
    if (k === 'm') keys.m = true;
    if (k === 'l' && isAdmin) keys.l = true;
    if (e.key === 'Shift') keys.Shift = true;
});

window.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') keys.w = false;
    if (k === 's' || e.key === 'ArrowDown') keys.s = false;
    if (k === 'a' || e.key === 'ArrowLeft') keys.a = false;
    if (k === 'd' || e.key === 'ArrowRight') keys.d = false;
    if (k === ' ') keys.Space = false;
    if (k === 'm') keys.m = false;
    if (k === 'l') keys.l = false;
    if (e.key === 'Shift') keys.Shift = false;
});

setInterval(() => {
    if (!isHost && conn && conn.open) conn.send({ type: 'input', keys: keys });
}, 50);
