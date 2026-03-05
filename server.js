/**
 * LANNGOOD.ID — Backend Server v3
 * Powered by yt-dlp | Node.js + Express
 * Compatible with Pterodactyl Panel
 */

const express  = require('express');
const { exec, execSync, spawn } = require('child_process');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const crypto   = require('crypto');
const https    = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── TEMP DIR ──────────────────────────────────────────────────────
const TEMP_DIR = path.join(os.tmpdir(), 'lanngood_dl');
fs.mkdirSync(TEMP_DIR, { recursive: true });

// ── MIDDLEWARE ────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Serve frontend
const PUBLIC_DIRS = [path.join(__dirname, 'public'), path.join(__dirname)];
PUBLIC_DIRS.forEach(d => { if (fs.existsSync(d)) app.use(express.static(d)); });

app.get('/', (req, res) => {
  for (const d of PUBLIC_DIRS) {
    const f = path.join(d, 'index.html');
    if (fs.existsSync(f)) return res.sendFile(f);
  }
  res.send('<h1>LANNGOOD.ID</h1><p>Letakkan index.html di folder yang sama dengan server.js</p>');
});

// ══════════════════════════════════════════════════════════════════
//  YT-DLP DETECTION & AUTO-SETUP
// ══════════════════════════════════════════════════════════════════

let YTDLP_BIN     = null;
let YTDLP_VERSION = null;

function detectYtDlp() {
  const candidates = [
    path.join(__dirname, 'yt-dlp'),
    path.join(__dirname, 'yt-dlp.exe'),
    path.join(__dirname, 'bin', 'yt-dlp'),
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    '/home/container/yt-dlp',
    '/root/.local/bin/yt-dlp',        // pip install --user
    '/nix/var/nix/profiles/default/bin/yt-dlp',  // Railway Nix
    '/usr/local/lib/python3.11/dist-packages/yt_dlp/__main__.py',
    'yt-dlp',
  ];

  for (const bin of candidates) {
    try {
      const v = execSync(`"${bin}" --version 2>&1`, { timeout: 5000 }).toString().trim();
      if (v && /\d{4}\.\d{2}/.test(v)) {
        YTDLP_BIN = bin; YTDLP_VERSION = v;
        console.log(`  ✅ yt-dlp: ${bin} (v${v})`);
        return true;
      }
    } catch {}
  }

  // Try via python3
  try {
    const v = execSync('python3 -m yt_dlp --version 2>&1', { timeout: 5000 }).toString().trim();
    if (v && /\d{4}/.test(v)) {
      YTDLP_BIN = 'python3 -m yt_dlp'; YTDLP_VERSION = v;
      console.log(`  ✅ yt-dlp via python3: v${v}`);
      return true;
    }
  } catch {}

  // Try via pip
  try {
    execSync('pip install yt-dlp -q', { timeout: 60000 });
    const v = execSync('yt-dlp --version 2>&1', { timeout: 5000 }).toString().trim();
    if (v) { YTDLP_BIN = 'yt-dlp'; YTDLP_VERSION = v; return true; }
  } catch {}

  console.warn('  ⚠  yt-dlp TIDAK ditemukan!');
  return false;
}

// Auto-download binary (Linux)
function autoInstallYtDlp(cb) {
  if (os.platform() === 'win32') return cb(false);
  const dest = path.join(__dirname, 'yt-dlp');
  console.log('  ⬇  Downloading yt-dlp...');
  const file = fs.createWriteStream(dest);

  function download(url, redirectCount = 0) {
    if (redirectCount > 5) return cb(false);
    https.get(url, { headers: { 'User-Agent': 'lanngood-installer' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location, redirectCount + 1);
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          try {
            execSync(`chmod +x "${dest}"`);
            const v = execSync(`"${dest}" --version`, { timeout: 5000 }).toString().trim();
            YTDLP_BIN = dest; YTDLP_VERSION = v;
            console.log('  ✅ yt-dlp auto-install berhasil! v' + v);
            cb(true);
          } catch { cb(false); }
        });
      });
    }).on('error', () => cb(false));
  }
  download('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp');
}

// ── FFMPEG DETECTION ─────────────────────────────────────────────

