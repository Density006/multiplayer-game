/** CONFIGURATION */
const APP_PREFIX = "sky-battle-v4-"; 
const ADMIN_PASSWORD = "8007"; 
const WORLD_SIZE = 3000; // Fixed world size for everyone
const MAX_SPEED = 12;
const MIN_SPEED = 3;

// -- GLOBALS --
let peer = null, conn = null, connections = [];
let isHost = false, myId = null, isAdmin = false;
let myName = "Pilot";

// Game State
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let players = {};
let projectiles = [];
let lasers = [];
let particles = [];
let stars = []; // Background stars

// Inputs
const keys = { w:false, a:false, s:false, d:false, Space:false, m:false, l:false };

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
        }
    } else {
        // CLIENT LOGIC
        if (data.type === 'update') {
            players = data.players;
            projectiles = data.projectiles;
            lasers = data.lasers;
            particles = data.particles;
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
        keys: { w:false, a:false, s:false, d:false, Space:false, m:false, l:false },
        hp: 100, maxHp: 100, dead: false,
        speed: 5, // Current speed
        throttle: 0.5, // 0 to 1
        
        // Cooldowns
        bulletCD: 0,
        missileCD: 0,
        laserCD: 0,

        // Cheats
        godMode: false, rapidFire: false, hasLaser: false, superSpeed: false
    };
}

function gameLoopHost() {
    // 1. Process Players
    for (let id in players) {
        const p = players[id];
        if (p.dead) {
            if (Math.random() < 0.005) { 
                p.dead = false; p.hp = 100; 
                p.x = Math.random()*WORLD_SIZE; p.y = Math.random()*WORLD_SIZE; 
            }
            continue;
        }

        const input = (id === myId) ? keys : p.keys;

        // Steering
        if (input.a) p.angle -= 0.08;
        if (input.d) p.angle += 0.08;

        // Throttle System
        if (input.w && p.throttle < 1.0) p.throttle += 0.01;
        if (input.s && p.throttle > 0.2) p.throttle -= 0.02; // Brake

        // Calculate Speed
        let maxS = p.superSpeed ? 20 : MAX_SPEED;
        p.speed = p.throttle * maxS;

        // Movement
        p.x += Math.cos(p.angle) * p.speed;
        p.y += Math.sin(p.angle) * p.speed;

        // Boundary Clamp (Prevents hiding off screen)
        if(p.x < 0) p.x = 0;
        if(p.x > WORLD_SIZE) p.x = WORLD_SIZE;
        if(p.y < 0) p.y = 0;
        if(p.y > WORLD_SIZE) p.y = WORLD_SIZE;

        // ACTIONS (Check inputs every frame for rapid fire support)
        if (input.Space) fireBullet(p);
        if (input.m) fireMissile(p);
        if ((input.l && p.hasLaser)) fireLaser(p);

        // Cooldown Decays
        if (p.bulletCD > 0) p.bulletCD--;
        if (p.missileCD > 0) p.missileCD--;
        if (p.laserCD > 0) p.laserCD--;
    }

    // 2. Projectiles
    updateProjectiles();

    // 3. Particles
    updateParticles();

    // Sync
    const packet = { type: 'update', players, projectiles, lasers, particles };
    connections.forEach(c => c.send(packet));
    drawGame();
    updateHUD();
    requestAnimationFrame(gameLoopHost);
}

function fireBullet(p) {
    if (p.bulletCD > 0) return;
    projectiles.push({ x: p.x, y: p.y, angle: p.angle, speed: p.speed + 10, type: 'bullet', owner: p.id, life: 60 });
    p.bulletCD = p.rapidFire ? 4 : 12;
}

function fireMissile(p) {
    if (p.missileCD > 0) return;
    // Find Target
    let targetId = null, minDist = Infinity;
    for(let pid in players) {
        if(pid !== p.id && !players[pid].dead) {
            const d = Math.hypot(players[pid].x - p.x, players[pid].y - p.y);
            if(d < minDist) { minDist = d; targetId = pid; }
        }
    }
    projectiles.push({ x: p.x, y: p.y, angle: p.angle, speed: p.speed + 4, type: 'missile', owner: p.id, target: targetId, life: 250 });
    p.missileCD = p.rapidFire ? 15 : 120;
}

function fireLaser(p) {
    if (p.laserCD > 0) return;
    lasers.push({ x: p.x, y: p.y, angle: p.angle, owner: p.id, life: 10 }); // Laser lasts 10 frames
    p.laserCD = p.rapidFire ? 10 : 100; // Cooldown applied AFTER firing
}

