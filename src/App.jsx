import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function Home() {
  const canvasRef = useRef(null);
  const tooltipRef = useRef(null);
  
  const [activeView, setActiveView] = useState('home');
  const [activeLines, setActiveLines] = useState(new Set(['total']));
  const [legendVal, setLegendVal] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState('login');
  
  const [currentUser, setCurrentUser] = useState(null);
  const [profile, setProfile] = useState({ displayName: '', username: '', email: '', avatar: '' });
  
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginErr, setLoginErr] = useState('');
  
  const [regEmail, setRegEmail] = useState('');
  const [regPass, setRegPass] = useState('');
  const [regErr, setRegErr] = useState('');
  const [regSucc, setRegSucc] = useState('');
  
  const [inpDisplayName, setInpDisplayName] = useState('');
  const [inpUsername, setInpUsername] = useState('');
  const [inpPassword, setInpPassword] = useState('');

  const animState = useRef({
    LINES: {
      total:     { color: '#00e87b', label: 'Total',                  data: new Array(60).fill(0), displayed: new Array(60).fill(0), scale: 1 },
      origin:    { color: '#5b9aff', label: 'Served by Origin',       data: new Array(60).fill(0), displayed: new Array(60).fill(0), scale: 0 },
      cached:    { color: '#f5a623', label: 'Served by Cloudflare',   data: new Array(60).fill(0), displayed: new Array(60).fill(0), scale: 0 },
      mitigated: { color: '#ff5c5c', label: 'Mitigated by Cloudflare', data: new Array(60).fill(0), displayed: new Array(60).fill(0), scale: 0 },
    },
    targets: { total: 0, origin: 0, cached: 0, mitigated: 0 },
    currentValues: { total: 0, origin: 0, cached: 0, mitigated: 0 },
    mouseX: -1,
    lastTickTime: 0,
    isFirstFetch: true,
    currentMaxVal: 10,
    activeLines: new Set(['total'])
  });

  useEffect(() => {
    animState.current.activeLines = activeLines;
  }, [activeLines]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) handleUser(session.user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) handleUser(session.user);
      else setCurrentUser(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  function handleUser(user) {
    setCurrentUser(user);
    const meta = user.user_metadata || {};
    const dName = meta.display_name || user.email.split('@')[0];
    const avatarUrl = meta.avatar_url || '';
    
    setProfile({
      displayName: dName,
      username: meta.username || '',
      email: user.email,
      avatar: avatarUrl
    });
    setInpDisplayName(meta.display_name || '');
    setInpUsername(meta.username || '');
  }

  useEffect(() => {
    if (activeView !== 'home') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const tooltipEl = tooltipRef.current;
    let animationFrameId;
    let tickIntervalId;
    let fetchIntervalId;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }

    function lerp(a, b, t) {
      return a + (b - a) * t;
    }

    function formatRPS(val) {
      if (val >= 10) return Math.round(val).toLocaleString('en-US');
      return val.toFixed(1);
    }

    function hexToRgb(hex) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `${r},${g},${b}`;
    }

    function drawLine(points, color, scale, w, h, pad, maxVal, gh, shiftX) {
      if (points.length < 2) return;
      const segmentWidth = (w - pad.left - pad.right) / 59;
      const coords = points.map((val, i) => ({
        x: pad.left + i * segmentWidth - shiftX,
        y: pad.top + gh - (Math.max(val, 0) / maxVal) * gh,
        value: val
      }));

      ctx.save();
      ctx.beginPath();
      ctx.rect(pad.left, pad.top, w - pad.left - pad.right, gh);
      ctx.clip();

      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + gh);
      const rgb = hexToRgb(color);
      grad.addColorStop(0, `rgba(${rgb}, ${0.12 * scale})`);
      grad.addColorStop(0.7, `rgba(${rgb}, ${0.02 * scale})`);
      grad.addColorStop(1, `rgba(${rgb}, 0)`);

      ctx.beginPath();
      ctx.moveTo(coords[0].x, pad.top + gh);
      ctx.lineTo(coords[0].x, coords[0].y);
      for (let i = 1; i < coords.length; i++) {
        const p = coords[i - 1];
        const c = coords[i];
        const cx1 = p.x + (c.x - p.x) * 0.35;
        const cx2 = p.x + (c.x - p.x) * 0.65;
        ctx.bezierCurveTo(cx1, p.y, cx2, c.y, c.x, c.y);
      }
      ctx.lineTo(coords[coords.length - 1].x, pad.top + gh);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(coords[0].x, coords[0].y);
      for (let i = 1; i < coords.length; i++) {
        const p = coords[i - 1];
        const c = coords[i];
        const cx1 = p.x + (c.x - p.x) * 0.35;
        const cx2 = p.x + (c.x - p.x) * 0.65;
        ctx.bezierCurveTo(cx1, p.y, cx2, c.y, c.x, c.y);
      }
      ctx.strokeStyle = `rgba(${rgb}, ${scale})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = `rgba(${rgb}, ${scale})`;
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();

      return coords;
    }

    function getMaxVal(state) {
      let max = 1;
      for (const key of state.activeLines) {
        const line = state.LINES[key];
        if (line.displayed.length > 0) max = Math.max(max, ...line.displayed);
      }
      return Math.max(Math.ceil(max / 10) * 10, 10);
    }

    function drawGraph(state, timeSinceLastTick) {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const pad = { top: 18, right: 16, bottom: 28, left: 100 };
      const gw = w - pad.left - pad.right;
      const gh = h - pad.top - pad.bottom;
      const maxVal = state.currentMaxVal;
      const yStepCount = 5;
      const yStep = maxVal / yStepCount;

      ctx.clearRect(0, 0, w, h);
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      for (let i = 0; i <= yStepCount; i++) {
        const val = Math.round(i * yStep * 10) / 10;
        const y = pad.top + gh - (val / maxVal) * gh;
        ctx.strokeStyle = 'rgba(255,255,255,0.035)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#4a5568';
        ctx.fillText(formatRPS(val) + ' RPS', pad.left - 8, y);
      }

      const allCoords = {};
      const drawOrder = ['mitigated', 'cached', 'origin', 'total'];
      const segmentWidth = gw / 59;
      const shiftX = Math.min(timeSinceLastTick / 1000, 1) * segmentWidth;

      for (const key of drawOrder) {
        const line = state.LINES[key];
        if (line.scale <= 0) continue;
        const coords = drawLine(line.displayed, line.color, line.scale, w, h, pad, maxVal, gh, shiftX);
        allCoords[key] = coords;
      }

      if (state.mouseX >= pad.left && state.mouseX <= w - pad.right) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.moveTo(state.mouseX, pad.top);
        ctx.lineTo(state.mouseX, pad.top + gh);
        ctx.stroke();
        ctx.setLineDash([]);

        let tooltipParts = [];
        for (const key of drawOrder) {
          if (state.LINES[key].scale <= 0 || !allCoords[key]) continue;
          const coords = allCoords[key];
          let closestPt = coords[0];
          let minDist = Infinity;
          for (const pt of coords) {
            const dist = Math.abs(pt.x - state.mouseX);
            if (dist < minDist) { minDist = dist; closestPt = pt; }
          }
          if (closestPt) {
            ctx.beginPath();
            ctx.arc(closestPt.x, closestPt.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#0c0f14';
            ctx.fill();
            ctx.strokeStyle = state.LINES[key].color;
            ctx.lineWidth = 2;
            ctx.stroke();
            tooltipParts.push(`<span style="color:${state.LINES[key].color}">●</span> ${state.LINES[key].label}: ${closestPt.value.toFixed(1)} RPS`);
          }
        }
        if (tooltipParts.length > 0 && tooltipEl) {
          tooltipEl.innerHTML = tooltipParts.join('<br>');
          let tx = state.mouseX + 16;
          let ty = pad.top + 10;
          if (tx + 200 > w) tx = state.mouseX - 210;
          tooltipEl.style.left = tx + 'px';
          tooltipEl.style.top = ty + 'px';
          tooltipEl.classList.add('visible');
        }
      } else {
        if (tooltipEl) tooltipEl.classList.remove('visible');
      }
    }

    function tick() {
      const state = animState.current;
      for (const key in state.targets) {
        const noiseRange = Math.max(state.currentValues[key] * 0.03, 0.1);
        const noise = state.currentValues[key] > 0 ? (Math.random() - 0.5) * noiseRange : 0;
        const val = state.currentValues[key] + noise;
        const finalVal = val < 0 ? 0 : val;
        const line = state.LINES[key];
        line.data.push(finalVal);
        const prevDisplayed = line.displayed.length > 0 ? line.displayed[line.displayed.length - 1] : finalVal;
        line.displayed.push(prevDisplayed);
        if (line.data.length > 60) {
          line.data.shift();
          line.displayed.shift();
        }
      }
      const activeLineKey = Array.from(state.activeLines)[0] || 'total';
      const lastVal = state.currentValues[activeLineKey] || 0;
      setLegendVal(lastVal);
      state.lastTickTime = performance.now();
    }

    function animLoop(timestamp) {
      const state = animState.current;
      if (!state.lastTickTime) state.lastTickTime = timestamp;
      const timeSinceLastTick = timestamp - state.lastTickTime;
      const targetMaxVal = getMaxVal(state);
      if (Math.abs(state.currentMaxVal - targetMaxVal) > 0.05) {
        state.currentMaxVal = lerp(state.currentMaxVal, targetMaxVal, 0.05);
      } else {
        state.currentMaxVal = targetMaxVal;
      }

      for (const key in state.LINES) {
        const line = state.LINES[key];
        const targetScale = state.activeLines.has(key) ? 1 : 0;
        if (Math.abs(line.scale - targetScale) > 0.005) {
          line.scale = lerp(line.scale, targetScale, 0.08);
        } else {
          line.scale = targetScale;
        }
        for (let i = 0; i < line.displayed.length; i++) {
          line.displayed[i] = lerp(line.displayed[i], line.data[i], 0.08);
        }
      }
      for (const key in state.targets) {
        state.currentValues[key] = lerp(state.currentValues[key], state.targets[key], 0.04);
      }

      drawGraph(state, timeSinceLastTick);
      animationFrameId = requestAnimationFrame(animLoop);
    }

    async function fetchStats() {
      try {
        const res = await fetch('/api/stats');
        const json = await res.json();
        const state = animState.current;
        if (json.current) {
          state.targets.total = json.current.total || 0;
          state.targets.origin = json.current.origin || 0;
          state.targets.cached = json.current.cached || 0;
          state.targets.mitigated = json.current.mitigated || 0;
          if (state.isFirstFetch) {
            state.isFirstFetch = false;
            for (const key in state.targets) {
              state.currentValues[key] = state.targets[key];
              state.LINES[key].data = new Array(60).fill(state.targets[key]);
              state.LINES[key].displayed = [...state.LINES[key].data];
            }
            state.currentMaxVal = getMaxVal(state);
          }
        }
      } catch (e) {}
    }

    const onMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      animState.current.mouseX = e.clientX - rect.left;
    };
    const onMouseLeave = () => {
      animState.current.mouseX = -1;
      if (tooltipEl) tooltipEl.classList.remove('visible');
    };

    window.addEventListener('resize', resize);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);

    resize();
    fetchStats().then(() => {
      tickIntervalId = setInterval(tick, 1000);
      fetchIntervalId = setInterval(fetchStats, 4000);
      animationFrameId = requestAnimationFrame(animLoop);
    });

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      clearInterval(tickIntervalId);
      clearInterval(fetchIntervalId);
      cancelAnimationFrame(animationFrameId);
    };
  }, [activeView]);

  function toggleLine(line) {
    setActiveLines(prev => {
      const next = new Set(prev);
      if (line === 'total') {
        next.clear();
        next.add('total');
      } else {
        next.delete('total');
        if (next.has(line)) next.delete(line);
        else next.add(line);
        if (next.size === 0) next.add('total');
      }
      return next;
    });
  }

  const copyUrl = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText('https://dstat.tuanhaisite.space/unprotected');
    alert('Copied URL');
  };

  const handleLogin = async () => {
    setLoginErr('');
    const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPass });
    if (error) setLoginErr(error.message);
    else setAuthModalOpen(false);
  };

  const handleRegister = async () => {
    setRegErr(''); setRegSucc('');
    const { data, error } = await supabase.auth.signUp({ email: regEmail, password: regPass });
    if (error) setRegErr(error.message);
    else setRegSucc('Registration successful. Please log in.');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setActiveView('home');
  };

  const updateProfile = async () => {
    const { error } = await supabase.auth.updateUser({ data: { display_name: inpDisplayName, username: inpUsername } });
    if (!error) alert('Profile updated successfully!');
    else alert('Error: ' + error.message);
  };

  const updatePassword = async () => {
    if (!inpPassword) return;
    const { error } = await supabase.auth.updateUser({ password: inpPassword });
    if (!error) {
      alert('Password updated successfully!');
      setInpPassword('');
    } else alert('Error: ' + error.message);
  };

  const uploadAvatar = async (e) => {
    const file = e.target.files[0];
    if (!file || !currentUser) return;
    const fileExt = file.name.split('.').pop();
    const filePath = `${currentUser.id}/avatar.${fileExt}`;
    const { error: uploadError } = await supabase.storage.from('avatar').upload(filePath, file, { upsert: true });
    if (uploadError) return alert('Error uploading avatar: ' + uploadError.message);
    const { data } = supabase.storage.from('avatar').getPublicUrl(filePath);
    await supabase.auth.updateUser({ data: { avatar_url: data.publicUrl } });
    setProfile(p => ({ ...p, avatar: data.publicUrl }));
    alert('Avatar updated!');
  };

  return (
    <div className="app-layout">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="dot"></div>
          DSTAT
        </div>
        <nav className="sidebar-nav">
          <button className={`nav-item ${activeView==='home'?'active':''}`} onClick={() => setActiveView('home')}>
            <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
            Home
          </button>
          {currentUser && (
            <button className={`nav-item ${activeView==='profile'?'active':''}`} onClick={() => setActiveView('profile')}>
              <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
              Profile
            </button>
          )}
        </nav>
        <div className="sidebar-user">
          {!currentUser ? (
            <button className="btn btn-outline" style={{width: '100%'}} onClick={() => setAuthModalOpen(true)}>Log in</button>
          ) : (
            <div className="user-card" onClick={() => setActiveView('profile')}>
              <div className="avatar">
                {profile.avatar ? <img src={profile.avatar} style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}}/> : profile.displayName.charAt(0).toUpperCase()}
              </div>
              <div className="user-info">
                <span className="user-name">{profile.displayName}</span>
                <span className="user-role">Free Plan</span>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <div className="main-content">
        <header className="topbar">
          <div className="page-title">Layer 7 Dstat</div>
          <div className="topbar-right">
            {!currentUser ? (
              <button className="btn btn-primary" onClick={() => setAuthModalOpen(true)}>Log in</button>
            ) : (
              <div className="user-card" style={{background: 'transparent', padding: 0}} onClick={() => setActiveView('profile')}>
                <div className="avatar" style={{width: 32, height: 32}}>
                  {profile.avatar ? <img src={profile.avatar} style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}}/> : profile.displayName.charAt(0).toUpperCase()}
                </div>
                <span className="user-name" style={{maxWidth: 100}}>{profile.displayName}</span>
              </div>
            )}
          </div>
        </header>

        {activeView === 'home' && (
          <section className="view-section active">
            <div className="top-section" style={{marginBottom: 24, textAlign: 'left'}}>
              <div className={`dropdown ${dropdownOpen ? 'show' : ''}`}>
                <div className="url-line" onClick={() => setDropdownOpen(!dropdownOpen)}>
                  <div className="url-dot"></div>
                  <span className="url-text">https://dstat.tuanhaisite.space/unprotected</span>
                  <span className="copy-icon" title="Copy URL" onClick={copyUrl}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </span>
                </div>
                <div className="dropdown-content">
                  <div className="dropdown-item active" onClick={() => window.open('https://dstat.tuanhaisite.space/unprotected', '_blank')}>
                    <div className="url-dot"></div> unprotected
                  </div>
                </div>
              </div>
            </div>

            <div className="graph-card">
              <div className="watermark">TUANHAI</div>
              <div className="toggle-row">
                <button className={`toggle-btn ${activeLines.has('total')?'active':''}`} style={{'--btn-color':'#00e87b'}} onClick={() => toggleLine('total')}><span className="dot"></span>Total</button>
                <button className={`toggle-btn ${activeLines.has('origin')?'active':''}`} style={{'--btn-color':'#5b9aff'}} onClick={() => toggleLine('origin')}><span className="dot"></span>Served by Origin</button>
                <button className={`toggle-btn ${activeLines.has('cached')?'active':''}`} style={{'--btn-color':'#f5a623'}} onClick={() => toggleLine('cached')}><span className="dot"></span>Served by Cloudflare</button>
                <button className={`toggle-btn ${activeLines.has('mitigated')?'active':''}`} style={{'--btn-color':'#ff5c5c'}} onClick={() => toggleLine('mitigated')}><span className="dot"></span>Mitigated by Cloudflare</button>
              </div>
              <div className="graph-header">
                <div className="graph-title"><div className="graph-title-icon"></div>Requests Per Second</div>
                <div className="graph-legend">Current: <span className="legend-value">{legendVal >= 10 ? Math.round(legendVal).toLocaleString() : legendVal.toFixed(1)} RPS</span></div>
              </div>
              <div className="graph-wrapper">
                <canvas ref={canvasRef}></canvas>
                <div className="tooltip" ref={tooltipRef}></div>
              </div>
            </div>
          </section>
        )}

        {activeView === 'profile' && currentUser && (
          <section className="view-section active">
            <div className="profile-card">
              <div className="profile-header">
                <div className="profile-avatar-wrap" onClick={() => document.getElementById('avatarInput').click()}>
                  {profile.avatar ? <img src={profile.avatar} alt="Avatar" /> : <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',background:'#2a3040'}}>{profile.displayName.charAt(0)}</div>}
                  <div className="profile-avatar-overlay">
                    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                  </div>
                </div>
                <div>
                  <h2 className="page-title" style={{marginBottom: 4}}>{profile.displayName}</h2>
                  <div style={{color: 'var(--text-dim)', fontSize: 13}}>{profile.email}</div>
                </div>
                <input type="file" id="avatarInput" accept="image/*" style={{display: 'none'}} onChange={uploadAvatar} />
              </div>

              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32}}>
                <div>
                  <h3 style={{marginBottom: 16, fontSize: 16}}>General Information</h3>
                  <div className="form-group">
                    <label className="form-label">Display Name</label>
                    <input type="text" className="form-input" value={inpDisplayName} onChange={e=>setInpDisplayName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Username</label>
                    <input type="text" className="form-input" value={inpUsername} onChange={e=>setInpUsername(e.target.value)} />
                  </div>
                  <button className="btn btn-primary" onClick={updateProfile}>Save Changes</button>
                </div>
                <div>
                  <h3 style={{marginBottom: 16, fontSize: 16}}>Security</h3>
                  <div className="form-group">
                    <label className="form-label">New Password</label>
                    <input type="password" className="form-input" placeholder="Leave blank to keep current" value={inpPassword} onChange={e=>setInpPassword(e.target.value)} />
                  </div>
                  <button className="btn btn-outline" onClick={updatePassword}>Update Password</button>
                  <div style={{marginTop: 32, paddingTop: 32, borderTop: '1px solid var(--bg-card-border)'}}>
                    <button className="btn btn-outline" style={{color: 'var(--red)', borderColor: 'rgba(255,92,92,0.3)'}} onClick={handleLogout}>Sign Out</button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* AUTH MODAL */}
      {authModalOpen && (
        <div className="modal-overlay show" onClick={(e) => e.target.className.includes('modal-overlay') && setAuthModalOpen(false)}>
          <div className="modal">
            <div className="modal-header">
              <h2 className="modal-title">Welcome to Dstat</h2>
              <p className="modal-subtitle">Log in or create an account to continue</p>
            </div>
            <div className="modal-tabs">
              <div className={`modal-tab ${authTab==='login'?'active':''}`} onClick={()=>setAuthTab('login')}>Log In</div>
              <div className={`modal-tab ${authTab==='register'?'active':''}`} onClick={()=>setAuthTab('register')}>Register</div>
            </div>

            {authTab === 'login' && (
              <div>
                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input type="email" className="form-input" placeholder="you@example.com" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Password</label>
                  <input type="password" className="form-input" placeholder="••••••••" value={loginPass} onChange={e=>setLoginPass(e.target.value)} />
                </div>
                {loginErr && <div style={{color: 'var(--red)', fontSize: 12, marginBottom: 16}}>{loginErr}</div>}
                <button className="btn btn-primary" style={{width: '100%'}} onClick={handleLogin}>Log In</button>
              </div>
            )}

            {authTab === 'register' && (
              <div>
                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input type="email" className="form-input" placeholder="you@example.com" value={regEmail} onChange={e=>setRegEmail(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Password</label>
                  <input type="password" className="form-input" placeholder="••••••••" value={regPass} onChange={e=>setRegPass(e.target.value)} />
                </div>
                {regErr && <div style={{color: 'var(--red)', fontSize: 12, marginBottom: 16}}>{regErr}</div>}
                {regSucc && <div style={{color: 'var(--green)', fontSize: 12, marginBottom: 16}}>{regSucc}</div>}
                <button className="btn btn-primary" style={{width: '100%'}} onClick={handleRegister}>Sign Up</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
