/**
 * LANNGOOD.ID — Backend Server v3 + HDR+
 * Powered by yt-dlp | Node.js + Express
 * Compatible with Pterodactyl Panel
 */

const express = require('express');
const { exec, execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const https = require('https');

const app = express();
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

let YTDLP_BIN = null;
let YTDLP_VERSION = null;

function detectYtDlp() {
  const candidates = [
    path.join(__dirname, 'yt-dlp'),
    path.join(__dirname, 'yt-dlp.exe'),
    path.join(__dirname, 'bin', 'yt-dlp'),
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    '/home/container/yt-dlp',
    '/root/.local/bin/yt-dlp',
    '/nix/var/nix/profiles/default/bin/yt-dlp',
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
    } catch { }
  }

  const pythons = ['python3.11', 'python3', 'python'];
  for (const py of pythons) {
    try {
      const v = execSync(`${py} -m yt_dlp --version 2>&1`, { timeout: 8000 }).toString().trim();
      if (v && /\d{4}/.test(v)) {
        YTDLP_BIN = `${py} -m yt_dlp`; YTDLP_VERSION = v;
        console.log(`  ✅ yt-dlp via ${py}: v${v}`);
        return true;
      }
    } catch { }
  }

  const pips = ['pip', 'pip3', 'pip3.11', 'python3.11 -m pip', 'python3 -m pip'];
  for (const pip of pips) {
    try {
      execSync(`${pip} install yt-dlp -q 2>&1`, { timeout: 60000 });
      const v = execSync('yt-dlp --version 2>&1', { timeout: 5000 }).toString().trim();
      if (v && /\d{4}/.test(v)) { YTDLP_BIN = 'yt-dlp'; YTDLP_VERSION = v; return true; }
    } catch { }
  }

  console.warn('  ⚠  yt-dlp TIDAK ditemukan!');
  return false;
}

function autoInstallYtDlp(cb) {
  if (os.platform() === 'win32') return cb(false);
  const dest = path.join(__dirname, 'yt-dlp');
  console.log('  ⬇  Downloading yt-dlp binary dari GitHub...');
  try { fs.unlinkSync(dest); } catch { }
  const file = fs.createWriteStream(dest);
  let finished = false;

  function download(url, redirectCount) {
    if (redirectCount > 10) { file.close(); return cb(false); }
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        return download(res.headers.location, redirectCount + 1);
      }
      if (res.statusCode !== 200) { file.close(); return cb(false); }
      res.pipe(file);
      file.on('finish', () => {
        if (finished) return;
        finished = true;
        file.close(() => {
          try {
            execSync('chmod +x "' + dest + '"');
            const v = execSync('"' + dest + '" --version 2>&1', { timeout: 8000 }).toString().trim();
            if (v && v.length > 0) { YTDLP_BIN = dest; YTDLP_VERSION = v; return cb(true); }
            cb(false);
          } catch (e) { cb(false); }
        });
      });
    }).on('error', () => cb(false));
  }
  download('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp', 0);
}

// ── FFMPEG DETECTION ─────────────────────────────────────────────

let FFMPEG_AVAILABLE = false;
let FFMPEG_PATH = 'ffmpeg';
let FFMPEG_DIR = '';

function detectFfmpeg() {
  const candidates = [
    path.join(__dirname, 'ffmpeg.exe'),
    path.join(__dirname, 'ffmpeg'),
    path.join(__dirname, 'bin', 'ffmpeg.exe'),
    path.join(__dirname, 'bin', 'ffmpeg'),
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    '/nix/var/nix/profiles/default/bin/ffmpeg',
    'ffmpeg',
  ];

  for (const bin of candidates) {
    try {
      const vOut = execSync(`"${bin}" -version 2>&1`, { timeout: 5000 }).toString();
      if (!vOut.includes('ffmpeg version')) continue;
      FFMPEG_AVAILABLE = true;
      FFMPEG_PATH = bin;
      FFMPEG_DIR = path.dirname(path.resolve(bin));
      console.log(`  ✅ ffmpeg: ${path.resolve(bin)}`);
      return true;
    } catch { }
  }

  try {
    const vOut = execSync('ffmpeg -version 2>&1', { timeout: 5000 }).toString();
    if (vOut.includes('ffmpeg version')) {
      FFMPEG_AVAILABLE = true;
      FFMPEG_PATH = 'ffmpeg';
      FFMPEG_DIR = '';
      console.log('  ✅ ffmpeg ditemukan di PATH');
      return true;
    }
  } catch { }

  console.warn('  ⚠  ffmpeg tidak ditemukan!');
  return false;
}