function updateProjectiles() {
    // Projectiles
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const proj = projectiles[i];
        
        if (proj.type === 'missile' && proj.target && players[proj.target] && !players[proj.target].dead) {
            const t = players[proj.target];
            const desired = Math.atan2(t.y - proj.y, t.x - proj.x);
            let diff = desired - proj.angle;
            while (diff <= -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            proj.angle += Math.sign(diff) * 0.08;
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
                    takeDamage(p, proj.type === 'missile' ? 40 : 10);
                    hit = true;
                    createExplosion(proj.x, proj.y, 'orange');
                    break;
                }
            }
        }
        if (hit || proj.life <= 0) projectiles.splice(i, 1);
    }

    // Lasers (Raycast Logic)
    for (let i = lasers.length - 1; i >= 0; i--) {
        const l = lasers[i];
        l.life--;
        // Move source with player if alive
        if (players[l.owner]) { l.x = players[l.owner].x; l.y = players[l.owner].y; l.angle = players[l.owner].angle; }

        for (let pid in players) {
            const p = players[pid];
            if (p.id !== l.owner && !p.dead && !p.godMode) {
                const dx = p.x - l.x, dy = p.y - l.y;
                const dist = Math.abs(dy * Math.cos(l.angle) - dx * Math.sin(l.angle));
                const dot = dx * Math.cos(l.angle) + dy * Math.sin(l.angle);
                if (dist < 20 && dot > 0 && dot < 2000) {
                    takeDamage(p, 5);
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

function takeDamage(p, amt) {
    p.hp -= amt;
    if (p.hp <= 0) {
        p.dead = true; p.hp = 0;
        createExplosion(p.x, p.y, 'white', 50);
        notify(p.name + " WAS DESTROYED!");
    }
}

function createExplosion(x, y, color, count=10) {
    for(let i=0; i<count; i++) {
        particles.push({
            x, y, vx: (Math.random()-0.5)*15, vy: (Math.random()-0.5)*15,
            life: Math.random()*20+10, color
        });
    }
}

// --- RENDER CAMERA ---
function drawGame() {
    if (!players[myId]) return;
    const me = players[myId];

    // Camera transform: Center the 'me' player
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Save context for camera offset
    ctx.save();
    const cx = canvas.width / 2 - me.x;
    const cy = canvas.height / 2 - me.y;
    ctx.translate(cx, cy);

    // Draw Boundary
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);

    // Draw Background Stars
    ctx.fillStyle = '#fff';
    stars.forEach(s => {
        ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI*2); ctx.fill();
    });

    // Draw Lasers
    lasers.forEach(l => {
        ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.angle);
        ctx.strokeStyle = '#0ff'; ctx.lineWidth = 6; ctx.shadowBlur = 20; ctx.shadowColor = '#0ff';
        ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(2000,0); ctx.stroke(); ctx.restore();
    });

    // Draw Projectiles
    projectiles.forEach(p => {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
        if (p.type === 'bullet') { ctx.fillStyle = 'yellow'; ctx.fillRect(-4, -2, 8, 4); }
        else { ctx.fillStyle = 'red'; ctx.fillRect(-6, -3, 12, 6); }
        ctx.restore();
    });

    // Draw Players
    for (let id in players) {
        const p = players[id];
        if (p.dead) continue;
        
        ctx.save(); 
        ctx.translate(p.x, p.y); 
        
        // Name Tag
        ctx.fillStyle = 'white'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center';
        ctx.fillText(p.name, 0, -35);

        // HP Bar
        ctx.fillStyle = 'red'; ctx.fillRect(-20, -30, 40, 4);
        ctx.fillStyle = '#0f0'; ctx.fillRect(-20, -30, 40 * (p.hp/p.maxHp), 4);

        // Plane Rotation
        ctx.rotate(p.angle);
        
        // Body
        ctx.fillStyle = p.godMode ? 'gold' : p.color;
        ctx.beginPath(); ctx.moveTo(20,0); ctx.lineTo(-15,15); ctx.lineTo(-5,0); ctx.lineTo(-15,-15); ctx.fill();
        
        // Thruster
        if (p.throttle > 0) {
            ctx.fillStyle = 'orange';
            ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(-25 - (p.throttle*10), 0); ctx.lineTo(-15, 5); ctx.fill();
        }

        if (p.hasLaser || p.godMode) { ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke(); }
        ctx.restore();
    }

    // Particles
    particles.forEach(pt => {
        ctx.fillStyle = pt.color; ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI*2); ctx.fill();
    });

    ctx.restore();
}

function updateHUD() {
    if (players[myId]) {
        const p = players[myId];
        const pct = Math.max(0, (p.hp / p.maxHp) * 100);
        document.getElementById('healthBar').style.width = pct + '%';
        document.getElementById('speedGauge').innerText = `THRUST: ${Math.round(p.throttle * 100)}%`;
        if (p.dead) notify("WASTED - Respawning...");
    }
}

// --- INPUTS (Multi-Key Support) ---
window.addEventListener('keydown', e => {
    // Prevent scrolling for game keys
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
    
    if (e.key === 'w' || e.key === 'ArrowUp') keys.w = true;
    if (e.key === 's' || e.key === 'ArrowDown') keys.s = true;
    if (e.key === 'a' || e.key === 'ArrowLeft') keys.a = true;
    if (e.key === 'd' || e.key === 'ArrowRight') keys.d = true;
    if (e.key === ' ') keys.Space = true;
    if (e.key === 'm' || e.key === 'M') keys.m = true;
    if ((e.key === 'l' || e.key === 'L') && isAdmin) keys.l = true;
});

window.addEventListener('keyup', e => {
    if (e.key === 'w' || e.key === 'ArrowUp') keys.w = false;
    if (e.key === 's' || e.key === 'ArrowDown') keys.s = false;
    if (e.key === 'a' || e.key === 'ArrowLeft') keys.a = false;
    if (e.key === 'd' || e.key === 'ArrowRight') keys.d = false;
    if (e.key === ' ') keys.Space = false;
    if (e.key === 'm' || e.key === 'M') keys.m = false;
    if (e.key === 'l' || e.key === 'L') keys.l = false;
});

// Client Input Loop
setInterval(() => {
    if (!isHost && conn && conn.open) conn.send({ type: 'input', keys: keys });
}, 50);
