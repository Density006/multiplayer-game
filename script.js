/** CONFIGURATION */
const APP_PREFIX = "sky-battle-v3-"; 
const ADMIN_PASSWORD = "8007"; // Updated Password

// -- GLOBALS --
let peer = null, conn = null, connections = [];
let isHost = false, myId = null, isAdmin = false;

// Game State
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let players = {};
let projectiles = [];
let lasers = [];
let particles = [];
const keys = { w:false, a:false, d:false, Space:false };

// Resize
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

function startGameUI(code) {
    document.getElementById('menu').style.display = 'none';
    document.getElementById('connectionStatus').innerText = `ROOM: ${code}`;
}

// --- ADMIN LOGIC ---
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
    const btn = document.getElementById('btn' + cheat.charAt(0).toUpperCase() + cheat.slice(1));
    btn.classList.toggle('active');

    if (isHost) {
        const p = players[myId];
        if (cheat === 'god') p.godMode = !p.godMode;
        if (cheat === 'speed') p.speed = p.speed === 5 ? 12 : 5;
        if (cheat === 'rapid') p.rapidFire = !p.rapidFire;
        if (cheat === 'laser') p.hasLaser = !p.hasLaser;
    } else {
        conn.send({ type: 'cheat_toggle', cheat: cheat });
    }
}

// --- NETWORKING ---
function hostGame() {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    setStatus("Starting Server...");
    
    peer = new Peer(APP_PREFIX + code);

    peer.on('open', (id) => {
        myId = id;
        isHost = true;
        startGameUI(code);
        players[myId] = createPlayer(myId, true);
        requestAnimationFrame(gameLoopHost);
    });

    peer.on('connection', (c) => {
        connections.push(c);
        players[c.peer] = createPlayer(c.peer, false);
        c.on('data', (data) => handlePacket(data, c.peer));
        c.on('close', () => { 
            delete players[c.peer]; 
            connections = connections.filter(x => x.peer !== c.peer); 
        });
    });
    
    peer.on('error', err => alert("Network Error: " + err.type));
}

function joinGame() {
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
        });

        conn.on('data', (data) => handlePacket(data));
        conn.on('close', () => { alert("Host Disconnected"); location.reload(); });
    });
    
    peer.on('error', err => {
         if (err.type === 'peer-unavailable') alert("Game ID not found!");
         else alert("Error: " + err.type);
    });
}

function handlePacket(data, senderId) {
    // HOST LOGIC
    if (isHost) {
        const p = players[senderId];
        if (!p) return;

        if (data.type === 'input') p.keys = data.keys;
        if (data.type === 'action') performAction(p, data.action);
        if (data.type === 'admin_req') {
            if (data.pass === ADMIN_PASSWORD) {
                const c = connections.find(x => x.peer === senderId);
                if(c) c.send({ type: 'admin_granted' });
            }
        }
        if (data.type === 'cheat_toggle') {
            if (data.cheat === 'god') p.godMode = !p.godMode;
            if (data.cheat === 'speed') p.speed = p.speed === 5 ? 12 : 5;
            if (data.cheat === 'rapid') p.rapidFire = !p.rapidFire;
            if (data.cheat === 'laser') p.hasLaser = !p.hasLaser;
        }
    } 
    // CLIENT LOGIC
    else {
        if (data.type === 'update') {
            players = data.players;
            projectiles = data.projectiles;
            lasers = data.lasers;
            particles = data.particles;
            drawGame();
            updateHealthUI();
        }
        if (data.type === 'admin_granted') {
            activateAdminUI();
        }
    }
}

// --- GAME ENGINE ---
function createPlayer(id, isHost) {
    return {
        id: id,
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        angle: Math.random() * 6.28,
        color: `hsl(${Math.random() * 360}, 100%, 50%)`,
        keys: { w:false, a:false, d:false },
        hp: 100, maxHp: 100, dead: false,
        godMode: false, rapidFire: false, hasLaser: false, speed: 5, cooldown: 0
    };
}