// ══════════════════════════════════════════════════════════════════
//  HDR+ — zscale / libzimg detection & conversion
// ══════════════════════════════════════════════════════════════════

let ZSCALE_AVAILABLE = false;
let HDR_TYPE = 'none'; // 'HDR10' | 'HDR+' | 'none'

function detectZscale() {
  if (!FFMPEG_AVAILABLE) {
    console.warn('  ⚠  HDR+ tidak tersedia (ffmpeg tidak ada)');
    return;
  }
  try {
    const bin = FFMPEG_PATH === 'ffmpeg' ? 'ffmpeg' : `"${FFMPEG_PATH}"`;
    const filters = execSync(`${bin} -filters 2>&1`, { timeout: 8000 }).toString();
    ZSCALE_AVAILABLE = filters.includes('zscale');
    if (ZSCALE_AVAILABLE) {
      HDR_TYPE = 'HDR10';
      console.log('  ✅ zscale (libzimg): tersedia → mode HDR10 (SMPTE ST 2084 / PQ)');
    } else {
      HDR_TYPE = 'HDR+';
      console.log('  ⚠  zscale tidak ditemukan → mode HDR+ (enhanced SDR)');
    }
  } catch {
    HDR_TYPE = 'HDR+';
    console.warn('  ⚠  Tidak bisa cek zscale, pakai HDR+ enhanced mode');
  }
}

// ── HELPERS ───────────────────────────────────────────────────────

function sanitize(name) {
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
  } catch { }
}
setInterval(cleanupOld, 10 * 60 * 1000);

// ══════════════════════════════════════════════════════════════════
//  TIKWM API — khusus TikTok (bypass datacenter block)
// ══════════════════════════════════════════════════════════════════

function downloadTikTokViaTikwm(videoUrl) {
  return new Promise((resolve, reject) => {
    const postData = `url=${encodeURIComponent(videoUrl)}&hd=1`;
    const options = {
      hostname: 'www.tikwm.com',
      path: '/api/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.tikwm.com/',
      },
    };
    const req = https.request(options, apiRes => {
      let body = '';
      apiRes.on('data', d => body += d);
      apiRes.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.code !== 0 || !data.data) return reject(new Error(data.msg || 'TikWM API gagal'));
          const info = data.data;
          const videoUrlResult = info.hdplay || info.play || info.wmplay;
          if (!videoUrlResult) return reject(new Error('URL video tidak ditemukan'));
          resolve({
            downloadUrl: videoUrlResult,
            title: info.title || 'tiktok_video',
            author: info.author?.nickname || '',
            thumbnail: info.cover || '',
            duration: info.duration || 0,
          });
        } catch (e) { reject(new Error('Parse TikWM response gagal: ' + e.message)); }
      });
    });
    req.on('error', e => reject(new Error('TikWM request error: ' + e.message)));
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('TikWM timeout')); });
    req.write(postData);
    req.end();
  });
}

