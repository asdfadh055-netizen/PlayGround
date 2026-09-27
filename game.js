import * as THREE from './vendor/three.module.js';

/* ============================================================
   NINJA vs SPIDER HERO — Rooftop Clash 3D (desktop)
   Procedural Three.js arena fighter, no external assets.
   ============================================================ */

const canvas = document.getElementById('scene');
const loadingEl = document.getElementById('loading');
const menuEl = document.getElementById('menu');
const overEl = document.getElementById('gameover');
const btnStart = document.getElementById('btn-start');
const btnRematch = document.getElementById('btn-rematch');
const announceEl = document.getElementById('announce');
const announceBig = document.getElementById('announce-big');
const announceSub = document.getElementById('announce-sub');
const comboEl = document.getElementById('combo');
const comboCount = document.getElementById('combo-count');
const vignette = document.getElementById('vignette');
const webbedEl = document.getElementById('webbed');
const dmgLayer = document.getElementById('dmg-layer');
const toastEl = document.getElementById('toast');

const hpNinjaEl = document.getElementById('hp-ninja');
const hpSpiderEl = document.getElementById('hp-spider');
const hpNinjaGhost = document.getElementById('hp-ninja-ghost');
const hpSpiderGhost = document.getElementById('hp-spider-ghost');
const staminaEl = document.getElementById('stamina');
const intentEl = document.getElementById('enemy-intent');
const timerEl = document.getElementById('timer');
const roundLabel = document.getElementById('round-label');

/* ---------------- Audio (synthesized, no files) ---------------- */
const AudioSys = {
  ctx: null, enabled: false,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.enabled = true;
    } catch { this.enabled = false; }
  },
  tone(freq, dur, type = 'sine', vol = 0.2, slide = 0) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur = 0.15, vol = 0.25, low = 400) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3000;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.ctx.destination);
    src.start(t);
  },
  slash() { this.noise(0.12, 0.22); this.tone(900, 0.1, 'sawtooth', 0.06, -600); },
  heavy() { this.noise(0.25, 0.3); this.tone(140, 0.25, 'square', 0.12, -80); },
  hit() { this.noise(0.12, 0.3); this.tone(180, 0.12, 'triangle', 0.2, -60); },
  shuriken() { this.tone(1400, 0.18, 'sine', 0.1, -900); },
  web() { this.tone(300, 0.25, 'sawtooth', 0.1, 500); },
  jump() { this.tone(300, 0.15, 'sine', 0.1, 300); },
  bell() { this.tone(880, 0.6, 'sine', 0.18); setTimeout(() => this.tone(880, 0.6, 'sine', 0.15), 250); },
  ko() { this.tone(220, 0.8, 'sawtooth', 0.2, -180); this.noise(0.5, 0.3); },
  count() { this.tone(660, 0.12, 'square', 0.12); }
};

/* ---------------- Input ---------------- */
const Input = {
  keys: {}, mouseDown: false, rDown: false,
  camYaw: 0, camPitch: 0.32, camDist: 11,
  dragging: false, lx: 0, ly: 0,
  touchMove: { x: 0, y: 0 }, touchBlock: false,
  init() {
    addEventListener('keydown', e => {
      if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys[e.code] = true;
      if (e.code === 'KeyR') Game.rematch();
      if (e.code === 'Enter') Game.uiStart();
      if (e.code === 'KeyP') Game.togglePause();
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    canvas.addEventListener('mousedown', e => {
      AudioSys.init();
      if (e.button === 0) { Game.playerSlash(); }
      if (e.button === 2) { Game.playerShuriken(); }
      this.dragging = true; this.lx = e.clientX; this.ly = e.clientY;
    });
    addEventListener('mouseup', () => { this.dragging = false; });
    addEventListener('mousemove', e => {
      if (!this.dragging) return;
      this.camYaw -= (e.clientX - this.lx) * 0.005;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + (e.clientY - this.ly) * 0.003, 0.05, 1.1);
      this.lx = e.clientX; this.ly = e.clientY;
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.01, 6, 18);
    }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    // touch joystick
    const stick = document.getElementById('stick'), knob = document.getElementById('stick-knob');
    let sid = null;
    const setKnob = (dx, dy) => { knob.style.left = (38 + dx) + 'px'; knob.style.top = (38 + dy) + 'px'; };
    stick.addEventListener('touchstart', e => { sid = e.changedTouches[0].identifier; e.preventDefault(); }, { passive: false });
    addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === sid) {
          const r = stick.getBoundingClientRect();
          let dx = t.clientX - (r.left + 60), dy = t.clientY - (r.top + 60);
          const m = Math.hypot(dx, dy) || 1, cl = Math.min(m, 40);
          dx = dx / m * cl; dy = dy / m * cl;
          setKnob(dx, dy);
          this.touchMove.x = dx / 40; this.touchMove.y = dy / 40;
        }
      }
    }, { passive: true });
    addEventListener('touchend', e => {
      for (const t of e.changedTouches) if (t.identifier === sid) { sid = null; setKnob(0, 0); this.touchMove.x = 0; this.touchMove.y = 0; }
    });
    document.querySelectorAll('#touch-btns button').forEach(b => {
      b.addEventListener('touchstart', e => {
        e.preventDefault(); AudioSys.init();
        const a = b.dataset.act;
        if (a === 'slash') Game.playerSlash();
        if (a === 'shuriken') Game.playerShuriken();
        if (a === 'kick') Game.playerKick();
        if (a === 'jump') Game.playerJump();
        if (a === 'dash') Game.playerDash();
        if (a === 'block') this.touchBlock = true;
      }, { passive: false });
      b.addEventListener('touchend', e => { if (b.dataset.act === 'block') this.touchBlock = false; });
    });
    if (matchMedia('(pointer: coarse)').matches)
      document.getElementById('touch').classList.remove('hidden');
  },
  axis() {
    let x = 0, z = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) z -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) z += 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) x -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) x += 1;
    x += this.touchMove.x; z += this.touchMove.y;
    const m = Math.hypot(x, z);
    if (m > 1) { x /= m; z /= m; }
    return { x, z };
  }
};