let FFMPEG_AVAILABLE = false;
let FFMPEG_PATH      = 'ffmpeg';
let FFMPEG_DIR       = '';  // folder ffmpeg untuk --ffmpeg-location

function detectFfmpeg() {
  // Cek kandidat — prioritaskan yang ada di folder project (Windows-friendly)
  const candidates = [
    path.join(__dirname, 'ffmpeg.exe'),
    path.join(__dirname, 'ffmpeg'),
    path.join(__dirname, 'bin', 'ffmpeg.exe'),
    path.join(__dirname, 'bin', 'ffmpeg'),
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    '/nix/var/nix/profiles/default/bin/ffmpeg',  // Railway Nix
    'ffmpeg',
  ];

  for (const bin of candidates) {
    try {
      const vOut = execSync(`"${bin}" -version 2>&1`, { timeout: 5000 }).toString();
      if (!vOut.includes('ffmpeg version')) continue;
      FFMPEG_AVAILABLE = true;
      FFMPEG_PATH      = bin;
      // --ffmpeg-location = FOLDER tempat ffmpeg.exe berada (bukan path file-nya!)
      FFMPEG_DIR       = path.dirname(path.resolve(bin));
      console.log(`  ✅ ffmpeg: ${path.resolve(bin)}`);
      console.log(`  📁 ffmpeg dir: ${FFMPEG_DIR}`);
      return true;
    } catch {}
  }

  // Coba via PATH tanpa path absolut
  try {
    const vOut = execSync('ffmpeg -version 2>&1', { timeout: 5000 }).toString();
    if (vOut.includes('ffmpeg version')) {
      FFMPEG_AVAILABLE = true;
      FFMPEG_PATH      = 'ffmpeg';
      FFMPEG_DIR       = '';   // biarkan yt-dlp temukan sendiri via PATH
      console.log('  ✅ ffmpeg ditemukan di PATH');
      return true;
    }
  } catch {}

  console.warn('  ⚠  ffmpeg tidak ditemukan!');
  console.warn(`     Taruh ffmpeg.exe di: ${__dirname}`);
  return false;
}

// ── HELPERS ───────────────────────────────────────────────────────

function sanitize(name) {
  // Strip non-ASCII (emoji, unicode) dan karakter ilegal HTTP header
  return (name || '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/, '')
    .substring(0, 80) || 'lanngood_video';
}

function buildFormatStr(fmt, quality) {
  if (fmt === 'mp3') return null;
  const q = quality && quality !== 'best' ? quality : null;
  if (fmt === 'webm') return q
    ? `bestvideo[ext=webm][height<=${q}]+bestaudio[ext=webm]/best[height<=${q}]/best`
    : 'bestvideo[ext=webm]+bestaudio[ext=webm]/best';
  if (fmt === 'best') return q
    ? `bestvideo[height<=${q}]+bestaudio/best[height<=${q}]/best`
    : 'bestvideo+bestaudio/best';
  return q
    ? `bestvideo[ext=mp4][height<=${q}]+bestaudio[ext=m4a]/bestvideo[height<=${q}]+bestaudio/best[height<=${q}]/best`
    : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best';
}

function cleanupOld() {
  try {
    const now = Date.now();
    fs.readdirSync(TEMP_DIR).forEach(f => {
      const fp = path.join(TEMP_DIR, f);
      if (now - fs.statSync(fp).mtimeMs > 20 * 60 * 1000) fs.unlinkSync(fp);
    });
  } catch {}
}
setInterval(cleanupOld, 10 * 60 * 1000);

function requireYtDlp(req, res, next) {
  if (YTDLP_BIN) return next();
  res.status(503).json({
    error: 'yt-dlp belum terinstall',
    ytdlp_missing: true,
    hint: 'pip install yt-dlp',
  });
}

// ══════════════════════════════════════════════════════════════════
//  API ROUTES
// ══════════════════════════════════════════════════════════════════

app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  service: 'LANNGOOD.ID v3',
  ytdlp: YTDLP_BIN ? `ready (${YTDLP_VERSION})` : 'NOT FOUND',
  ytdlp_ready: !!YTDLP_BIN,
  uptime: Math.floor(process.uptime()),
}));