function streamTikTokUrl(sourceUrl, filename, res) {
  const urlObj = new URL(sourceUrl);
  const mod = sourceUrl.startsWith('https') ? https : require('http');
  const options = {
    hostname: urlObj.hostname,
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.tiktok.com/',
    },
  };
  mod.get(options, streamRes => {
    if ([301, 302, 307].includes(streamRes.statusCode)) {
      return streamTikTokUrl(streamRes.headers.location, filename, res);
    }
    if (streamRes.statusCode !== 200) {
      if (!res.headersSent) res.status(502).json({ error: 'Gagal stream video dari TikTok' });
      return;
    }
    const safeName = sanitize(filename) + '.mp4';
    const encodedName = encodeURIComponent(safeName);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`);
    if (streamRes.headers['content-length']) res.setHeader('Content-Length', streamRes.headers['content-length']);
    streamRes.pipe(res);
    streamRes.on('error', () => { if (!res.headersSent) res.status(500).end(); });
  }).on('error', e => {
    if (!res.headersSent) res.status(500).json({ error: 'Stream error: ' + e.message });
  });
}

// ── Helper: download TikTok URL to local file (for HDR pipeline) ─
function downloadTikTokToFile(downloadUrl, destPath) {
  return new Promise((resolve, reject) => {
    function fetch(url, redirects) {
      if (redirects > 10) return reject(new Error('Too many redirects'));
      const mod = url.startsWith('https') ? https : require('http');
      mod.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': 'https://www.tiktok.com/',
        },
      }, res => {
        if ([301, 302, 307, 308].includes(res.statusCode)) {
          return fetch(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      }).on('error', reject);
    }
    fetch(downloadUrl, 0);
  });
}

// ══════════════════════════════════════════════════════════════════
//  HDR+ CONVERSION ENGINE
// ══════════════════════════════════════════════════════════════════

/**
 * Build ffmpeg args for HDR conversion.
 * - If zscale available: full HDR10 (BT.2020 + PQ transfer / SMPTE ST 2084)
 * - Otherwise: enhanced SDR (higher contrast, saturation, sharpness)
 */
function buildHdrFfmpegArgs(inputPath, outputPath, useZscale) {
  if (useZscale) {
    // Full HDR10 pipeline
    const vf = [
      'zscale=t=linear:npl=100',
      'format=gbrpf32le',
      'zscale=p=bt2020',
      'tonemap=tonemap=hable:desat=0:peak=1000',
      'zscale=t=smpte2084:m=bt2020nc:r=tv',
      'format=yuv420p10le',
    ].join(',');

    return [
      '-y', '-i', inputPath,
      '-vf', vf,
      '-c:v', 'libx265',
      '-crf', '20',
      '-preset', 'fast',
      '-x265-params',
      'hdr-opt=1:repeat-headers=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc' +
      ':master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,50000)' +
      ':max-cll=1000,400',
      '-tag:v', 'hvc1',
      '-movflags', '+faststart',
      '-c:a', 'copy',
      outputPath,
    ];
  } else {
    // HDR+ enhanced mode (no zscale needed)
    const vf = [
      'eq=contrast=1.15:brightness=0.03:saturation=1.32:gamma=0.88',
      'unsharp=5:5:0.5:3:3:0.2',
    ].join(',');

    return [
      '-y', '-i', inputPath,
      '-vf', vf,
      '-c:v', 'libx264',
      '-crf', '18',
      '-preset', 'fast',
      '-movflags', '+faststart',
      '-c:a', 'copy',
      outputPath,
    ];
  }
}

/**
 * Download source video to a temp file using yt-dlp or TikWM.
 * Returns { srcPath, title }
 */
function downloadSourceVideo(videoUrl, quality, uid) {
  return new Promise((resolve, reject) => {
    const safeUrl = videoUrl.replace(/["`]/g, '');

    // TikTok → TikWM (bypass datacenter block)
    if (safeUrl.includes('tiktok.com')) {
      const srcPath = path.join(TEMP_DIR, `${uid}_src.mp4`);
      downloadTikTokViaTikwm(safeUrl)
        .then(info => {
          console.log(`  [HDR-DL] TikWM: ${info.downloadUrl.slice(0, 70)}...`);
          downloadTikTokToFile(info.downloadUrl, srcPath)
            .then(() => resolve({ srcPath, title: info.title || 'tiktok_video' }))
            .catch(reject);
        })
        .catch(reject);
      return;
    }

    // yt-dlp for all other platforms
    if (!YTDLP_BIN) return reject(new Error('yt-dlp tidak tersedia'));

    const q = quality && quality !== 'best' ? quality : null;
    const fmtStr = q
      ? `bestvideo[ext=mp4][height<=${q}]+bestaudio[ext=m4a]/bestvideo[height<=${q}]+bestaudio/best[height<=${q}]/best`
      : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best';

    const outTpl = path.join(TEMP_DIR, `${uid}_src_%(title).55s.%(ext)s`);
    const args = [
      '--no-warnings', '--no-playlist', '--no-progress',
      '-f', fmtStr,
      '--merge-output-format', 'mp4',
      '-o', outTpl,
      safeUrl,
    ];

    let spawnCmd = YTDLP_BIN;
    let spawnArgs = args;
    if (YTDLP_BIN.startsWith('python3')) {
      spawnCmd = 'python3';
      spawnArgs = ['-m', 'yt_dlp', ...args];
    }

    console.log(`  [HDR-DL] yt-dlp download...`);
    const proc = spawn(spawnCmd, spawnArgs);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0) {
        const msg = stderr.toLowerCase();
        let errText = 'Download gagal';
        if (msg.includes('unsupported url')) errText = 'URL tidak didukung';
        else if (msg.includes('private')) errText = 'Video bersifat privat';
        else if (msg.includes('geo')) errText = 'Video dibatasi wilayah';
        else if (msg.includes('404')) errText = 'Video tidak ditemukan';
        return reject(new Error(errText));
      }

      const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(`${uid}_src`));
      if (!files.length) return reject(new Error('File download tidak ditemukan'));

      const dlFile = path.join(TEMP_DIR, files[0]);
      const rawName = files[0].replace(`${uid}_src_`, '').replace(/\.[^.]+$/, '');
      const srcPath = path.join(TEMP_DIR, `${uid}_src.mp4`);

      // Rename/copy to standard srcPath
      try {
        fs.renameSync(dlFile, srcPath);
      } catch {
        try { fs.copyFileSync(dlFile, srcPath); fs.unlinkSync(dlFile); } catch { }
      }

      resolve({ srcPath, title: rawName || 'video' });
    });
  });
}