/* ---------------- Renderer / Scene ---------------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a18);
scene.fog = new THREE.Fog(0x070a18, 40, 140);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 400);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Lights
scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x2a2040, 0.95));
const moonLight = new THREE.DirectionalLight(0xbfd4ff, 1.6);
moonLight.position.set(-18, 30, -12);
moonLight.castShadow = true;
moonLight.shadow.mapSize.set(1024, 1024);
moonLight.shadow.camera.left = -25; moonLight.shadow.camera.right = 25;
moonLight.shadow.camera.top = 25; moonLight.shadow.camera.bottom = -25;
scene.add(moonLight);
const neonCyan = new THREE.PointLight(0x38e1ff, 60, 40); neonCyan.position.set(-9, 6, -9); scene.add(neonCyan);
const neonPink = new THREE.PointLight(0xff3b8c, 60, 40); neonPink.position.set(9, 6, 9); scene.add(neonPink);
const rim = new THREE.PointLight(0xffd54a, 25, 30); rim.position.set(0, 8, -14); scene.add(rim);
// warm arena floodlight so fighters read clearly on screenshots + SwiftShader
const flood = new THREE.SpotLight(0xfff1d6, 900, 70, Math.PI / 4.2, 0.55, 1.6);
flood.position.set(4, 22, 8);
flood.target.position.set(0, 0, 0);
scene.add(flood); scene.add(flood.target);
const fill = new THREE.DirectionalLight(0x9fd8ff, 0.5);
fill.position.set(6, 10, 14); scene.add(fill);

/* ---------------- Canvas texture helpers ---------------- */
function canvasTex(w, h, fn) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  fn(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const roofTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#303a56'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 3;
  for (let i = 0; i <= 8; i++) {
    g.beginPath(); g.moveTo(i * w / 8, 0); g.lineTo(i * w / 8, h); g.stroke();
    g.beginPath(); g.moveTo(0, i * h / 8); g.lineTo(w, i * h / 8); g.stroke();
  }
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  // hazard ring
  g.strokeStyle = '#ffd54a'; g.lineWidth = 10; g.setLineDash([26, 18]);
  g.beginPath(); g.arc(w/2, h/2, 190, 0, Math.PI*2); g.stroke();
});
roofTex.wrapS = roofTex.wrapT = THREE.RepeatWrapping; roofTex.repeat.set(2, 2);

const spiderChestTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#c81f3a'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#111'; g.lineWidth = 4;
  for (let i = -h; i < w; i += 28) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); }
  for (let i = 0; i < w + h; i += 28) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i - h, h); g.stroke(); }
  // spider emblem
  g.fillStyle = '#0a0a0a';
  g.beginPath(); g.ellipse(w/2, h/2 - 10, 16, 26, 0, 0, Math.PI*2); g.fill();
  g.lineWidth = 7; g.strokeStyle = '#0a0a0a';
  for (let k = 0; k < 4; k++) {
    const a = -0.9 + k * 0.6;
    g.beginPath(); g.moveTo(w/2, h/2); g.lineTo(w/2 + Math.cos(a) * 70, h/2 - 20 + Math.sin(a) * 60); g.stroke();
    g.beginPath(); g.moveTo(w/2, h/2); g.lineTo(w/2 - Math.cos(a) * 70, h/2 - 20 + Math.sin(a) * 60); g.stroke();
  }
});

/* ---------------- Arena ---------------- */
const ARENA = 34;
const world = new THREE.Group(); scene.add(world);

function buildArena() {
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(ARENA, 1.2, ARENA),
    new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.85, metalness: 0.15 })
  );
  roof.position.y = -0.6; roof.receiveShadow = true; world.add(roof);

  // glowing edge trim
  const trimMat = new THREE.MeshBasicMaterial({ color: 0x38e1ff });
  const trim = new THREE.Mesh(new THREE.BoxGeometry(ARENA + 0.4, 0.12, ARENA + 0.4), trimMat);
  trim.position.y = 0.02; world.add(trim);
  const innerDark = new THREE.Mesh(new THREE.BoxGeometry(ARENA - 0.5, 0.13, ARENA - 0.5),
    new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.9 }));
  innerDark.position.y = 0.025; innerDark.receiveShadow = true; world.add(innerDark);

  // parapet walls
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2b3350, roughness: 0.8 });
  const H = 1.1, T = 0.6;
  const walls = [
    [0, H/2, -ARENA/2, ARENA, H, T], [0, H/2, ARENA/2, ARENA, H, T],
    [-ARENA/2, H/2, 0, T, H, ARENA], [ARENA/2, H/2, 0, T, H, ARENA]
  ];
  for (const [x, y, z, w, hh, d] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), wallMat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; world.add(m);
  }
  // neon strips on walls
  const stripC = new THREE.Mesh(new THREE.BoxGeometry(ARENA, 0.08, 0.08), new THREE.MeshBasicMaterial({ color: 0xff3b8c }));
  stripC.position.set(0, 1.16, -ARENA/2); world.add(stripC);
  const stripC2 = stripC.clone(); stripC2.position.z = ARENA/2; world.add(stripC2);

  // props: AC units, vents, antenna, water tower, crates
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3b8, roughness: 0.5, metalness: 0.6 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x39415c, roughness: 0.6, metalness: 0.4 });
  const add = (geo, mat, x, z, y = 0, ry = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true; world.add(m); return m;
  };
  add(new THREE.BoxGeometry(2.4, 1.2, 1.6), metal, -11, -11, 0.6, 0.4);
  add(new THREE.BoxGeometry(1.8, 0.9, 1.8), darkMetal, 11.5, -10.5, 0.45, -0.3);
  add(new THREE.CylinderGeometry(0.7, 0.7, 1.4, 12), darkMetal, -12, 10.5, 0.7);
  add(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshStandardMaterial({ color: 0x6b4d2e, roughness: .8 }), 12, 10.5, 0.7, 0.5);
  // antenna with blinking light
  const pole = add(new THREE.CylinderGeometry(0.12, 0.16, 9, 8), darkMetal, 13, -13, 4.5);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), new THREE.MeshBasicMaterial({ color: 0xff2244 }));
  beacon.position.set(13, 9.2, -13); world.add(beacon);
  world.userData.beacon = beacon;
  // water tower
  const legs = new THREE.Group();
  for (const [lx, lz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4, 6), darkMetal);
    leg.position.set(lx, 2, lz); leg.castShadow = true; legs.add(leg);
  }
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2, 2.6, 12),
    new THREE.MeshStandardMaterial({ color: 0x7a5c3e, roughness: 0.8 }));
  tank.position.y = 5; tank.castShadow = true; legs.add(tank);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.2, 12),
    new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.8 }));
  cone.position.y = 6.9; legs.add(cone);
  legs.position.set(-12.5, 0, -2); world.add(legs);

  // big neon billboard
  const boardTex = canvasTex(1024, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#06121a'); grad.addColorStop(1, '#1a0612');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.font = 'italic 900 120px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#38e1ff'; g.shadowColor = '#38e1ff'; g.shadowBlur = 30;
    g.fillText('NINJA', w/2 - 260, h/2);
    g.fillStyle = '#fff'; g.shadowBlur = 0; g.font = '900 70px Arial';
    g.fillText('VS', w/2, h/2);
    g.fillStyle = '#ff3b5c'; g.shadowColor = '#ff3b5c'; g.shadowBlur = 30;
    g.font = 'italic 900 110px Arial'; g.fillText('SPIDER', w/2 + 280, h/2);
  });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(20, 5),
    new THREE.MeshBasicMaterial({ map: boardTex, transparent: false }));
  board.position.set(0, 10, -22); world.add(board);
  const boardBack = new THREE.Mesh(new THREE.BoxGeometry(20.6, 5.6, 0.5), darkMetal);
  boardBack.position.set(0, 10, -22.4); world.add(boardBack);
  const pole1 = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 8, 8), darkMetal);
  pole1.position.set(-7, 4, -22.3); world.add(pole1);
  const pole2 = pole1.clone(); pole2.position.x = 7; world.add(pole2);

  buildCity();
  buildSky();
}

