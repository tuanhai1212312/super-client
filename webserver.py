import os
import re
import sys
import json
import time
import yaml
import logging
import threading
import subprocess
import collections
import secrets
from flask import (
    Flask, render_template, request, redirect,
    url_for, session, jsonify, Response
)
from functools import wraps

# Suppress Flask/Werkzeug access logs
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET', secrets.token_hex(32))

# ── Bot process state ────────────────────────────────────────────────────────
bot_process = None
bot_lock = threading.Lock()

# ── Stats ─────────────────────────────────────────────────────────────────────
_stats = {
    'giveaways': 0,
    'quests': 0,
    'bot_start_time': None,   # Unix timestamp when bot connected
}
_stats_lock = threading.Lock()

def _reset_stats():
    with _stats_lock:
        _stats['giveaways'] = 0
        _stats['quests'] = 0
        _stats['bot_start_time'] = None

def _update_stats_from_log(text: str):
    lower = text.lower()
    with _stats_lock:
        # Detect successful connection
        if 'connected |' in lower and _stats['bot_start_time'] is None:
            _stats['bot_start_time'] = time.time()
        # Giveaway joined
        if 'joined giveaway' in lower:
            _stats['giveaways'] += 1
        # Quest completed
        if '[✓]' in text and 'quest completed' in lower:
            _stats['quests'] += 1

# ── Log buffer (thread-safe) ─────────────────────────────────────────────────
_log_lines = []        # list of {"id": int, "text": str}
_log_counter = 0
_log_lock = threading.Lock()
_MAX_LOGS = 800

ANSI_RE = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')

def _push_log(text: str):
    global _log_counter
    text = ANSI_RE.sub('', text).strip()
    if not text:
        return
    _update_stats_from_log(text)
    with _log_lock:
        _log_counter += 1
        _log_lines.append({"id": _log_counter, "text": text})
        if len(_log_lines) > _MAX_LOGS:
            del _log_lines[:len(_log_lines) - _MAX_LOGS]


def _stream_proc(proc):
    buf = ''
    try:
        while True:
            chunk = proc.stdout.read(256)
            if not chunk:
                break
            buf += chunk.decode('utf-8', errors='replace')
            while '\n' in buf:
                line, buf = buf.split('\n', 1)
                # \r resets to start of line — take last non-empty segment
                segments = line.split('\r')
                text = ''
                for seg in reversed(segments):
                    cleaned = ANSI_RE.sub('', seg).strip()
                    if cleaned:
                        text = cleaned
                        break
                if text:
                    _push_log(text)
    finally:
        # flush remaining buffer
        if buf.strip():
            cleaned = ANSI_RE.sub('', buf.split('\r')[-1]).strip()
            if cleaned:
                _push_log(cleaned)
        proc.stdout.close()


# ── Config helpers ───────────────────────────────────────────────────────────
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.yml')

def read_config() -> dict:
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        data = yaml.safe_load(f) or {}
    return data

def write_config(cfg: dict):
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        yaml.dump(cfg, f, allow_unicode=True, sort_keys=False, default_flow_style=False)


def get_web_password() -> str:
    cfg = read_config()
    return cfg.get('web_password') or os.environ.get('WEB_PASSWORD', 'admin')


# ── Auth ─────────────────────────────────────────────────────────────────────
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated


# ── Bot control ──────────────────────────────────────────────────────────────
def bot_status() -> str:
    global bot_process
    if bot_process and bot_process.poll() is None:
        return 'running'
    return 'stopped'


def start_bot() -> tuple[bool, str]:
    global bot_process
    with bot_lock:
        if bot_process and bot_process.poll() is None:
            return False, 'Bot đang chạy rồi'
        _reset_stats()
        _push_log('─── Starting bot ───')
        try:
            bot_process = subprocess.Popen(
                [sys.executable, '-u', 'bot.py'],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=0,
                cwd=os.path.dirname(os.path.abspath(__file__))
            )
            t = threading.Thread(target=_stream_proc, args=(bot_process,), daemon=True)
            t.start()
            return True, 'Bot đã được khởi động'
        except Exception as e:
            return False, str(e)