/**
 * Run ffmpeg HDR conversion.
 * Auto-retries with enhanced mode if HDR10 (zscale) fails.
 */
function runHdrConversion(srcPath, hdrPath, attempt) {
  return new Promise((resolve, reject) => {
    const useZscale = attempt === 1 && ZSCALE_AVAILABLE;
    const hdrLabel = useZscale ? 'HDR10' : 'HDR+';
    const args = buildHdrFfmpegArgs(srcPath, hdrPath, useZscale);

    if (FFMPEG_DIR && !useZscale) {
      // nothing special
    }

    console.log(`  [HDR-CONV] Converting to ${hdrLabel} (attempt ${attempt})...`);
    const bin = FFMPEG_PATH === 'ffmpeg' ? 'ffmpeg' : FFMPEG_PATH;
    const proc = spawn(bin, args);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0) {
        if (attempt === 1 && ZSCALE_AVAILABLE) {
          // HDR10 failed — try enhanced fallback
          console.warn('  [HDR-CONV] HDR10 gagal, coba HDR+ enhanced mode...');
          return runHdrConversion(srcPath, hdrPath, 2).then(resolve).catch(reject);
        }
        // Both failed
        console.error('  [HDR-CONV] stderr:', stderr.slice(0, 400));
        return reject(new Error('Konversi HDR gagal: ' + stderr.slice(0, 200)));
      }
      resolve(useZscale ? 'HDR10' : 'HDR+');
    });
  });
}

// ══════════════════════════════════════════════════════════════════
//  API ROUTES
// ══════════════════════════════════════════════════════════════════