function buildCity() {
  // instanced windows skyline
  const city = new THREE.Group();
  const bGeo = new THREE.BoxGeometry(1, 1, 1);
  const bMat = new THREE.MeshLambertMaterial({ color: 0x0d1330 });
  const winTex = canvasTex(64, 96, (g, w, h) => {
    g.fillStyle = '#0a0f24'; g.fillRect(0, 0, w, h);
    for (let y = 6; y < h; y += 12) for (let x = 5; x < w; x += 10) {
      g.fillStyle = Math.random() < 0.45 ? (Math.random() < 0.7 ? '#ffd54a' : '#38e1ff') : '#131a36';
      g.fillRect(x, y, 5, 7);
    }
  });
  const winMat = new THREE.MeshBasicMaterial({ map: winTex });
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2 + rnd() * 0.2;
    const dist = 45 + rnd() * 55;
    const w = 6 + rnd() * 10, hh = 12 + rnd() * 38, d = 6 + rnd() * 10;
    const b = new THREE.Mesh(bGeo, bMat);
    b.scale.set(w, hh, d);
    b.position.set(Math.cos(a) * dist, hh / 2 - 6, Math.sin(a) * dist);
    city.add(b);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.95, hh * 0.9), winMat);
    win.position.set(b.position.x, b.position.y, b.position.z);
    win.lookAt(0, b.position.y, 0);
    win.translateZ(Math.max(w, d) / 2 + 0.1);
    city.add(win);
  }
  world.add(city);
}

function buildSky() {
  // stars
  const starGeo = new THREE.BufferGeometry();
  const N = 500, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.45 + 0.08, r = 180;
    pos[i*3] = Math.cos(a) * Math.cos(e) * r;
    pos[i*3+1] = Math.sin(e) * r;
    pos[i*3+2] = Math.sin(a) * Math.cos(e) * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  world.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xbfd4ff, size: 0.7 })));
  // moon
  const moon = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xe8f1ff }));
  moon.position.set(-60, 70, -90); world.add(moon);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(8.5, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0.25 }));
  glow.position.copy(moon.position); world.add(glow);
}

/* ---------------- Fighter construction ---------------- */
function limb(mat, r, len) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
  m.position.y = -len / 2; m.castShadow = true;
  g.add(m);
  return { group: g, mesh: m };
}

function buildNinja() {
  const g = new THREE.Group();
  const gi = new THREE.MeshStandardMaterial({ color: 0x141824, roughness: 0.7 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.6 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a877, roughness: 0.6 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc81f3a, roughness: 0.6 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.7, 6, 14), gi);
  torso.position.y = 1.25; torso.castShadow = true; g.add(torso);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.07, 8, 20), red);
  belt.position.y = 1.0; belt.rotation.x = Math.PI / 2; g.add(belt);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 20, 20), gi);
  head.position.y = 2.05; head.castShadow = true; g.add(head);
  // face opening
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16, -0.7, 1.4, 1.1, 1.1), skin);
  face.position.set(0, 2.02, 0.12); g.add(face);
  // glowing eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x9df3ff });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), eyeMat);
    eye.position.set(s * 0.09, 2.06, 0.3); g.add(eye);
  }
  // headband + tails
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.05, 8, 20), red);
  band.position.y = 2.14; band.rotation.x = Math.PI / 2; g.add(band);
  const tails = [];
  for (let i = 0; i < 2; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.7, 0.02), red);
    t.position.set(i ? 0.12 : -0.12, 1.8, -0.3); g.add(t); tails.push(t);
  }
  // katana on back
  const kat = new THREE.Group();
  const sheath = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 0.4 }));
  kat.add(sheath);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8), red);
  handle.position.y = 0.8; kat.add(handle);
  kat.position.set(0.25, 1.5, -0.32); kat.rotation.z = 0.7; kat.rotation.x = 0.25;
  g.add(kat);
  // drawn blade (hidden unless attacking)
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.25, 0.015),
    new THREE.MeshStandardMaterial({ color: 0xdfe9ff, metalness: 0.9, roughness: 0.2, emissive: 0x38e1ff, emissiveIntensity: 0.35 }));
  blade.position.y = 0.6;
  const armR = limb(gi, 0.11, 0.5); armR.group.position.set(0.45, 1.62, 0); g.add(armR.group);
  const armL = limb(gi, 0.11, 0.5); armL.group.position.set(-0.45, 1.62, 0); g.add(armL.group);
  blade.position.set(0, -0.75, 0.1); blade.rotation.x = Math.PI / 2.3;
  armR.group.add(blade);
  const legR = limb(accent, 0.13, 0.55); legR.group.position.set(0.18, 0.85, 0); g.add(legR.group);
  const legL = limb(accent, 0.13, 0.55); legL.group.position.set(-0.18, 0.85, 0); g.add(legL.group);
  // slash arc FX
  const arcTex = canvasTex(256, 128, (gg, w, h) => {
    const gr = gg.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, 'rgba(56,225,255,0)'); gr.addColorStop(0.5, 'rgba(160,245,255,.95)'); gr.addColorStop(1, 'rgba(56,225,255,0)');
    gg.fillStyle = gr;
    gg.beginPath(); gg.ellipse(w/2, h/2, w/2, h/3, 0, 0, Math.PI*2); gg.fill();
  });
  const arc = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.1),
    new THREE.MeshBasicMaterial({ map: arcTex, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  arc.position.set(0, 1.3, 0.9); g.add(arc);

  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { group: g, armR: armR.group, armL: armL.group, legR: legR.group, legL: legL.group, torso, head, tails, arc, blade };
}

function buildSpider() {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ map: spiderChestTex, roughness: 0.55 });
  const redPlain = new THREE.MeshStandardMaterial({ color: 0xc81f3a, roughness: 0.55 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x1c3fae, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x101020, roughness: 0.5 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.7, 6, 14), red);
  torso.position.y = 1.25; torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.29, 20, 20), redPlain);
  head.position.y = 2.05; head.castShadow = true; g.add(head);
  // white lenses
  const lensMat = new THREE.MeshBasicMaterial({ color: 0xf2f7ff });
  for (const s of [-1, 1]) {
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), lensMat);
    lens.scale.set(1, 1.35, 0.55);
    lens.position.set(s * 0.13, 2.08, 0.22); lens.rotation.z = s * -0.25;
    g.add(lens);
    const rimM = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.02, 6, 14), dark);
    rimM.position.copy(lens.position); rimM.position.z -= 0.01; rimM.scale.set(1, 1.35, 1);
    g.add(rimM);
  }
  const armR = limb(redPlain, 0.11, 0.5); armR.group.position.set(0.47, 1.62, 0); g.add(armR.group);
  const armL = limb(redPlain, 0.11, 0.5); armL.group.position.set(-0.47, 1.62, 0); g.add(armL.group);
  // wrist shooters
  for (const a of [armR, armL]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 10), dark);
    w.position.y = -0.5; a.group.add(w);
  }
  const legR = limb(blue, 0.13, 0.55); legR.group.position.set(0.18, 0.85, 0); g.add(legR.group);
  const legL = limb(blue, 0.13, 0.55); legL.group.position.set(-0.18, 0.85, 0); g.add(legL.group);
  // back spider legs decor? small
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { group: g, armR: armR.group, armL: armL.group, legR: legR.group, legL: legL.group, torso, head, tails: [], arc: null, blade: null };
}