def stop_bot() -> tuple[bool, str]:
    global bot_process
    with bot_lock:
        if not bot_process or bot_process.poll() is not None:
            return False, 'Bot không đang chạy'
        try:
            bot_process.terminate()
            try:
                bot_process.wait(timeout=6)
            except subprocess.TimeoutExpired:
                bot_process.kill()
            _push_log('─── Bot stopped ───')
            return True, 'Bot đã dừng'
        except Exception as e:
            return False, str(e)


# ── Routes ────────────────────────────────────────────────────────────────────
@app.route('/favicon.ico')
def favicon():
    return '', 204


@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        pw = request.form.get('password', '')
        if pw == get_web_password():
            session['logged_in'] = True
            session.permanent = True
            return redirect(url_for('dashboard'))
        error = 'Sai mật khẩu!'
    return render_template('login.html', error=error)


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


@app.route('/')
@login_required
def dashboard():
    cfg = read_config()
    username = cfg.get('token', '')[:10] + '...' if cfg.get('token') else 'Unknown'
    return render_template('dashboard.html', status=bot_status(), username=username)


@app.route('/settings')
@login_required
def settings():
    cfg = read_config()
    return render_template('settings.html', cfg=cfg)


# ── API: Bot control ──────────────────────────────────────────────────────────
@app.route('/api/bot/start', methods=['POST'])
@login_required
def api_start():
    ok, msg = start_bot()
    return jsonify({'ok': ok, 'msg': msg, 'status': bot_status()})


@app.route('/api/bot/stop', methods=['POST'])
@login_required
def api_stop():
    ok, msg = stop_bot()
    return jsonify({'ok': ok, 'msg': msg, 'status': bot_status()})


@app.route('/api/bot/restart', methods=['POST'])
@login_required
def api_restart():
    stop_bot()
    time.sleep(1)
    ok, msg = start_bot()
    return jsonify({'ok': ok, 'msg': msg, 'status': bot_status()})


@app.route('/api/bot/status')
@login_required
def api_status():
    return jsonify({'status': bot_status()})


# ── API: Stats ────────────────────────────────────────────────────────────────
@app.route('/api/stats')
@login_required
def api_stats():
    with _stats_lock:
        uptime_secs = int(time.time() - _stats['bot_start_time']) if _stats['bot_start_time'] else None
        return jsonify({
            'uptime_secs': uptime_secs,
            'giveaways': _stats['giveaways'],
            'quests': _stats['quests'],
        })


# ── API: Logs ─────────────────────────────────────────────────────────────────
@app.route('/api/logs')
@login_required
def api_logs():
    since = int(request.args.get('since', 0))
    with _log_lock:
        lines = [l for l in _log_lines if l['id'] > since]
    return jsonify({'lines': lines})


# ── API: Config ───────────────────────────────────────────────────────────────
@app.route('/api/config', methods=['GET'])
@login_required
def api_config_get():
    return jsonify(read_config())


@app.route('/api/config', methods=['POST'])
@login_required
def api_config_save():
    try:
        data = request.get_json(force=True)
        if not isinstance(data, dict):
            return jsonify({'ok': False, 'msg': 'Invalid data'}), 400

        cfg = _parse_config_form(data)
        write_config(cfg)

        # Reload bot config if running
        global bot_process
        was_running = bot_process and bot_process.poll() is None
        if was_running:
            _push_log('─── Config saved — restarting bot ───')
            stop_bot()
            time.sleep(1)
            start_bot()

        return jsonify({'ok': True, 'msg': 'Đã lưu config' + (' và restart bot' if was_running else '')})
    except Exception as e:
        return jsonify({'ok': False, 'msg': str(e)}), 500