app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  service: 'LANNGOOD.ID v3 + HDR+',
  ytdlp: YTDLP_BIN ? `ready (${YTDLP_VERSION})` : 'NOT FOUND',
  ytdlp_ready: !!YTDLP_BIN,
  ffmpeg_ready: FFMPEG_AVAILABLE,
  hdr_ready: FFMPEG_AVAILABLE,
  hdr_type: HDR_TYPE,
  uptime: Math.floor(process.uptime()),
}));

app.get('/api/status', (req, res) => res.json({
  ytdlp_ready: !!YTDLP_BIN,
  version: YTDLP_VERSION,
  ffmpeg_ready: FFMPEG_AVAILABLE,
  hdr_ready: FFMPEG_AVAILABLE,
  hdr_type: HDR_TYPE, // 'HDR10' | 'HDR+' | 'none'
}));

// ── GET VIDEO INFO ────────────────────────────────────────────────
app.post('/api/info', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL wajib diisi' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Format URL salah' }); }

  const safeUrl = url.replace(/["`]/g, '');

  if (safeUrl.includes('tiktok.com')) {
    return downloadTikTokViaTikwm(safeUrl)
      .then(info => res.json({ title: info.title || 'TikTok Video', uploader: info.author || '', thumbnail: info.thumbnail || '' }))
      .catch(() => res.json({ title: 'TikTok Video', uploader: '', thumbnail: '' }));
  }

  if (!YTDLP_BIN) return res.status(503).json({ error: 'yt-dlp tidak tersedia', ytdlp_missing: true });

  const cmd = `"${YTDLP_BIN}" --no-warnings --dump-json --no-playlist "${safeUrl}"`;
  exec(cmd, { timeout: 35000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      const msg = (stderr || err.message || '').toLowerCase();
      if (msg.includes('unsupported url')) return res.status(400).json({ error: 'URL tidak didukung' });
      if (msg.includes('private')) return res.status(400).json({ error: 'Video bersifat privat' });
      if (msg.includes('404')) return res.status(404).json({ error: 'Video tidak ditemukan' });
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

// ── DOWNLOAD VIDEO (normal) ───────────────────────────────────────
app.post('/api/download', (req, res) => {
  const { url, format = 'mp4', quality = 'best' } = req.body;
  if (!url) return res.status(400).json({ error: 'URL wajib diisi' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Format URL salah' }); }

  const safeUrlCheck = url.replace(/["`]/g, '');

  if (safeUrlCheck.includes('tiktok.com')) {
    console.log('[TIKWM] Menggunakan TikWM API untuk TikTok...');
    downloadTikTokViaTikwm(safeUrlCheck)
      .then(info => {
        const filename = sanitize(info.title || 'tiktok_video');
        streamTikTokUrl(info.downloadUrl, filename, res);
      })
      .catch(err => {
        if (!res.headersSent) res.status(500).json({ error: 'TikTok download gagal: ' + err.message });
      });
    return;
  }

  if (!YTDLP_BIN) return res.status(503).json({ error: 'yt-dlp tidak tersedia', ytdlp_missing: true });

  cleanupOld();

  const uid = crypto.randomBytes(8).toString('hex');
  const outTpl = path.join(TEMP_DIR, `${uid}_%(title).60s.%(ext)s`);
  const safeUrl = url.replace(/["`]/g, '');
  const fmtStr = buildFormatStr(format, quality);

  let args;
  if (format === 'mp3') {
    if (FFMPEG_AVAILABLE) {
      args = [
        '--no-warnings', '--no-playlist', '--no-progress',
        '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '192K',
        ...(FFMPEG_DIR !== '' ? ['--ffmpeg-location', FFMPEG_DIR] : []),
        '-o', outTpl,
      ];
    } else {
      args = [
        '--no-warnings', '--no-playlist', '--no-progress',
        '-f', 'bestaudio[ext=m4a]/bestaudio[ext=aac]/bestaudio/best',
        '-o', outTpl,
      ];
    }
  } else {
    const mergeExt = format === 'webm' ? 'webm' : (format === 'best' ? 'mkv' : 'mp4');
    args = [
      '--no-warnings', '--no-playlist', '--no-progress',
      '--merge-output-format', mergeExt,
      '-o', outTpl,
    ];
    if (fmtStr) args.push('-f', fmtStr);
  }

  args.push(safeUrl);

  let spawnCmd = YTDLP_BIN;
  let spawnArgs = args;
  if (YTDLP_BIN.startsWith('python3')) {
    spawnCmd = 'python3';
    spawnArgs = ['-m', 'yt_dlp', ...args];
  }

  console.log(`[DL] ${spawnCmd} ${spawnArgs.slice(0, 4).join(' ')} ...`);

  const proc = spawn(spawnCmd, spawnArgs);
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d.toString(); });
  proc.stdout.on('data', () => { });

  proc.on('error', err => {
    if (!res.headersSent) res.status(500).json({ error: 'Gagal menjalankan yt-dlp: ' + err.message });
  });

  proc.on('close', code => {
    if (code !== 0) {
      if (!res.headersSent) {
        const msg = stderr.toLowerCase();
        let errText = 'Download gagal';
        if (msg.includes('unsupported url')) errText = 'URL tidak didukung';
        else if (msg.includes('private')) errText = 'Video bersifat privat';
        else if (msg.includes('geo')) errText = 'Video dibatasi wilayah';
        else if (msg.includes('404')) errText = 'Video tidak ditemukan';
        else if (msg.includes('ffmpeg')) errText = 'ffmpeg tidak ditemukan di server';
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
    let ext = path.extname(files[0]).replace('.', '').toLowerCase();
    if (!ext) ext = format === 'mp3' ? 'mp3' : 'mp4';

    const rawName = files[0].replace(`${uid}_`, '');
    const baseName = rawName.replace(/\.[^.]+$/, '');
    let finalExt;
    if (format === 'mp3' && FFMPEG_AVAILABLE) finalExt = 'mp3';
    else if (format === 'mp3' && !FFMPEG_AVAILABLE) finalExt = ext || 'm4a';
    else finalExt = ext || format;

    const safeName = (sanitize(baseName) || 'lanngood_video') + '.' + finalExt;
    const MIME = {
      mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
      mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/opus',
    };

    res.setHeader('X-Actual-Format', finalExt);
    res.setHeader('X-Ffmpeg-Available', FFMPEG_AVAILABLE ? 'true' : 'false');
    res.setHeader('Content-Type', MIME[finalExt] || MIME[ext] || 'application/octet-stream');
    const encodedName = encodeURIComponent(safeName).replace(/[()]/g, escape);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`);
    res.setHeader('Content-Length', fs.statSync(filePath).size);

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    const cleanup = () => { try { fs.unlinkSync(filePath); } catch { } };
    stream.on('end', () => setTimeout(cleanup, 3000));
    res.on('close', cleanup);
  });
});

// ── HDR+ CONVERSION ENDPOINT ──────────────────────────────────────
app.post('/api/hdr', async (req, res) => {
  const { url, quality = 'best' } = req.body;

  if (!url) return res.status(400).json({ error: 'URL wajib diisi' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Format URL salah' }); }
  if (!FFMPEG_AVAILABLE) {
    return res.status(503).json({
      error: 'FFmpeg tidak tersedia di server. HDR+ membutuhkan ffmpeg untuk konversi.',
    });
  }

  cleanupOld();

  const uid = crypto.randomBytes(8).toString('hex');
  const hdrPath = path.join(TEMP_DIR, `${uid}_hdr.mp4`);
  let srcPath = null;

  const cleanup = () => {
    setTimeout(() => {
      [srcPath, hdrPath].forEach(f => {
        if (f) try { fs.unlinkSync(f); } catch { }
      });
      // Clean any leftover yt-dlp pattern files
      try {
        fs.readdirSync(TEMP_DIR)
          .filter(f => f.startsWith(uid))
          .forEach(f => { try { fs.unlinkSync(path.join(TEMP_DIR, f)); } catch { } });
      } catch { }
    }, 8000);
  };

  console.log(`[HDR+] Request: ${url.slice(0, 80)} quality=${quality}`);

  try {
    // Step 1 — Download source video
    const { srcPath: sp, title } = await downloadSourceVideo(url, quality, uid);
    srcPath = sp;

    if (!fs.existsSync(srcPath) || fs.statSync(srcPath).size === 0) {
      throw new Error('File video sumber kosong atau tidak ditemukan');
    }

    console.log(`  [HDR+] Source downloaded: ${(fs.statSync(srcPath).size / 1024 / 1024).toFixed(1)} MB — "${title}"`);

    // Step 2 — HDR conversion
    const hdrLabel = await runHdrConversion(srcPath, hdrPath, 1);

    if (!fs.existsSync(hdrPath) || fs.statSync(hdrPath).size === 0) {
      throw new Error('File HDR tidak terbuat');
    }

    const fileSizeMB = (fs.statSync(hdrPath).size / 1024 / 1024).toFixed(1);
    console.log(`  [HDR+] Done! ${hdrLabel} — ${fileSizeMB} MB — "${title}"`);

    // Step 3 — Stream result to client
    const safeTitle = sanitize(title) || 'lanngood_hdr';
    const suffix = hdrLabel === 'HDR10' ? 'HDR10' : 'HDRplus';
    const filename = `${safeTitle}_${suffix}.mp4`;
    const encodedName = encodeURIComponent(filename);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodedName}`);
    res.setHeader('Content-Length', fs.statSync(hdrPath).size);
    res.setHeader('X-HDR-Type', hdrLabel);
    res.setHeader('X-HDR-Source-Size', fs.statSync(srcPath).size);

    const stream = fs.createReadStream(hdrPath);
    stream.pipe(res);
    stream.on('end', cleanup);
    stream.on('error', (err) => {
      console.error('[HDR+] Stream error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Stream error' });
      cleanup();
    });
    res.on('close', cleanup);

  } catch (err) {
    cleanup();
    console.error('[HDR+ ERR]', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'HDR+ conversion gagal' });
    }
  }
});

// ── 404 / Error handlers ─────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Tidak ditemukan' }));
app.use((err, req, res, next) => {
  console.error('[ERR]', err);
  if (!res.headersSent) res.status(500).json({ error: 'Server error' });
});

// ══════════════════════════════════════════════════════════════════
//  STARTUP
// ══════════════════════════════════════════════════════════════════
(async function start() {
  console.log(`\n  ╔════════════════════════════════════╗`);
  console.log(`  ║   LANNGOOD.ID Server v3 + HDR+     ║`);
  console.log(`  ╚════════════════════════════════════╝`);

  const found = detectYtDlp();
  detectFfmpeg();
  detectZscale(); // Check for libzimg/zscale (HDR10 support)

  if (!found) {
    console.log('  🔄 Mencoba auto-install yt-dlp...');
    await new Promise(resolve => autoInstallYtDlp(ok => {
      if (!ok) console.log('\n  ❗ Install manual:\n     pip install yt-dlp\n     lalu restart server\n');
      resolve();
    }));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  🚀 http://0.0.0.0:${PORT}`);
    console.log(`  📦 yt-dlp  : ${YTDLP_BIN ? '✅ ' + YTDLP_VERSION : '❌ tidak ditemukan'}`);
    console.log(`  🎬 ffmpeg  : ${FFMPEG_AVAILABLE ? '✅' : '❌ tidak ditemukan'}`);
    console.log(`  ✨ HDR+    : ${HDR_TYPE === 'none' ? '❌ tidak tersedia' : '✅ ' + HDR_TYPE}\n`);
  });
})();

module.exports = app;