/* ---------------- Particles / projectiles ---------------- */
const particles = [];
function spawnBurst(pos, color, n = 14, speed = 5, life = 0.6, size = 0.12) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size),
      new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.copy(pos);
    const v = new THREE.Vector3((Math.random()-0.5)*speed, Math.random()*speed*0.9, (Math.random()-0.5)*speed);
    scene.add(m);
    particles.push({ m, v, life, age: 0 });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    p.v.y -= 12 * dt;
    p.m.position.addScaledVector(p.v, dt);
    if (p.m.position.y < 0.05) { p.m.position.y = 0.05; p.v.y *= -0.4; p.v.x *= 0.7; p.v.z *= 0.7; }
    p.m.material.opacity = 1 - p.age / p.life;
    p.m.rotation.x += dt * 6; p.m.rotation.y += dt * 5;
    if (p.age >= p.life) { scene.remove(p.m); p.m.geometry.dispose(); p.m.material.dispose(); particles.splice(i, 1); }
  }
}

const projectiles = [];
const shurikenGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.05, 4);
const shurikenMat = new THREE.MeshStandardMaterial({ color: 0xcfe6ff, metalness: 0.9, roughness: 0.25, emissive: 0x38e1ff, emissiveIntensity: 0.5 });
const webGeo = new THREE.SphereGeometry(0.16, 10, 10);
function fireShuriken(from, dir) {
  const m = new THREE.Mesh(shurikenGeo, shurikenMat.clone());
  m.position.copy(from); m.rotation.x = Math.PI / 2;
  scene.add(m);
  projectiles.push({ m, vel: dir.clone().multiplyScalar(22), life: 1.6, kind: 'shuriken', spin: 18, fromPlayer: true });
  AudioSys.shuriken();
}
function fireWeb(from, dir) {
  const m = new THREE.Mesh(webGeo, new THREE.MeshBasicMaterial({ color: 0xf4f8ff }));
  m.position.copy(from); m.scale.set(1, 1, 1.6);
  scene.add(m);
  // strand
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 5),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
  tail.rotation.x = Math.PI / 2; tail.position.z = -0.6; m.add(tail);
  projectiles.push({ m, vel: dir.clone().multiplyScalar(16), life: 2.2, kind: 'web', spin: 4, fromPlayer: false });
  AudioSys.web();
}
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    p.m.position.addScaledVector(p.vel, dt);
    p.m.rotation.y += p.spin * dt;
    if (p.kind === 'web') p.m.lookAt(p.m.position.clone().add(p.vel));
    let dead = p.life <= 0 || Math.abs(p.m.position.x) > ARENA/2 + 4 || Math.abs(p.m.position.z) > ARENA/2 + 4 || p.m.position.y < 0 || p.m.position.y > 20;
    if (!dead) {
      if (p.kind === 'shuriken') {
        if (Game.distToSpider(p.m.position) < 1.0) { Game.damageSpider(6, p.m.position, 'SHURIKEN'); dead = true; }
      } else {
        if (Game.distToNinja(p.m.position) < 1.0) { Game.damageNinja(7, p.m.position, true); dead = true; }
      }
    }
    if (dead) {
      spawnBurst(p.m.position, p.kind === 'web' ? 0xffffff : 0x9df3ff, 8, 4, 0.4, 0.09);
      scene.remove(p.m); projectiles.splice(i, 1);
    }
  }
}

/* ---------------- Damage numbers ---------------- */
const dmgPool = [];
function dmgNumber(worldPos, text, color = '#fff') {
  let el = dmgPool.find(d => d.free);
  if (!el) {
    if (dmgPool.length > 24) return;
    el = { div: document.createElement('div'), free: false };
    el.div.className = 'dmg'; dmgLayer.appendChild(el.div);
    dmgPool.push(el);
  }
  el.free = false;
  el.div.textContent = text;
  el.div.style.color = color;
  el.div.style.opacity = '1';
  const v = worldPos.clone(); v.y += 0.6; v.project(camera);
  el.div.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px';
  el.div.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
  el.div.style.transform = 'translate(-50%,-50%) scale(1.2)';
  requestAnimationFrame(() => { el.div.style.transform = 'translate(-50%,-140%) scale(1)'; el.div.style.opacity = '0'; });
  setTimeout(() => { el.free = true; }, 750);
}