function performAction(p, action) {
    if (p.dead) return;

    if (action === 'shoot') {
        if (p.cooldown <= 0) {
            projectiles.push({ x: p.x, y: p.y, angle: p.angle, speed: 12, type: 'bullet', owner: p.id, life: 60 });
            p.cooldown = p.rapidFire ? 4 : 15;
        }
    }
    if (action === 'missile' && p.cooldown <= 0) {
        // Find nearest enemy
        let targetId = null, minDist = Infinity;
        for(let pid in players) {
            if(pid !== p.id && !players[pid].dead) {
                const d = Math.hypot(players[pid].x - p.x, players[pid].y - p.y);
                if(d < minDist) { minDist = d; targetId = pid; }
            }
        }
        projectiles.push({ x: p.x, y: p.y, angle: p.angle, speed: 5, type: 'missile', owner: p.id, target: targetId, life: 250 });
        p.cooldown = p.rapidFire ? 10 : 100;
    }
    if (action === 'laser' && p.hasLaser) {
        lasers.push({ x: p.x, y: p.y, angle: p.angle, owner: p.id, life: 10 });
    }
}

function gameLoopHost() {
    // 1. Move Players
    for (let id in players) {
        const p = players[id];
        if (p.dead) {
            if (Math.random() < 0.005) { p.dead = false; p.hp = 100; p.x = Math.random()*canvas.width; p.y = Math.random()*canvas.height; }
            continue;
        }

        const input = (id === myId) ? keys : p.keys;
        if (input.a) p.angle -= 0.08;
        if (input.d) p.angle += 0.08;
        if (input.w) {
            p.x += Math.cos(p.angle) * p.speed;
            p.y += Math.sin(p.angle) * p.speed;
        }
        if (p.cooldown > 0) p.cooldown--;
        
        // Wrap
        if(p.x < 0) p.x = canvas.width; else if(p.x > canvas.width) p.x = 0;
        if(p.y < 0) p.y = canvas.height; else if(p.y > canvas.height) p.y = 0;
    }

    // 2. Projectiles
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const proj = projectiles[i];
        
        if (proj.type === 'missile' && proj.target && players[proj.target] && !players[proj.target].dead) {
            const t = players[proj.target];
            const desired = Math.atan2(t.y - proj.y, t.x - proj.x);
            let diff = desired - proj.angle;
            while (diff <= -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            proj.angle += Math.sign(diff) * 0.06;
        }

        proj.x += Math.cos(proj.angle) * proj.speed;
        proj.y += Math.sin(proj.angle) * proj.speed;
        proj.life--;

        // Collisions
        let hit = false;
        for (let pid in players) {
            const p = players[pid];
            if (p.id !== proj.owner && !p.dead && !p.godMode) {
                if (Math.hypot(p.x - proj.x, p.y - proj.y) < 20) {
                    takeDamage(p, proj.type === 'missile' ? 40 : 10);
                    hit = true;
                    createExplosion(proj.x, proj.y, 'orange');
                    break;
                }
            }
        }
        if (hit || proj.life <= 0) projectiles.splice(i, 1);
    }

    // 3. Lasers
    for (let i = lasers.length - 1; i >= 0; i--) {
        const l = lasers[i];
        l.life--;
        for (let pid in players) {
            const p = players[pid];
            if (p.id !== l.owner && !p.dead && !p.godMode) {
                const dx = p.x - l.x, dy = p.y - l.y;
                const dist = Math.abs(dy * Math.cos(l.angle) - dx * Math.sin(l.angle));
                const dot = dx * Math.cos(l.angle) + dy * Math.sin(l.angle);
                if (dist < 20 && dot > 0) {
                    takeDamage(p, 5);
                    createExplosion(p.x, p.y, 'cyan', 2);
                }
            }
        }
        if (l.life <= 0) lasers.splice(i, 1);
    }

    // 4. Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        pt.x += pt.vx; pt.y += pt.vy; pt.life--;
        if (pt.life <= 0) particles.splice(i, 1);
    }

    // Sync
    const packet = { type: 'update', players, projectiles, lasers, particles };
    connections.forEach(c => c.send(packet));
    drawGame();
    updateHealthUI();
    requestAnimationFrame(gameLoopHost);
}