app.get('/api/status', (req, res) => res.json({
  ytdlp_ready: !!YTDLP_BIN,
  version: YTDLP_VERSION,
  ffmpeg_ready: FFMPEG_AVAILABLE,
}));

// ── GET VIDEO INFO ────────────────────────────────────────────────
app.post('/api/info', requireYtDlp, (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL wajib diisi' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Format URL salah' }); }

  const safeUrl = url.replace(/["`]/g, '');
  const cmd     = `"${YTDLP_BIN}" --no-warnings --dump-json --no-playlist "${safeUrl}"`;

  exec(cmd, { timeout: 35000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      const msg = (stderr || err.message || '').toLowerCase();
      if (msg.includes('unsupported url') || msg.includes('not supported'))
        return res.status(400).json({ error: 'URL tidak didukung' });
      if (msg.includes('private'))
        return res.status(400).json({ error: 'Video bersifat privat' });
      if (msg.includes('404') || msg.includes('not found'))
        return res.status(404).json({ error: 'Video tidak ditemukan' });
      return res.status(500).json({ error: (stderr || err.message).slice(0, 200) });
    }
    try {
      const info = JSON.parse(stdout.trim().split('\n')[0]);
      res.json({ title: info.title || 'Video', uploader: info.uploader || info.channel || '', thumbnail: info.thumbnail || '' });
    } catch {
      res.json({ title: 'Video', uploader: '', thumbnail: '' });
    }
  });
});