/* ---------------- Fighter state ---------------- */
class Fighter {
  constructor(view, isPlayer) {
    this.view = view; this.isPlayer = isPlayer;
    this.pos = view.group.position;
    this.vel = new THREE.Vector3();
    this.hp = 100; this.maxHp = 100;
    this.stamina = 100;
    this.y = 0; this.vy = 0; this.grounded = true;
    this.facing = 0;
    this.atkT = 0; this.atkKind = null; this.atkHit = false; this.atkCd = 0;
    this.hurtT = 0; this.blocking = false; this.ko = false;
    this.walkPhase = Math.random() * 6;
    this.webSlow = 0; this.dashT = 0; this.dashCd = 0;
    this.combo = 0; this.comboT = 0;
  }
  reset(x, z, facing) {
    this.hp = this.maxHp; this.stamina = 100;
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0);
    this.y = 0; this.vy = 0; this.facing = facing;
    this.atkT = 0; this.atkKind = null; this.hurtT = 0; this.ko = false;
    this.blocking = false; this.webSlow = 0; this.combo = 0;
    this.view.group.rotation.set(0, facing, 0);
    this.view.group.position.y = 0;
  }
  tryMelee(kind) {
    if (this.ko || this.atkT > 0 || this.hurtT > 0 || this.atkCd > 0) return false;
    this.atkKind = kind; this.atkHit = false;
    this.atkT = kind === 'kick' ? 0.55 : kind === 'slash' ? 0.38 : 0.5;
    this.atkCd = kind === 'kick' ? 0.7 : kind === 'slash' ? 0.34 : 0.6;
    return true;
  }
  update(dt, t) {
    this.atkCd = Math.max(0, this.atkCd - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.webSlow = Math.max(0, this.webSlow - dt);
    this.comboT -= dt; if (this.comboT <= 0) this.combo = 0;
    if (this.atkT > 0) this.atkT -= dt;
    // gravity
    if (!this.grounded || this.y > 0) {
      this.vy -= 26 * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) { this.y = 0; this.vy = 0; this.grounded = true; spawnBurst(this.pos.clone(), 0x8a93b8, 5, 2, 0.3, 0.08); }
    }
    this.pos.y = this.y;
    // clamp arena
    const lim = ARENA / 2 - 1.2;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -lim, lim);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -lim, lim);
    this.animate(dt, t);
  }
  animate(dt, t) {
    const v = this.view;
    const moving = this.vel.length() > 0.5;
    if (moving) this.walkPhase += dt * 11;
    const swing = moving ? Math.sin(this.walkPhase) * 0.65 : Math.sin(t * 2.2) * 0.06;
    const swing2 = moving ? Math.sin(this.walkPhase + Math.PI) * 0.65 : Math.sin(t * 2.2 + 1) * 0.06;
    v.legR.rotation.x = swing; v.legL.rotation.x = swing2;
    v.armL.rotation.x = swing * 0.7;
    // breathing
    v.torso.position.y = 1.25 + Math.sin(t * 2.5) * 0.02;
    // tails flutter
    v.tails.forEach((tail, i) => { tail.rotation.x = 0.4 + Math.sin(t * 5 + i * 2) * 0.25 + (moving ? 0.5 : 0); });
    if (this.ko) {
      v.group.rotation.x = THREE.MathUtils.lerp(v.group.rotation.x, -Math.PI / 2 + 0.15, dt * 4);
      v.group.position.y = THREE.MathUtils.lerp(v.group.position.y, 0.25, dt * 4);
      return;
    } else {
      v.group.rotation.x = THREE.MathUtils.lerp(v.group.rotation.x, 0, dt * 8);
    }
    if (this.view.arc) this.view.arc.material.opacity = Math.max(0, this.view.arc.material.opacity - dt * 5);
    if (this.blocking) {
      v.armR.rotation.x = -1.4; v.armR.rotation.z = 0.5;
      v.armL.rotation.x = -1.4; v.armL.rotation.z = -0.5;
      return;
    }
    if (this.hurtT > 0) {
      const k = this.hurtT * 6;
      v.torso.rotation.z = Math.sin(k) * 0.12;
      v.armR.rotation.x = -0.8; v.armL.rotation.x = -0.8;
      return;
    } else v.torso.rotation.z = 0;
    if (this.atkKind && this.atkT > 0) {
      const total = this.atkKind === 'kick' ? 0.55 : this.atkKind === 'slash' ? 0.38 : 0.5;
      const k = 1 - this.atkT / total; // 0..1
      if (this.atkKind === 'slash') {
        v.armR.rotation.x = -1.8 + k * 2.4;
        v.armR.rotation.z = -0.4;
        if (this.view.arc) {
          this.view.arc.material.opacity = 0.95;
          this.view.arc.rotation.z = -1.2 + k * 2.4;
          this.view.arc.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.25);
        }
        v.group.rotation.y = this.facing + Math.sin(k * Math.PI) * 0.35;
      } else if (this.atkKind === 'kick') {
        v.legR.rotation.x = -2.0 + k * 1.2;
        v.group.rotation.y = this.facing + k * 2.2;
        v.armR.rotation.x = -1.2; v.armL.rotation.x = 1.0;
      } else if (this.atkKind === 'punch' || this.atkKind === 'spiderStrike') {
        const arm = (k < 0.5) ? v.armR : v.armL;
        const other = (k < 0.5) ? v.armL : v.armR;
        arm.rotation.x = -1.7; other.rotation.x = 0.3;
        v.group.rotation.y = this.facing + Math.sin(k * Math.PI) * 0.15;
      } else if (this.atkKind === 'webshot') {
        v.armR.rotation.x = -1.9; v.armL.rotation.x = 0.2;
      }
      return;
    }
    // default arms
    v.armR.rotation.x = swing2 * 0.7;
    v.armR.rotation.z = -0.12;
    v.armL.rotation.z = 0.12;
    v.group.rotation.y = THREE.MathUtils.lerpAngle(v.group.rotation.y, this.facing, 10 * dt);
  }
}
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}
THREE.MathUtils.lerpAngle = lerpAngle;

