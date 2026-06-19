/* ─────────────────────────────────────────────────────────────────── */
/*  DASHBOARD — Log polling & bot control                              */
/* ─────────────────────────────────────────────────────────────────── */

let _lastLogId = 0;
let _pollTimer  = null;

function startPolling() {
  pollStatus();
  pollLogs();
  pollStats();
  setInterval(pollStatus, 3000);
  setInterval(pollLogs,   800);
  setInterval(pollStats,  5000);
}

async function pollStatus() {
  try {
    const r = await fetch('/api/bot/status');
    const d = await r.json();
    applyStatus(d.status);
  } catch (_) {}
}

async function pollStats() {
  try {
    const r = await fetch('/api/stats');
    const d = await r.json();
    const upEl = document.getElementById('statUptime');
    const gwEl = document.getElementById('statGiveaways');
    const qEl  = document.getElementById('statQuests');
    if (upEl) upEl.textContent = d.uptime_secs != null ? fmtUptime(d.uptime_secs) : '—';
    if (gwEl) gwEl.textContent = d.giveaways ?? 0;
    if (qEl)  qEl.textContent  = d.quests ?? 0;
  } catch (_) {}
}

function fmtUptime(secs) {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

async function pollLogs() {
  try {
    const r = await fetch('/api/logs?since=' + _lastLogId);
    const d = await r.json();
    if (d.lines && d.lines.length) {
      d.lines.forEach(l => {
        _lastLogId = l.id;
        appendLog(l.text);
      });
    }
  } catch (_) {}
}

function applyStatus(status) {
  const dot   = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  const btnS  = document.getElementById('btnStart');
  const btnT  = document.getElementById('btnStop');
  const btnR  = document.getElementById('btnRestart');
  if (!dot) return;

  if (status === 'running') {
    dot.className   = 'status-dot running';
    label.textContent = '🟢 Bot đang chạy';
    if (btnS) btnS.disabled = true;
    if (btnT) btnT.disabled = false;
    if (btnR) btnR.disabled = false;
  } else {
    dot.className   = 'status-dot stopped';
    label.textContent = '🔴 Bot đã dừng';
    if (btnS) btnS.disabled = false;
    if (btnT) btnT.disabled = true;
    if (btnR) btnR.disabled = false;
  }
}

async function botAction(action) {
  const btnS = document.getElementById('btnStart');
  const btnT = document.getElementById('btnStop');
  const btnR = document.getElementById('btnRestart');
  [btnS, btnT, btnR].forEach(b => { if (b) b.disabled = true; });

  try {
    const r = await fetch('/api/bot/' + action, { method: 'POST' });
    const d = await r.json();
    applyStatus(d.status);
  } catch (_) {
    [btnS, btnT, btnR].forEach(b => { if (b) b.disabled = false; });
  }
}

function appendLog(text) {
  const body = document.getElementById('consoleBody');
  if (!body) return;

  const div = document.createElement('div');
  div.className = 'log-line ' + classifyLog(text);
  div.textContent = text;
  body.appendChild(div);

  // Trim old lines
  while (body.children.length > 800) body.removeChild(body.firstChild);

  const autoScroll = document.getElementById('autoScroll');
  if (!autoScroll || autoScroll.checked) {
    body.scrollTop = body.scrollHeight;
  }
}

function classifyLog(t) {
  const u = t.toLowerCase();
  if (t.startsWith('───') || t.startsWith('---')) return 'log-sep';
  if (u.includes('error') || u.includes('invalid') || u.includes('[!]')) return 'log-err';
  if (u.includes('warn') || u.includes('rate limit')) return 'log-warn';
  if (u.includes('connected') || u.includes('[✓]') || u.includes('started') || u.includes('found') || u.includes('joined')) return 'log-ok';
  return '';
}

function clearConsole() {
  const body = document.getElementById('consoleBody');
  if (body) body.innerHTML = '';
}


/* ─────────────────────────────────────────────────────────────────── */
/*  SETTINGS — RPC profile builder & config save                       */
/* ─────────────────────────────────────────────────────────────────── */

let _profiles = [];

function initSettings(initialProfiles) {
  _profiles = initialProfiles ? JSON.parse(JSON.stringify(initialProfiles)) : [];
  renderProfiles();
}

/* ── RPC Profile render ─────────────────────────────────────────────── */
function renderProfiles() {
  const container = document.getElementById('rpcProfiles');
  if (!container) return;
  container.innerHTML = '';
  _profiles.forEach((p, i) => {
    container.appendChild(buildProfileCard(p, i));
  });
}

function buildProfileCard(p, idx) {
  const type = p.type || 'Spotify';
  const div = document.createElement('div');
  div.className = 'rpc-profile';
  div.dataset.idx = idx;

  div.innerHTML = `
    <div class="rpc-profile-header">
      <div class="rpc-profile-title">
        <span>Profile ${idx + 1}</span>
        <span class="rpc-type-badge rpc-type-${type}">${type}</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <select class="form-input" style="width:120px;padding:5px 8px" onchange="changeType(${idx},this.value)">
          ${['Spotify','Youtube','Twitch','Playing'].map(t =>
            `<option value="${t}" ${t===type?'selected':''}>${t}</option>`
          ).join('')}
        </select>
        <button class="btn-icon-danger" onclick="removeProfile(${idx})">✕ Xóa</button>
      </div>
    </div>

    <!-- Common fields -->
    <div class="form-grid">
      <div class="form-group full-width">
        <label class="form-label">Title${type==='Spotify'?' (Tên bài hát)':' (Dòng 1)'}</label>
        <input type="text" class="form-input" data-key="title" value="${esc(p.title||'')}" placeholder="Tiêu đề...">
      </div>
      ${type==='Spotify' ? `
      <div class="form-group">
        <label class="form-label">Artist (Nghệ sĩ)</label>
        <input type="text" class="form-input" data-key="artist" value="${esc(p.artist||'')}" placeholder="Tên nghệ sĩ...">
      </div>
      <div class="form-group">
        <label class="form-label">Album</label>
        <input type="text" class="form-input" data-key="album" value="${esc(p.album||'')}" placeholder="Tên album...">
      </div>
      <div class="form-group">
        <label class="form-label">Duration (giây)</label>
        <input type="number" class="form-input" data-key="duration" value="${p.duration||6736}" min="1">
      </div>
      <div class="form-group">
        <label class="form-label">Elapsed (giây đã nghe)</label>
        <input type="number" class="form-input" data-key="elapsed" value="${p.elapsed||0}" min="0">
      </div>
      ` : `
      <div class="form-group full-width">
        <label class="form-label">Line 2</label>
        <input type="text" class="form-input" data-key="line2" value="${esc(p.line2||'')}" placeholder="Dòng 2...">
      </div>
      <div class="form-group full-width">
        <label class="form-label">Line 3</label>
        <input type="text" class="form-input" data-key="line3" value="${esc(p.line3||'')}" placeholder="Dòng 3...">
      </div>
      ${type==='Playing' ? `
      <div class="form-group">
        <label class="form-label">Playing Time (phút)</label>
        <input type="number" class="form-input" data-key="playing_time" value="${p.playing_time||0}" min="0">
        <div class="form-hint">0 = từ lúc bot khởi động</div>
      </div>
      ` : ''}
      `}
    </div>

    <!-- Images -->
    <div class="rpc-field-group">
      <div class="rpc-field-group-title">Hình ảnh</div>
      <div class="form-grid">
        <div class="form-group full-width">
          <label class="form-label">Large Image URL</label>
          <input type="text" class="form-input font-mono" data-key="large_img" value="${esc(p.large_img||'')}" placeholder="https://...">
        </div>
        <div class="form-group full-width">
          <label class="form-label">Small Image URL</label>
          <input type="text" class="form-input font-mono" data-key="small_img" value="${esc(p.small_img||'')}" placeholder="https://...">
        </div>
      </div>
    </div>

    <!-- Buttons -->
    <div class="rpc-field-group">
      <div class="rpc-field-group-title">Buttons (tùy chọn)</div>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">Button 1 — Label</label>
          <input type="text" class="form-input" data-key="btn1_lbl" value="${esc(p.btn1_lbl||'')}" placeholder="🎇 Label...">
        </div>
        <div class="form-group">
          <label class="form-label">Button 1 — URL</label>
          <input type="text" class="form-input font-mono" data-key="btn1_url" value="${esc(p.btn1_url||'')}" placeholder="https://...">
        </div>
        <div class="form-group">
          <label class="form-label">Button 2 — Label</label>
          <input type="text" class="form-input" data-key="btn2_lbl" value="${esc(p.btn2_lbl||'')}" placeholder="✨ Label...">
        </div>
        <div class="form-group">
          <label class="form-label">Button 2 — URL</label>
          <input type="text" class="form-input font-mono" data-key="btn2_url" value="${esc(p.btn2_url||'')}" placeholder="https://...">
        </div>
      </div>
    </div>

    <!-- Delay -->
    <div class="rpc-field-group">
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">Profile Delay (giây)</label>
          <input type="number" class="form-input" data-key="delay" value="${p.delay||3}" min="1" step="0.5">
        </div>
      </div>
    </div>
  `;

  return div;
}

function changeType(idx, newType) {
  _profiles[idx].type = newType;
  renderProfiles();
}

function removeProfile(idx) {
  _profiles.splice(idx, 1);
  renderProfiles();
}

function addRpcProfile() {
  _profiles.push({
    type: 'Spotify', title: '', artist: '', album: '',
    large_img: '', small_img: '', duration: 220, elapsed: 0, delay: 3
  });
  renderProfiles();
  // scroll to last profile
  const profiles = document.querySelectorAll('.rpc-profile');
  if (profiles.length) profiles[profiles.length-1].scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── Collect profiles from DOM ────────────────────────────────────── */
function collectProfiles() {
  const cards = document.querySelectorAll('#rpcProfiles .rpc-profile');
  const result = [];
  cards.forEach((card, i) => {
    const p = { type: _profiles[i]?.type || 'Spotify' };
    card.querySelectorAll('[data-key]').forEach(el => {
      const key = el.dataset.key;
      const val = el.type === 'number' ? (parseFloat(el.value) || 0) : el.value;
      p[key] = val;
    });
    result.push(p);
  });
  return result;
}

/* ── Save config ──────────────────────────────────────────────────── */
async function saveConfig() {
  const profiles = collectProfiles();

  // Collect custom status lines
  const csRaw = (document.getElementById('custom_status_data')?.value || '');
  const csLines = csRaw.split('\n').map(l => l.trim()).filter(Boolean);

  const payload = {
    token:   document.getElementById('token')?.value || '',
    ip:      document.getElementById('ip')?.value || 'default',
    web_password: document.getElementById('web_password')?.value || '',

    custom_status_enabled: document.getElementById('custom_status_enabled')?.checked || false,
    custom_status_delay:   parseFloat(document.getElementById('custom_status_delay')?.value) || 2,
    custom_status_data:    csLines,

    rpc_delay:    parseFloat(document.getElementById('rpc_delay')?.value) || 5,
    rpc_profiles: profiles,

    giveaway_enabled: document.getElementById('giveaway_enabled')?.checked || false,
    giveaway_logging: document.getElementById('giveaway_logging')?.checked || true,

    voice_enabled:     document.getElementById('voice_enabled')?.checked || false,
    voice_guild_id:    document.getElementById('voice_guild_id')?.value || '',
    voice_channel_id:  document.getElementById('voice_channel_id')?.value || '',

    quest_enabled:  document.getElementById('quest_enabled')?.checked || true,
    quest_logging:  document.getElementById('quest_logging')?.checked || true,
    quest_interval: parseInt(document.getElementById('quest_interval')?.value) || 3600,

    webhook_enabled: document.getElementById('webhook_enabled')?.checked || false,
    webhook_url:     document.getElementById('webhook_url')?.value || '',
  };

  try {
    const r = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const d = await r.json();
    showToast(d.ok, d.msg);
  } catch (e) {
    showToast(false, 'Lỗi kết nối: ' + e.message);
  }
}

/* ── Toast ───────────────────────────────────────────────────────── */
let _toastTimer = null;
function showToast(ok, msg) {
  let el = document.getElementById('saveToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'saveToast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast ' + (ok ? 'success' : 'error');
  el.style.display = 'block';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

/* ── Util ─────────────────────────────────────────────────────────── */
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── Placeholder copy ─────────────────────────────────────────────── */
function copyPh(el) {
  const text = el.textContent;
  navigator.clipboard.writeText(text).then(() => {
    el.classList.add('copied');
    const toast = document.getElementById('phCopyToast');
    if (toast) { toast.style.display = 'block'; clearTimeout(toast._t); toast._t = setTimeout(() => toast.style.display='none', 1500); }
    setTimeout(() => el.classList.remove('copied'), 1200);
  }).catch(() => {
    const tmp = document.createElement('textarea');
    tmp.value = text; tmp.style.position = 'fixed'; tmp.style.opacity = '0';
    document.body.appendChild(tmp); tmp.select(); document.execCommand('copy');
    document.body.removeChild(tmp);
    el.classList.add('copied');
    setTimeout(() => el.classList.remove('copied'), 1200);
  });
}