def _parse_config_form(data: dict) -> dict:
    def to_bool(v):
        if isinstance(v, bool):
            return v
        return str(v).lower() in ('true', '1', 'yes', 'on')

    def to_int(v, default=0):
        try:
            return int(v)
        except (ValueError, TypeError):
            return default

    def to_float(v, default=0.0):
        try:
            return float(v)
        except (ValueError, TypeError):
            return default

    def clean_str(v):
        return str(v).strip() if v is not None else ''

    cfg = {}

    cfg['token'] = clean_str(data.get('token', ''))
    cfg['ip'] = clean_str(data.get('ip', 'default')) or 'default'

    if data.get('web_password'):
        cfg['web_password'] = clean_str(data['web_password'])
    else:
        existing = read_config()
        cfg['web_password'] = existing.get('web_password', 'admin')

    # custom_status
    cs_enabled = to_bool(data.get('custom_status_enabled', False))
    cs_delay = to_float(data.get('custom_status_delay', 2), 2)
    cs_data_raw = data.get('custom_status_data', [])
    if isinstance(cs_data_raw, str):
        cs_data_raw = [l.strip() for l in cs_data_raw.splitlines() if l.strip()]
    cs_data = [str(s) for s in cs_data_raw if str(s).strip()]

    if cs_enabled and cs_data:
        cfg['custom_status'] = {'delay': cs_delay, 'data': cs_data}
    # omit custom_status key entirely when disabled — bot cannot handle null value

    # rpc_config
    rpc_delay = to_float(data.get('rpc_delay', 5), 5)
    rpc_profiles_raw = data.get('rpc_profiles', [])
    rpc_profiles = []
    for p in rpc_profiles_raw:
        if not isinstance(p, dict):
            continue
        profile = {'type': clean_str(p.get('type', 'Spotify'))}
        t = profile['type']

        profile['title'] = clean_str(p.get('title', ''))
        profile['large_img'] = clean_str(p.get('large_img', ''))
        profile['small_img'] = clean_str(p.get('small_img', ''))
        profile['delay'] = to_float(p.get('delay', 3), 3)

        if t == 'Spotify':
            profile['artist'] = clean_str(p.get('artist', ''))
            profile['album'] = clean_str(p.get('album', ''))
            profile['duration'] = to_int(p.get('duration', 220), 220)
            profile['elapsed'] = to_int(p.get('elapsed', 0), 0)
        else:
            if p.get('line2'):
                profile['line2'] = clean_str(p.get('line2', ''))
            if p.get('line3'):
                profile['line3'] = clean_str(p.get('line3', ''))
            if t == 'Playing' and p.get('playing_time'):
                profile['playing_time'] = to_int(p.get('playing_time', 0), 0)

        if p.get('btn1_lbl'):
            profile['btn1_lbl'] = clean_str(p['btn1_lbl'])
            profile['btn1_url'] = clean_str(p.get('btn1_url', ''))
        if p.get('btn2_lbl'):
            profile['btn2_lbl'] = clean_str(p['btn2_lbl'])
            profile['btn2_url'] = clean_str(p.get('btn2_url', ''))

        rpc_profiles.append(profile)

    cfg['rpc_config'] = {'delay': rpc_delay, 'data': rpc_profiles}

    # giveaway_joiner
    cfg['giveaway_joiner'] = {
        'enabled': to_bool(data.get('giveaway_enabled', False)),
        'logging': to_bool(data.get('giveaway_logging', True))
    }

    # voice_config
    cfg['voice_config'] = {
        'enabled': to_bool(data.get('voice_enabled', False)),
        'guild_id': clean_str(data.get('voice_guild_id', '')),
        'channel_id': clean_str(data.get('voice_channel_id', ''))
    }

    # auto_quest
    cfg['auto_quest'] = {
        'enabled': to_bool(data.get('quest_enabled', True)),
        'logging': to_bool(data.get('quest_logging', True)),
        'check_interval': to_int(data.get('quest_interval', 3600), 3600)
    }

    # webhook_logging
    cfg['webhook_logging'] = {
        'enabled': to_bool(data.get('webhook_enabled', False)),
        'webhook_url': clean_str(data.get('webhook_url', ''))
    }

    return cfg


if __name__ == '__main__':
    _push_log('─── Web server started ───')
    # Auto-start bot on launch
    threading.Thread(target=lambda: (time.sleep(2), start_bot()), daemon=True).start()
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