/* ---------------- Game manager ---------------- */
const Game = {
  ninja: null, spider: null,
  state: 'menu', // menu | intro | fight | roundEnd | over | paused(prev)
  prevState: 'menu',
  round: 1, wins: { ninja: 0, spider: 0 },
  time: 60, introT: 0, endT: 0, shake: 0, hitstop: 0, slowmo: 0,
  camFocus: new THREE.Vector3(),
  enemy: { mode: 'stalk', t: 1.5, strafe: 1, intent: 0 },

  init() {
    buildArena();
    this.ninja = new Fighter(buildNinja(), true);
    this.spider = new Fighter(buildSpider(), false);
    scene.add(this.ninja.view.group); scene.add(this.spider.view.group);
    this.ninja.reset(-4, 2, Math.PI / 2);
    this.spider.reset(4, -2, -Math.PI / 2);
    Input.init();
    btnStart.addEventListener('click', () => this.uiStart());
    btnRematch.addEventListener('click', () => this.rematch());
    addEventListener('pointerdown', () => AudioSys.init(), { once: true });
    addEventListener('keydown', () => AudioSys.init(), { once: true });
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    loadingEl.style.display = 'none';
    window.__game = {
      ready: true, state: () => this.state, hp: () => [this.ninja.hp, this.spider.hp],
      pos: () => [this.ninja.pos.x, this.ninja.pos.z, this.spider.pos.x, this.spider.pos.z],
      slash: () => this.playerSlash(), shuriken: () => this.playerShuriken(),
      duel: () => this.debugDuel()
    };
    this.announce('NINJA vs SPIDER HERO', 'press START or ENTER');
  },

  uiStart() {
    AudioSys.init();
    if (this.state === 'menu' || this.state === 'over') this.startMatch();
    else if (this.state === 'fight' && menuEl.classList.contains('hidden') === false) {
      menuEl.classList.add('hidden');
    }
  },
  startMatch() {
    this.round = 1; this.wins = { ninja: 0, spider: 0 };
    menuEl.classList.add('hidden'); overEl.classList.add('hidden');
    this.startRound();
  },
  rematch() { overEl.classList.add('hidden'); this.startMatch(); },
  togglePause() {
    if (this.state === 'fight') { this.prevState = 'fight'; this.state = 'paused'; this.toast('PAUSED — press P to resume'); }
    else if (this.state === 'paused') { this.state = 'fight'; this.toast(''); }
  },
  startRound() {
    this.ninja.reset(-4, 0, Math.PI / 2);
    this.spider.reset(4, 0, -Math.PI / 2);
    this.time = 60; this.state = 'intro'; this.introT = 0;
    this.enemy.mode = 'stalk'; this.enemy.t = 2;
    roundLabel.textContent = 'ROUND ' + this.round;
    this.updatePips();
    AudioSys.count();
  },
  updatePips() {
    const pn = document.querySelectorAll('#pips-ninja span');
    const ps = document.querySelectorAll('#pips-spider span');
    pn.forEach((s, i) => s.classList.toggle('on', i < this.wins.ninja));
    ps.forEach((s, i) => s.classList.toggle('on', i < this.wins.spider));
  },
  announce(big, sub = '', hold = 1.6) {
    announceBig.textContent = big; announceSub.textContent = sub;
    announceEl.classList.remove('hidden');
    clearTimeout(this._annT);
    this._annT = setTimeout(() => announceEl.classList.add('hidden'), hold * 1000);
  },
  toast(msg) {
    if (!msg) { toastEl.classList.add('hidden'); return; }
    toastEl.textContent = msg; toastEl.classList.remove('hidden');
  },

  /* ---- player actions ---- */
  playerSlash() {
    if (this.state !== 'fight' || this.ninja.ko) return;
    if (this.ninja.tryMelee('slash')) AudioSys.slash();
  },
  playerKick() {
    if (this.state !== 'fight' || this.ninja.ko) return;
    if (this.ninja.tryMelee('kick')) AudioSys.heavy();
  },
  playerShuriken() {
    if (this.state !== 'fight' || this.ninja.ko) return;
    const n = this.ninja;
    if (n.atkCd > 0.1 || n.hurtT > 0) return;
    n.atkCd = 0.55;
    const dir = new THREE.Vector3(Math.sin(n.facing), 0, Math.cos(n.facing));
    const from = n.pos.clone(); from.y += 1.5; from.addScaledVector(dir, 0.8);
    fireShuriken(from, dir);
    n.atkKind = 'slash'; n.atkT = 0.25;
  },
  playerJump() {
    if (this.state !== 'fight') return;
    const n = this.ninja;
    if (n.grounded && !n.ko) { n.vy = 9; n.grounded = false; AudioSys.jump(); spawnBurst(n.pos.clone(), 0x38e1ff, 6, 3, 0.35, 0.08); }
  },
  playerDash() {
    const n = this.ninja;
    if (this.state !== 'fight' || n.dashCd > 0 || n.stamina < 20) return;
    const ax = Input.axis();
    let dx = Math.sin(n.facing), dz = Math.cos(n.facing);
    if (Math.hypot(ax.x, ax.z) > 0.2) {
      const yaw = Input.camYaw;
      dx = ax.x * Math.cos(yaw) + ax.z * Math.sin(yaw);
      dz = -ax.x * Math.sin(yaw) + ax.z * Math.cos(yaw);
    }
    n.pos.x += dx * 3.2; n.pos.z += dz * 3.2;
    n.dashCd = 0.8; n.stamina -= 20;
    spawnBurst(n.pos.clone().setY(1), 0x38e1ff, 12, 5, 0.4, 0.1);
    AudioSys.noise(0.15, 0.2);
  },

  distToSpider(p) { return p.distanceTo(new THREE.Vector3(this.spider.pos.x, 1.2, this.spider.pos.z)); },
  distToNinja(p) { return p.distanceTo(new THREE.Vector3(this.ninja.pos.x, 1.2, this.ninja.pos.z)); },
  // deterministic combat probe (used by automated verification)
  debugDuel() {
    if (this.state !== 'fight') return 'not-fighting';
    const s = this.spider, n = this.ninja;
    n.pos.set(s.pos.x - 1.6, 0, s.pos.z);
    n.facing = Math.atan2(s.pos.x - n.pos.x, s.pos.z - n.pos.z);
    n.atkCd = 0; n.hurtT = 0;
    this.playerSlash();
    return 'slashed';
  },

  damageSpider(amount, atPos, label = '') {
    const s = this.spider;
    if (s.ko || this.state !== 'fight') return;
    let dmg = amount;
    if (s.blocking) dmg = Math.ceil(amount * 0.25);
    s.hp = Math.max(0, s.hp - dmg);
    s.hurtT = 0.35; s.combo++; s.comboT = 2;
    // player combo HUD
    this.ninja.combo++; this.ninja.comboT = 2;
    if (this.ninja.combo >= 3) { comboCount.textContent = this.ninja.combo; comboEl.classList.remove('hidden'); }
    dmgNumber(atPos || s.pos.clone().setY(2), '-' + dmg, '#7df3ff');
    spawnBurst(atPos || s.pos.clone().setY(1.4), 0xffd54a, 12, 6, 0.5, 0.11);
    this.shake = Math.min(0.7, this.shake + 0.3); this.hitstop = Math.max(this.hitstop, 0.05);
    AudioSys.hit();
    vignette.classList.remove('hurt');
    if (s.hp <= 0) this.endRound('ninja');
  },
  damageNinja(amount, atPos, isWeb = false) {
    const n = this.ninja;
    if (n.ko || this.state !== 'fight') return;
    let dmg = amount;
    if (n.blocking && !isWeb) dmg = Math.ceil(amount * 0.3);
    n.hp = Math.max(0, n.hp - dmg);
    n.hurtT = 0.35;
    dmgNumber(atPos || n.pos.clone().setY(2), '-' + dmg, isWeb ? '#cfe6ff' : '#ff6b81');
    spawnBurst(atPos || n.pos.clone().setY(1.4), isWeb ? 0xffffff : 0xff3b5c, 12, 6, 0.5, 0.11);
    this.shake = Math.min(0.8, this.shake + 0.35);
    vignette.classList.add('hurt');
    setTimeout(() => vignette.classList.remove('hurt'), 220);
    AudioSys.hit();
    if (isWeb) {
      n.webSlow = 1.6;
      webbedEl.classList.remove('hidden');
      setTimeout(() => webbedEl.classList.add('hidden'), 1200);
      this.toast('WEBBED! Movement slowed');
      setTimeout(() => { if (this.state === 'fight') this.toast(''); }, 1400);
    }
    comboEl.classList.add('hidden'); this.ninja.combo = 0;
    if (n.hp <= 0) this.endRound('spider');
  },

  endRound(winner) {
    if (this.state !== 'fight') return;
    this.state = 'roundEnd'; this.endT = 0;
    const loser = winner === 'ninja' ? this.spider : this.ninja;
    loser.ko = true; loser.hp = 0;
    this.wins[winner]++;
    this.updatePips();
    this.slowmo = 1.2; this.shake = 1.0;
    AudioSys.ko();
    spawnBurst(loser.pos.clone().setY(1), 0xffd54a, 30, 8, 0.9, 0.14);
    if (this.wins[winner] >= 2) {
      this.announce(winner === 'ninja' ? 'NINJA WINS!' : 'SPIDER WINS!', 'K.O.', 2.2);
      setTimeout(() => this.showOver(winner), 2300);
    } else {
      this.announce('K.O.!', (winner === 'ninja' ? 'NINJA' : 'SPIDER HERO') + ' TAKES ROUND ' + this.round, 2.0);
      setTimeout(() => { this.round++; this.startRound(); }, 2300);
    }
  },
  showOver(winner) {
    this.state = 'over';
    document.getElementById('go-kicker').textContent = winner === 'ninja' ? 'SHADOW PREVAILS' : 'WEB-SLINGER TRIUMPHS';
    document.getElementById('go-title').textContent = winner === 'ninja' ? 'NINJA WINS' : 'SPIDER HERO WINS';
    document.getElementById('go-title').style.color = winner === 'ninja' ? '#38e1ff' : '#ff3b5c';
    document.getElementById('go-sub').textContent = `Rounds ${this.wins.ninja} — ${this.wins.spider} • Press R for rematch`;
    overEl.classList.remove('hidden');
    AudioSys.bell();
  },

  /* ---- AI ---- */
  updateAI(dt) {
    const s = this.spider, n = this.ninja;
    if (s.ko || this.state !== 'fight') { s.vel.set(0, 0, 0); s.blocking = false; return; }
    const toN = new THREE.Vector3().subVectors(n.pos, s.pos); toN.y = 0;
    const dist = toN.length();
    const dir = toN.clone().normalize();
    const aggro = 0.55 + this.round * 0.15; // harder each round
    this.enemy.t -= dt;
    s.blocking = false;
    // pick behaviour
    if (this.enemy.t <= 0) {
      const r = Math.random();
      if (dist > 9) this.enemy.mode = r < 0.6 ? 'chase' : 'webspam';
      else if (dist > 3.2) {
        if (r < 0.45) this.enemy.mode = 'chase';
        else if (r < 0.7) this.enemy.mode = 'strafe';
        else if (r < 0.88) this.enemy.mode = 'webspam';
        else this.enemy.mode = 'jumpAttack';
      } else {
        if (r < 0.55) this.enemy.mode = 'combo';
        else if (r < 0.75) this.enemy.mode = 'retreat';
        else if (r < 0.9) this.enemy.mode = 'webspam';
        else this.enemy.mode = 'block';
      }
      this.enemy.t = 0.9 + Math.random() * 1.2 * (1.2 - aggro * 0.5);
      this.enemy.strafe = Math.random() < 0.5 ? -1 : 1;
    }
    s.vel.set(0, 0, 0);
    const speed = 5.2 + this.round * 0.5;
    const faceTo = Math.atan2(dir.x, dir.z);
    s.facing = lerpAngle(s.facing, faceTo, 8 * dt);
    this.enemy.intent = dist > 8 ? 0.85 : dist > 3 ? 0.5 : 0.95;

    if (n.atkT > 0 && dist < 3 && Math.random() < 0.02 + aggro * 0.02) s.blocking = true;
    if (this.enemy.mode === 'block') s.blocking = true;

    if (s.atkT <= 0 && s.hurtT <= 0) {
      if (this.enemy.mode === 'chase' || this.enemy.mode === 'combo') {
        if (dist > 2.2) { s.vel.addScaledVector(dir, speed); }
        if (dist < 2.6) {
          // melee mix
          if (Math.random() < dt * (1.2 + aggro)) {
            const kind = Math.random() < 0.5 ? 'spiderStrike' : (Math.random() < 0.5 ? 'kick' : 'punch');
            if (s.tryMelee(kind)) AudioSys.slash();
          }
        }
      } else if (this.enemy.mode === 'strafe') {
        const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(this.enemy.strafe);
        s.vel.addScaledVector(side, speed * 0.8);
        if (dist > 5) s.vel.addScaledVector(dir, speed * 0.5);
        if (Math.random() < dt * 0.8 && dist < 8) this.spiderWebshot(dir);
      } else if (this.enemy.mode === 'retreat') {
        s.vel.addScaledVector(dir, -speed * 0.9);
        if (Math.random() < dt * 1.2) this.spiderWebshot(dir);
      } else if (this.enemy.mode === 'webspam') {
        // keep distance, shoot webs
        if (dist < 5) s.vel.addScaledVector(dir, -speed * 0.5);
        else if (dist > 11) s.vel.addScaledVector(dir, speed * 0.6);
        if (Math.random() < dt * (1.4 + aggro * 0.8)) this.spiderWebshot(dir);
      } else if (this.enemy.mode === 'jumpAttack') {
        if (s.grounded && Math.random() < dt * 2) {
          s.vy = 10; s.grounded = false;
          s.vel.addScaledVector(dir, 9);
          AudioSys.jump();
        } else s.vel.addScaledVector(dir, speed);
        if (!s.grounded && dist < 3 && s.atkT <= 0) {
          if (s.tryMelee('kick')) AudioSys.heavy();
        }
      }
      // melee contact resolution for spider attacks
      this.resolveMelee(s, n, 2.7, { spiderStrike: 8, punch: 6, kick: 12, webshot: 0 });
    }
    // integrate
    s.pos.addScaledVector(s.vel, dt);
  },
  spiderWebshot(dir) {
    const s = this.spider;
    if (s.atkT > 0 || s.atkCd > 0) return;
    s.atkKind = 'webshot'; s.atkT = 0.5; s.atkCd = 1.1;
    const from = s.pos.clone(); from.y += 1.6;
    from.addScaledVector(dir, 0.8);
    const aim = dir.clone(); aim.y = 0.05; aim.normalize();
    setTimeout(() => {
      if (this.state !== 'fight' || s.ko) return;
      fireWeb(from, aim);
    }, 180);
    AudioSys.web();
  },
  resolveMelee(att, vic, range, dmgMap) {
    if (!att.atkKind || att.atkT <= 0 || att.atkHit) return;
    const total = att.atkKind === 'kick' ? 0.55 : att.atkKind === 'slash' ? 0.38 : 0.5;
    const k = 1 - att.atkT / total;
    if (k < 0.35 || k > 0.8) return; // active window
    const d = att.pos.distanceTo(vic.pos);
    if (d > range) return;
    // facing check
    const toV = new THREE.Vector3().subVectors(vic.pos, att.pos).normalize();
    const fwd = new THREE.Vector3(Math.sin(att.facing), 0, Math.cos(att.facing));
    if (fwd.dot(toV) < 0.2) return;
    att.atkHit = true;
    const dmg = dmgMap[att.atkKind] ?? 8;
    const hitPos = vic.pos.clone(); hitPos.y = 1.4;
    if (vic.isPlayer) this.damageNinja(dmg, hitPos);
    else this.damageSpider(dmg, hitPos, att.atkKind.toUpperCase());
  },

  /* ---- per-frame ---- */
  loop(tms) {
    requestAnimationFrame(this.loop);
    let dt = Math.min(0.08, (tms - (this._last || tms)) / 1000 || 0.016);
    this._last = tms;
    const t = tms / 1000;
    // hitstop / slowmo
    if (this.hitstop > 0) { this.hitstop -= dt; dt *= 0.08; }
    if (this.slowmo > 0) { this.slowmo -= dt; dt *= 0.35; }

    if (this.state === 'intro') {
      this.introT += dt;
      if (this.introT < 0.1) this.announce('ROUND ' + this.round, this.round === 1 ? 'ninja vs spider hero' : '', 1.0);
      if (this.introT > 1.2 && !this._fightCalled) { this._fightCalled = true; this.announce('FIGHT!', '', 0.8); AudioSys.bell(); }
      if (this.introT > 1.9) { this.state = 'fight'; this._fightCalled = false; }
    }
    if (this.state === 'fight') {
      this.time -= dt;
      if (this.time <= 0) {
        this.time = 0;
        this.endRound(this.ninja.hp >= this.spider.hp ? 'ninja' : 'spider');
      }
      this.updatePlayer(dt);
      this.updateAI(dt);
      // player melee resolution
      this.resolveMelee(this.ninja, this.spider, 3.0, { slash: 8, kick: 12, punch: 7, webshot: 0 });
    } else if (this.state === 'menu') {
      // idle demo: slow orbit + fighters bob
      this.ninja.update(dt, t); this.spider.update(dt, t);
      this.ninja.facing = lerpAngle(this.ninja.facing, Math.PI / 2 + Math.sin(t * 0.3) * 0.2, 2 * dt);
      this.spider.facing = lerpAngle(this.spider.facing, -Math.PI / 2, 2 * dt);
    } else {
      this.ninja.update(dt, t); this.spider.update(dt, t);
    }

    if (this.state === 'fight' || this.state === 'roundEnd' || this.state === 'over') {
      // player/spider already updated above for fight; for others updated in else
    }
    updateParticles(dt);
    updateProjectiles(dt);

    // beacon blink
    if (world.userData.beacon) world.userData.beacon.material.color.setHex(Math.sin(t * 4) > 0 ? 0xff2244 : 0x550000);
    neonCyan.intensity = 55 + Math.sin(t * 3.1) * 8;
    neonPink.intensity = 55 + Math.sin(t * 2.3 + 1) * 8;

    this.updateCamera(dt, t);
    this.updateHud();

    // screen shake
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2);
      camera.position.x += (Math.random() - 0.5) * this.shake * 0.5;
      camera.position.y += (Math.random() - 0.5) * this.shake * 0.4;
    }
    renderer.render(scene, camera);
  },

  updatePlayer(dt) {
    const n = this.ninja;
    // block?
    n.blocking = !!(Input.keys['ShiftLeft'] || Input.keys['ShiftRight'] || Input.touchBlock);
    if (n.blocking) n.stamina = Math.min(100, n.stamina + 10 * dt);
    // attacks from keys (edge)
    if (Input.keys['KeyJ'] && !this._jHeld) { this.playerSlash(); this._jHeld = true; }
    if (!Input.keys['KeyJ']) this._jHeld = false;
    if ((Input.keys['KeyK'] || Input.keys['KeyF']) && !this._kHeld) { this.playerShuriken(); this._kHeld = true; }
    if (!(Input.keys['KeyK'] || Input.keys['KeyF'])) this._kHeld = false;
    if ((Input.keys['KeyL'] || Input.keys['KeyE']) && !this._lHeld) { this.playerKick(); this._lHeld = true; }
    if (!(Input.keys['KeyL'] || Input.keys['KeyE'])) this._lHeld = false;
    if (Input.keys['Space'] && !this._spHeld) { this.playerJump(); this._spHeld = true; }
    if (!Input.keys['Space']) this._spHeld = false;
    if (Input.keys['KeyQ'] && !this._qHeld) { this.playerDash(); this._qHeld = true; }
    if (!Input.keys['KeyQ']) this._qHeld = false;

    // movement camera-relative
    const ax = Input.axis();
    let mx = 0, mz = 0;
    if (Math.hypot(ax.x, ax.z) > 0.05 && !n.ko && n.hurtT <= 0) {
      const yaw = Input.camYaw;
      mx = ax.x * Math.cos(yaw) + ax.z * Math.sin(yaw);
      mz = -ax.x * Math.sin(yaw) + ax.z * Math.cos(yaw);
      let sp = 7;
      if (n.blocking) sp *= 0.35;
      if (n.webSlow > 0) sp *= 0.45;
      if (n.atkT > 0) sp *= 0.3;
      n.vel.set(mx * sp, 0, mz * sp);
      n.facing = lerpAngle(n.facing, Math.atan2(mx, mz), 12 * dt);
    } else n.vel.set(0, 0, 0);
    n.pos.addScaledVector(n.vel, dt);
    n.stamina = Math.min(100, n.stamina + 8 * dt);
    n.update(dt, performance.now() / 1000);
    this.spider.update(dt, performance.now() / 1000);
    // face spider when idle-ish for game feel on player? keep player facing movement; auto-face if attacking
    if (n.atkT > 0) {
      const toS = new THREE.Vector3().subVectors(this.spider.pos, n.pos);
      if (toS.length() < 6) n.facing = lerpAngle(n.facing, Math.atan2(toS.x, toS.z), 6 * dt);
    }
  },

  updateCamera(dt, t) {
    const n = this.ninja, s = this.spider;
    const mid = new THREE.Vector3().addVectors(n.pos, s.pos).multiplyScalar(0.5);
    mid.y = 1.5;
    this.camFocus.lerp(mid, 1 - Math.pow(0.001, dt));
    const yaw = Input.camYaw, pitch = Input.camPitch, dist = Input.camDist;
    // bias camera behind ninja relative to spider for fight readability
    const desired = new THREE.Vector3(
      this.camFocus.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      this.camFocus.y + Math.sin(pitch) * dist,
      this.camFocus.z + Math.cos(yaw) * Math.cos(pitch) * dist
    );
    // keep above roof
    desired.y = Math.max(2.2, desired.y);
    camera.position.lerp(desired, 1 - Math.pow(0.0001, dt));
    camera.lookAt(this.camFocus);
    if (this.state === 'menu') {
      const a = t * 0.15;
      camera.position.set(Math.sin(a) * 14, 6.5, Math.cos(a) * 14);
      camera.lookAt(0, 1.5, 0);
    }
  },

  updateHud() {
    hpNinjaEl.style.width = (this.ninja.hp) + '%';
    hpSpiderEl.style.width = (this.spider.hp) + '%';
    hpNinjaGhost.style.width = (this.ninja.hp) + '%';
    hpSpiderGhost.style.width = (this.spider.hp) + '%';
    staminaEl.style.width = this.ninja.stamina + '%';
    intentEl.style.width = (this.enemy.intent * 100) + '%';
    timerEl.textContent = Math.ceil(this.time);
    timerEl.style.color = this.time <= 10 ? '#ff5b74' : '#fff';
    if (this.ninja.comboT <= 0) comboEl.classList.add('hidden');
  }
};

Game.init();