// ── DOWNLOAD VIDEO ────────────────────────────────────────────────
app.post('/api/download', requireYtDlp, (req, res) => {
  const { url, format = 'mp4', quality = 'best' } = req.body;
  if (!url) return res.status(400).json({ error: 'URL wajib diisi' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Format URL salah' }); }

  cleanupOld();

  const uid     = crypto.randomBytes(8).toString('hex');
  const outTpl  = path.join(TEMP_DIR, `${uid}_%(title).60s.%(ext)s`);
  const safeUrl = url.replace(/["`]/g, '');
  const fmtStr  = buildFormatStr(format, quality);

  // Build args berbeda untuk MP3 vs video
  let args;

  if (format === 'mp3') {
    if (FFMPEG_AVAILABLE) {
      // ffmpeg ada — convert langsung ke MP3
      args = [
        '--no-warnings', '--no-playlist', '--no-progress',
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '192K',
        // --ffmpeg-location = direktori tempat ffmpeg.exe (BUKAN path file-nya)
        ...(FFMPEG_DIR !== '' ? ['--ffmpeg-location', FFMPEG_DIR] : []),
        '-o', outTpl,
      ];
    } else {
      // ffmpeg tidak ada — download audio native terbaik (m4a/aac)
      // m4a bisa langsung diputar di semua browser & device
      args = [
        '--no-warnings', '--no-playlist', '--no-progress',
        '-f', 'bestaudio[ext=m4a]/bestaudio[ext=aac]/bestaudio/best',
        '-o', outTpl,
      ];
    }
  } else {
    // Mode video
    const mergeExt = format === 'webm' ? 'webm' : (format === 'best' ? 'mkv' : 'mp4');
    args = [
      '--no-warnings', '--no-playlist', '--no-progress',
      '--merge-output-format', mergeExt,
      '-o', outTpl,
    ];
    if (fmtStr) args.push('-f', fmtStr);
  }

  // TikTok header
  if (safeUrl.includes('tiktok.com')) {
    args.push('--add-header', 'Referer:https://www.tiktok.com/');
  }

  args.push(safeUrl);

  let spawnCmd, spawnArgs;
  if (YTDLP_BIN.startsWith('python3')) {
    spawnCmd  = 'python3';
    spawnArgs = ['-m', 'yt_dlp', ...args];
  } else {
    spawnCmd  = YTDLP_BIN;
    spawnArgs = args;
  }

  console.log(`[DL] ${spawnCmd} ${spawnArgs.slice(0, 4).join(' ')} ...`);

  const proc = spawn(spawnCmd, spawnArgs);
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d.toString(); });
  proc.stdout.on('data', () => {});

  proc.on('error', err => {
    console.error('[SPAWN ERR]', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Gagal menjalankan yt-dlp: ' + err.message });
  });

  proc.on('close', code => {
    if (code !== 0) {
      if (!res.headersSent) {
        const msg = stderr.toLowerCase();
        let errText = 'Download gagal';
        if (msg.includes('unsupported url')) errText = 'URL tidak didukung';
        else if (msg.includes('private'))    errText = 'Video bersifat privat';
        else if (msg.includes('geo'))        errText = 'Video dibatasi wilayah';
        else if (msg.includes('404'))        errText = 'Video tidak ditemukan';
        else if (msg.includes('ffmpeg'))     errText = 'ffmpeg tidak ditemukan di server — install ffmpeg dulu';
        else if (msg.includes('postprocessor')) errText = 'Konversi audio gagal — ffmpeg diperlukan';
        console.error('[STDERR]', stderr.slice(0, 400));
        return res.status(500).json({ error: errText, detail: stderr.slice(0, 300) });
      }
      return;
    }

    const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(uid));
    if (!files.length) {
      if (!res.headersSent) return res.status(500).json({ error: 'File output tidak ditemukan' });
      return;
    }

    const filePath = path.join(TEMP_DIR, files[0]);
    // ext dari file aktual (bisa mp3, m4a, mp4, dll)
    let ext = path.extname(files[0]).replace('.', '').toLowerCase();
    if (!ext) ext = format === 'mp3' ? 'mp3' : 'mp4';

    // Untuk MP3 request: paksa nama file berakhiran .mp3
    const rawName  = files[0].replace(`${uid}_`, '');
    const baseName = rawName.replace(/\.[^.]+$/, '');   // hapus extension lama
    // Tentukan extension final
    let finalExt;
    if (format === 'mp3' && FFMPEG_AVAILABLE) {
      finalExt = 'mp3';
    } else if (format === 'mp3' && !FFMPEG_AVAILABLE) {
      // Tanpa ffmpeg: file adalah audio native (m4a/aac/webm)
      finalExt = ext || 'm4a';
    } else {
      finalExt = ext || format;
    }
    const safeName = (sanitize(baseName) || 'lanngood_video') + '.' + finalExt;

    const MIME = {
      mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
      mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/opus',
    };

    // Tambah header info format aktual (berguna untuk frontend)
    res.setHeader('X-Actual-Format', finalExt);
    res.setHeader('X-Ffmpeg-Available', FFMPEG_AVAILABLE ? 'true' : 'false');
    res.setHeader('Content-Type', MIME[finalExt] || MIME[ext] || 'application/octet-stream');
    // Encode filename for Content-Disposition (RFC 5987) — prevents ERR_INVALID_CHAR
    const encodedName = encodeURIComponent(safeName).replace(/[()]/g, escape);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`);
    res.setHeader('Content-Length', fs.statSync(filePath).size);

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    const cleanup = () => { try { fs.unlinkSync(filePath); } catch {} };
    stream.on('end', () => setTimeout(cleanup, 3000));
    res.on('close', cleanup);
  });
});

app.use((req, res) => res.status(404).json({ error: 'Tidak ditemukan' }));
app.use((err, req, res, next) => {
  console.error('[ERR]', err);
  if (!res.headersSent) res.status(500).json({ error: 'Server error' });
});

// ══════════════════════════════════════════════════════════════════
//  STARTUP
// ══════════════════════════════════════════════════════════════════
(async function start() {
  console.log(`\n  ╔═══════════════════════════════╗`);
  console.log(`  ║  LANNGOOD.ID Server v3        ║`);
  console.log(`  ╚═══════════════════════════════╝`);

  const found = detectYtDlp();
  detectFfmpeg();
  if (!found) {
    console.log('  🔄 Mencoba auto-install yt-dlp...');
    await new Promise(resolve => autoInstallYtDlp(ok => {
      if (!ok) console.log('\n  ❗ Install manual:\n     pip install yt-dlp\n     lalu restart server\n');
      resolve();
    }));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  🚀 http://0.0.0.0:${PORT}`);
    console.log(`  📦 yt-dlp: ${YTDLP_BIN ? '✅ ' + YTDLP_VERSION : '❌ tidak ditemukan'}\n`);
  });
})();

module.exports = app;