function takeDamage(p, amt) {
    p.hp -= amt;
    if (p.hp <= 0) {
        p.dead = true; p.hp = 0;
        createExplosion(p.x, p.y, 'white', 50);
    }
}

function createExplosion(x, y, color, count=10) {
    for(let i=0; i<count; i++) {
        particles.push({
            x, y, vx: (Math.random()-0.5)*10, vy: (Math.random()-0.5)*10,
            life: 20, color
        });
    }
}

// --- RENDERING ---
function drawGame() {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    lasers.forEach(l => {
        ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.angle);
        ctx.strokeStyle = '#0ff'; ctx.lineWidth = 5; ctx.shadowBlur = 20; ctx.shadowColor = '#0ff';
        ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(2000,0); ctx.stroke(); ctx.restore();
    });

    projectiles.forEach(p => {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
        if (p.type === 'bullet') { ctx.fillStyle = 'yellow'; ctx.fillRect(-4, -2, 8, 4); }
        else { ctx.fillStyle = 'red'; ctx.fillRect(-6, -3, 12, 6); }
        ctx.restore();
    });

    for (let id in players) {
        const p = players[id];
        if (p.dead) continue;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
        ctx.fillStyle = p.godMode ? 'gold' : p.color;
        ctx.beginPath(); ctx.moveTo(15,0); ctx.lineTo(-10,10); ctx.lineTo(-5,0); ctx.lineTo(-10,-10); ctx.fill();
        if (p.hasLaser || p.godMode) { ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke(); }
        ctx.restore();
        
        ctx.fillStyle = 'white'; ctx.font = '12px Arial'; ctx.textAlign = 'center';
        ctx.fillText(p.id === myId ? "YOU" : "ENEMY", p.x, p.y - 20);
        ctx.fillStyle = 'red'; ctx.fillRect(p.x-15, p.y-35, 30, 4);
        ctx.fillStyle = '#0f0'; ctx.fillRect(p.x-15, p.y-35, 30 * (p.hp/p.maxHp), 4);
    }

    particles.forEach(pt => {
        ctx.fillStyle = pt.color; ctx.beginPath(); ctx.arc(pt.x, pt.y, 2, 0, Math.PI*2); ctx.fill();
    });
}

function updateHealthUI() {
    if (players[myId]) {
        const p = players[myId];
        const pct = Math.max(0, (p.hp / p.maxHp) * 100);
        document.getElementById('healthBar').style.width = pct + '%';
        if (p.dead) notify("WASTED - Respawning...");
    }
}

// --- INPUT HANDLERS ---
window.addEventListener('keydown', e => {
    if (e.key === 'w' || e.key === 'ArrowUp') keys.w = true;
    if (e.key === 'a' || e.key === 'ArrowLeft') keys.a = true;
    if (e.key === 'd' || e.key === 'ArrowRight') keys.d = true;
    
    let act = null;
    if (e.key === ' ') act = 'shoot';
    if (e.key === 'm') act = 'missile';
    if ((e.key === 'l' || e.key === 'L') && isAdmin) act = 'laser';

    if (act) {
        if (isHost) performAction(players[myId], act);
        else if (conn) conn.send({ type: 'action', action: act });
    }
});

window.addEventListener('keyup', e => {
    if (e.key === 'w' || e.key === 'ArrowUp') keys.w = false;
    if (e.key === 'a' || e.key === 'ArrowLeft') keys.a = false;
    if (e.key === 'd' || e.key === 'ArrowRight') keys.d = false;
});

setInterval(() => {
    if (!isHost && conn && conn.open) conn.send({ type: 'input', keys: keys });
}, 50);
