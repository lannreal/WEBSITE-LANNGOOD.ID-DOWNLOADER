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
 *
 * Mode HDR10 (zscale tersedia):
 *   SDR → linear light → BT.2020 gamut → PQ/SMPTE ST 2084 transfer
 *   CATATAN: JANGAN pakai `tonemap` di sini — filter itu untuk arah HDR→SDR.
 *
 * Mode HDR+ Enhanced (tanpa zscale):
 *   Pendekatan SEIMBANG — warna hidup tapi TIDAK membakar mata.
 *   Filosofi: angkat shadow tipis, jaga midtone natural,
 *   rolloff highlight agar tidak silau, saturation natural.
 */
function buildHdrFfmpegArgs(inputPath, outputPath, useZscale) {
  if (useZscale) {
    // ── SDR → HDR10 (BT.2020 + PQ) ──────────────────────────────
    // ffmpeg 5.x requires zscale steps to be split — combining primaries,
    // transfer, and matrix in a single zscale call causes "Unspecified error".
    const vf = [
      'zscale=t=linear:npl=100',
      'format=gbrpf32le',
      'zscale=primaries=bt2020',
      'zscale=t=smpte2084:m=bt2020nc:r=tv:npl=1000',
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
    // ── HDR+ Enhanced (tanpa zscale) ─────────────────────────────
    //
    // FILOSOFI: HDR+ bukan "lebih terang & lebih jenuh".
    // Tujuan: dynamic range lebih lebar, shadow & highlight tetap terjaga,
    // warna hidup tapi TIDAK membakar mata.
    //
    // Perbandingan vs versi lama yang menyilaukan:
    //  ┌─────────────┬──────────────┬──────────────┬─────────────────────────┐
    //  │ Parameter   │ Lama (silau) │ Baru (seimbang)│ Alasan                │
    //  ├─────────────┼──────────────┼──────────────┼─────────────────────────┤
    //  │ gamma       │ 1.2          │ 1.12         │ Lift midtone lebih halus │
    //  │ contrast    │ 1.08         │ 1.04         │ Hindari crush shadow     │
    //  │ brightness  │ 0.03         │ 0.01         │ Biarkan gamma yang angkat│
    //  │ saturation  │ 1.25 (garish)│ 1.10         │ Vivid tapi natural       │
    //  │ curves      │ master agresif│ per-channel  │ Kontrol R/G/B terpisah   │
    //  │             │ 1→1 (clipping)│ rolloff 0.975│ Highlight tidak silau   │
    //  │ unsharp     │ 5x5 str=0.3  │ 3x3 str=0.12 │ Clarity tanpa amplify   │
    //  │             │ (harsh)      │              │ noise / grain            │
    //  └─────────────┴──────────────┴──────────────┴─────────────────────────┘
    //
    // Kunci utama anti-silau = highlight rolloff (1/0.975):
    //   1.0 → putih 100% → terlalu menyilaukan di layar mobile/OLED
    //   0.975 → highlight sedikit turun → terasa "lembut" dan nyaman di mata
    //
    // Shadow lift tipis (0/0.015):
    //   0/0 → shadow hitam crush → detail hilang, kontras berlebihan
    //   0/0.015 → shadow sedikit terangkat → detail tetap ada, mata tidak lelah

    const vf = [
      // Step 1 — Gentle gamma lift + minimal brightness + natural saturation
      'eq=gamma=1.12:contrast=1.04:brightness=0.01:saturation=1.10',

      // Step 2 — Balanced per-channel S-curve
      //   0/0.015  = shadow lift tipis (detail area gelap tidak crush)
      //   0.5/0.52 = midtone sedikit naik (naturalness preserved)
      //   1/0.975  = highlight rolloff (ANTI-SILAU — cegah clipping)
      //   Blue lebih rendah (0.515) agar tidak terlalu "cool/dingin"
      "curves=r='0/0.015 0.5/0.52 1/0.975'" +
        ":g='0/0.015 0.5/0.52 1/0.975'" +
        ":b='0/0.015 0.5/0.515 1/0.975'",

      // Step 3 — Light clarity: radius kecil, strength rendah
      //   Cukup untuk ketajaman tepi, tidak amplify noise atau skin texture
      'unsharp=3:3:0.12:3:3:0.04',
    ].join(',');

    return [
      '-y', '-i', inputPath,
      '-vf', vf,
      '-c:v', 'libx264',
      '-crf', '17',
      '-preset', 'fast',
      '-movflags', '+faststart',
      '-c:a', 'copy',
      outputPath,
    ];
  }
}

/**
 * Extract the actual ffmpeg error from stderr.
 * ffmpeg always prints a version banner + config to stderr even on success,
 * so we must ignore those lines and only surface the real error lines.
 */
function extractFfmpegError(stderr) {
  const lines = stderr.split('\n');
  const errorLines = lines.filter(l => {
    const t = l.trim();
    if (!t) return false;
    if (/^ffmpeg version/i.test(t)) return false;
    if (/^(built with|configuration:|lib|Input #|Output #|Stream mapping|Press ctrl)/i.test(t)) return false;
    if (/^\s*(Stream|Metadata|Duration|encoder|video:|audio:)/i.test(t)) return false;
    return /error|invalid|not found|no such|failed|cannot|unable|unspecified|conversion/i.test(t);
  });
  if (errorLines.length) return errorLines.slice(-3).join(' | ').slice(0, 300);
  const meaningful = lines.filter(l => l.trim() && !/^ffmpeg version|^built with|^configuration/i.test(l.trim()));
  return meaningful.slice(-2).join(' | ').slice(0, 300) || 'Unknown ffmpeg error';
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

    console.log(`  [HDR-CONV] Converting to ${hdrLabel} (attempt ${attempt})...`);
    const bin = FFMPEG_PATH === 'ffmpeg' ? 'ffmpeg' : FFMPEG_PATH;
    const proc = spawn(bin, args);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0) {
        if (attempt === 1 && ZSCALE_AVAILABLE) {
          console.warn('  [HDR-CONV] HDR10 gagal, coba HDR+ enhanced mode...');
          return runHdrConversion(srcPath, hdrPath, 2).then(resolve).catch(reject);
        }
        const realErr = extractFfmpegError(stderr);
        console.error(`  [HDR-CONV] exit ${code} | ${realErr}`);
        return reject(new Error('Konversi HDR gagal: ' + realErr));
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
  hdr_type: HDR_TYPE,
  features: {
    trim: FFMPEG_AVAILABLE, gif: FFMPEG_AVAILABLE, compress: FFMPEG_AVAILABLE,
    normalize: FFMPEG_AVAILABLE, subtitle: !!YTDLP_BIN, thumbnail: !!YTDLP_BIN,
    formats: !!YTDLP_BIN, playlist: !!YTDLP_BIN, batch: !!YTDLP_BIN, hdr: FFMPEG_AVAILABLE,
  },
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

// ══════════════════════════════════════════════════════════════════
//  FITUR BARU — 20 Features
// ══════════════════════════════════════════════════════════════════

// ── 1. FORMAT INSPECTOR ──────────────────────────────────────────
app.post('/api/formats', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL wajib diisi' });
  if (!YTDLP_BIN) return res.status(503).json({ error: 'yt-dlp tidak tersedia' });

  const safeUrl = url.replace(/["`]/g, '');
  const cmd = `"${YTDLP_BIN}" --no-warnings -j --no-playlist "${safeUrl}"`;

  exec(cmd, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: (stderr || err.message).slice(0, 200) });
    try {
      const info = JSON.parse(stdout.trim().split('\n')[0]);
      const fmts = (info.formats || [])
        .filter(f => f.vcodec !== 'none' && f.height)
        .map(f => ({
          id: f.format_id,
          ext: f.ext,
          height: f.height,
          fps: f.fps ? Math.round(f.fps) : null,
          vcodec: (f.vcodec || '').split('.')[0],
          acodec: (f.acodec || '').split('.')[0],
          filesize: f.filesize || f.filesize_approx || null,
          note: f.format_note || '',
        }))
        .sort((a, b) => (b.height - a.height));

      const seen = new Set();
      const unique = fmts.filter(f => {
        const k = `${f.height}p`;
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });

      res.json({
        title: info.title || 'Video',
        thumbnail: info.thumbnail || '',
        duration: info.duration || 0,
        uploader: info.uploader || info.channel || '',
        formats: unique.slice(0, 12),
      });
    } catch {
      res.status(500).json({ error: 'Gagal parse format video' });
    }
  });
});

// ── 2. VIDEO TRIM ────────────────────────────────────────────────
app.post('/api/trim', async (req, res) => {
  const { url, start = '0', end, format = 'mp4', quality = 'best' } = req.body;
  if (!url) return res.status(400).json({ error: 'URL wajib diisi' });
  if (!FFMPEG_AVAILABLE) return res.status(503).json({ error: 'ffmpeg tidak tersedia untuk trim' });

  cleanupOld();
  const uid = crypto.randomBytes(8).toString('hex');
  const srcPath = path.join(TEMP_DIR, `${uid}_trim_src.mp4`);
  const outPath = path.join(TEMP_DIR, `${uid}_trim_out.mp4`);

  try {
    const { srcPath: sp, title } = await downloadSourceVideo(url, quality, uid);
    try { fs.renameSync(sp, srcPath); } catch { fs.copyFileSync(sp, srcPath); }

    await new Promise((resolve, reject) => {
      const args = ['-y', '-i', srcPath, '-ss', String(start)];
      if (end) args.push('-to', String(end));
      args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero', outPath);

      const ffBin = FFMPEG_PATH === 'ffmpeg' ? 'ffmpeg' : FFMPEG_PATH;
      const proc = spawn(ffBin, args);
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', code => {
        if (code !== 0) return reject(new Error('Trim gagal: ' + stderr.slice(0, 200)));
        resolve();
      });
    });

    const safeName = (sanitize(title) || 'lanngood_trim') + `_trim.mp4`;
    const encoded = encodeURIComponent(safeName);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encoded}`);
    res.setHeader('Content-Length', fs.statSync(outPath).size);
    res.setHeader('X-Video-Title', sanitize(title));

    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    const cleanup = () => { [srcPath, outPath].forEach(f => { try { fs.unlinkSync(f); } catch { } }); };
    stream.on('end', () => setTimeout(cleanup, 3000));
    res.on('close', cleanup);

  } catch (err) {
    [srcPath, outPath].forEach(f => { try { fs.unlinkSync(f); } catch { } });
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── 3. GIF CONVERTER ─────────────────────────────────────────────
app.post('/api/gif', async (req, res) => {
  const { url, start = '0', duration = '5', width = '480', fps = '12', quality = 'best' } = req.body;
  if (!url) return res.status(400).json({ error: 'URL wajib diisi' });
  if (!FFMPEG_AVAILABLE) return res.status(503).json({ error: 'ffmpeg tidak tersedia' });

  cleanupOld();
  const uid = crypto.randomBytes(8).toString('hex');
  const srcPath = path.join(TEMP_DIR, `${uid}_gif_src.mp4`);
  const palPath = path.join(TEMP_DIR, `${uid}_palette.png`);
  const gifPath = path.join(TEMP_DIR, `${uid}_out.gif`);
  const ffBin = FFMPEG_PATH === 'ffmpeg' ? 'ffmpeg' : FFMPEG_PATH;

  const spawnFF = (args) => new Promise((resolve, reject) => {
    const proc = spawn(ffBin, args);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(stderr.slice(0, 200)));
      resolve();
    });
  });

  try {
    const { srcPath: sp, title } = await downloadSourceVideo(url, quality, uid);
    try { fs.renameSync(sp, srcPath); } catch { fs.copyFileSync(sp, srcPath); }

    const w = Math.min(parseInt(width) || 480, 800);
    const f = Math.min(parseInt(fps) || 12, 24);
    const d = Math.min(parseFloat(duration) || 5, 30);
    const vf = `fps=${f},scale=${w}:-1:flags=lanczos`;

    await spawnFF(['-y', '-ss', String(start), '-t', String(d), '-i', srcPath,
      '-vf', `${vf},palettegen=max_colors=128`, palPath]);

    await spawnFF(['-y', '-ss', String(start), '-t', String(d), '-i', srcPath,
      '-i', palPath, '-lavfi', `${vf}[x];[x][1:v]paletteuse=dither=bayer`, gifPath]);

    const safeName = (sanitize(title) || 'lanngood') + '.gif';
    const encoded = encodeURIComponent(safeName);
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encoded}`);
    res.setHeader('Content-Length', fs.statSync(gifPath).size);

    const stream = fs.createReadStream(gifPath);
    stream.pipe(res);
    const cleanup = () => { [srcPath, palPath, gifPath].forEach(f => { try { fs.unlinkSync(f); } catch { } }); };
    stream.on('end', () => setTimeout(cleanup, 3000));
    res.on('close', cleanup);

  } catch (err) {
    [srcPath, palPath, gifPath].forEach(f => { try { fs.unlinkSync(f); } catch { } });
    if (!res.headersSent) res.status(500).json({ error: err.message || 'GIF conversion gagal' });
  }
});

// ── 4. VIDEO COMPRESS ────────────────────────────────────────────
app.post('/api/compress', async (req, res) => {
  const { url, preset = 'medium', quality = 'best' } = req.body;
  if (!url) return res.status(400).json({ error: 'URL wajib diisi' });
  if (!FFMPEG_AVAILABLE) return res.status(503).json({ error: 'ffmpeg tidak tersedia' });

  const presets = {
    low: { scale: 720, crf: 32, preset: 'fast' },
    medium: { scale: 720, crf: 26, preset: 'fast' },
    high: { scale: 1080, crf: 22, preset: 'fast' },
  };
  const cfg = presets[preset] || presets.medium;

  cleanupOld();
  const uid = crypto.randomBytes(8).toString('hex');
  const srcPath = path.join(TEMP_DIR, `${uid}_cmp_src.mp4`);
  const outPath = path.join(TEMP_DIR, `${uid}_cmp_out.mp4`);

  try {
    const { srcPath: sp, title } = await downloadSourceVideo(url, quality, uid);
    try { fs.renameSync(sp, srcPath); } catch { fs.copyFileSync(sp, srcPath); }

    await new Promise((resolve, reject) => {
      const ffBin = FFMPEG_PATH === 'ffmpeg' ? 'ffmpeg' : FFMPEG_PATH;
      const vf = `scale=-2:min(ih\\,${cfg.scale})`;
      const args = [
        '-y', '-i', srcPath,
        '-vf', vf,
        '-c:v', 'libx264', '-crf', String(cfg.crf), '-preset', cfg.preset,
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart', outPath,
      ];
      const proc = spawn(ffBin, args);
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', code => {
        if (code !== 0) return reject(new Error('Compress gagal: ' + stderr.slice(0, 200)));
        resolve();
      });
    });

    const origSize = fs.statSync(srcPath).size;
    const newSize = fs.statSync(outPath).size;
    const safeName = (sanitize(title) || 'lanngood') + `_${preset}.mp4`;
    const encoded = encodeURIComponent(safeName);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encoded}`);
    res.setHeader('Content-Length', newSize);
    res.setHeader('X-Original-Size', origSize);
    res.setHeader('X-Compressed-Size', newSize);
    res.setHeader('X-Compression-Ratio', (newSize / origSize * 100).toFixed(1));

    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    const cleanup = () => { [srcPath, outPath].forEach(f => { try { fs.unlinkSync(f); } catch { } }); };
    stream.on('end', () => setTimeout(cleanup, 3000));
    res.on('close', cleanup);

  } catch (err) {
    [srcPath, outPath].forEach(f => { try { fs.unlinkSync(f); } catch { } });
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── 5. SUBTITLE DOWNLOAD ─────────────────────────────────────────
app.post('/api/subtitle', (req, res) => {
  const { url, lang = 'id,en' } = req.body;
  if (!url) return res.status(400).json({ error: 'URL wajib diisi' });
  if (!YTDLP_BIN) return res.status(503).json({ error: 'yt-dlp tidak tersedia' });

  cleanupOld();
  const uid = crypto.randomBytes(8).toString('hex');
  const safeUrl = url.replace(/["`]/g, '');
  const outTpl = path.join(TEMP_DIR, `${uid}_sub_%(title).50s`);

  const args = [
    '--no-warnings', '--no-playlist', '--skip-download',
    '--write-subs', '--write-auto-subs',
    '--sub-langs', lang,
    '--sub-format', 'srt/best',
    '--convert-subs', 'srt',
    '-o', outTpl, safeUrl,
  ];

  let spawnCmd = YTDLP_BIN;
  let spawnArgs = args;
  if (YTDLP_BIN.startsWith('python3')) { spawnCmd = 'python3'; spawnArgs = ['-m', 'yt_dlp', ...args]; }

  const proc = spawn(spawnCmd, spawnArgs);
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d.toString(); });
  proc.on('close', code => {
    const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(`${uid}_sub`) && f.endsWith('.srt'));
    if (!files.length) {
      return res.status(404).json({ error: 'Subtitle tidak tersedia untuk video ini' });
    }
    const filePath = path.join(TEMP_DIR, files[0]);
    const rawName = files[0].replace(`${uid}_sub_`, '');
    const safeName = sanitize(rawName.replace(/\.[^.]+$/, '')) + '.srt';
    const encoded = encodeURIComponent(safeName);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encoded}`);
    res.setHeader('Content-Length', fs.statSync(filePath).size);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('end', () => setTimeout(() => { try { fs.unlinkSync(filePath); } catch { } }, 3000));
  });
  proc.on('error', err => { if (!res.headersSent) res.status(500).json({ error: err.message }); });
});

// ── 6. THUMBNAIL DOWNLOAD ────────────────────────────────────────
app.post('/api/thumbnail', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL wajib diisi' });
  if (!YTDLP_BIN) return res.status(503).json({ error: 'yt-dlp tidak tersedia' });

  const safeUrl = url.replace(/["`]/g, '');
  const cmd = `"${YTDLP_BIN}" --no-warnings -j --no-playlist "${safeUrl}"`;

  exec(cmd, { timeout: 25000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
    if (err) return res.status(500).json({ error: 'Gagal ambil info video' });
    try {
      const info = JSON.parse(stdout.trim().split('\n')[0]);
      const thumbUrl = info.thumbnail || (info.thumbnails || []).slice(-1)[0]?.url;
      if (!thumbUrl) return res.status(404).json({ error: 'Thumbnail tidak ditemukan' });

      const title = sanitize(info.title || 'thumbnail');
      const ext = thumbUrl.split('?')[0].split('.').pop() || 'jpg';
      const filename = `${title}.${ext}`;
      const encoded = encodeURIComponent(filename);

      const mod = thumbUrl.startsWith('https') ? https : require('http');
      mod.get(thumbUrl, imgRes => {
        if (imgRes.statusCode !== 200) return res.status(502).json({ error: 'Gagal fetch thumbnail' });
        res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encoded}`);
        if (imgRes.headers['content-length']) res.setHeader('Content-Length', imgRes.headers['content-length']);
        imgRes.pipe(res);
      }).on('error', () => res.status(500).json({ error: 'Gagal stream thumbnail' }));

    } catch { res.status(500).json({ error: 'Parse error' }); }
  });
});

// ── 7. AUDIO NORMALIZE ───────────────────────────────────────────
app.post('/api/normalize', async (req, res) => {
  const { url, target = '-14', format = 'mp3', quality = 'best' } = req.body;
  if (!url) return res.status(400).json({ error: 'URL wajib diisi' });
  if (!FFMPEG_AVAILABLE) return res.status(503).json({ error: 'ffmpeg tidak tersedia' });

  cleanupOld();
  const uid = crypto.randomBytes(8).toString('hex');
  const srcPath = path.join(TEMP_DIR, `${uid}_norm_src.mp4`);
  const outExt = format === 'mp3' ? 'mp3' : 'mp4';
  const outPath = path.join(TEMP_DIR, `${uid}_norm_out.${outExt}`);

  try {
    const { srcPath: sp, title } = await downloadSourceVideo(url, quality, uid);
    try { fs.renameSync(sp, srcPath); } catch { fs.copyFileSync(sp, srcPath); }

    const lufs = Math.max(-24, Math.min(-6, parseInt(target) || -14));

    await new Promise((resolve, reject) => {
      const ffBin = FFMPEG_PATH === 'ffmpeg' ? 'ffmpeg' : FFMPEG_PATH;
      const audioFilter = `loudnorm=I=${lufs}:TP=-1.5:LRA=11`;
      const args = format === 'mp3'
        ? ['-y', '-i', srcPath, '-vn', '-af', audioFilter, '-c:a', 'libmp3lame', '-b:a', '192k', outPath]
        : ['-y', '-i', srcPath, '-af', audioFilter, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', outPath];

      const proc = spawn(ffBin, args);
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', code => {
        if (code !== 0) return reject(new Error('Normalize gagal: ' + stderr.slice(0, 200)));
        resolve();
      });
    });

    const safeName = (sanitize(title) || 'lanngood_normalized') + `.${outExt}`;
    const encoded = encodeURIComponent(safeName);
    const MIME = { mp3: 'audio/mpeg', mp4: 'video/mp4' };
    res.setHeader('Content-Type', MIME[outExt] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encoded}`);
    res.setHeader('Content-Length', fs.statSync(outPath).size);
    res.setHeader('X-Normalize-Target', lufs + ' LUFS');

    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    const cleanup = () => { [srcPath, outPath].forEach(f => { try { fs.unlinkSync(f); } catch { } }); };
    stream.on('end', () => setTimeout(cleanup, 3000));
    res.on('close', cleanup);

  } catch (err) {
    [srcPath, outPath].forEach(f => { try { fs.unlinkSync(f); } catch { } });
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── 8. PLAYLIST INFO ─────────────────────────────────────────────
app.post('/api/playlist', (req, res) => {
  const { url, limit = 50 } = req.body;
  if (!url) return res.status(400).json({ error: 'URL wajib diisi' });
  if (!YTDLP_BIN) return res.status(503).json({ error: 'yt-dlp tidak tersedia' });

  const safeUrl = url.replace(/["`]/g, '');
  const lim = Math.min(parseInt(limit) || 50, 100);
  const cmd = `"${YTDLP_BIN}" --no-warnings --flat-playlist --dump-json --playlist-end ${lim} "${safeUrl}"`;

  exec(cmd, { timeout: 30000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err && !stdout) {
      return res.status(500).json({ error: (stderr || err.message).slice(0, 200) });
    }
    try {
      const lines = stdout.trim().split('\n').filter(Boolean);
      const items = lines.map(l => {
        try {
          const j = JSON.parse(l);
          return { id: j.id, title: j.title || j.id, url: j.url || j.webpage_url, duration: j.duration, thumbnail: j.thumbnail };
        } catch { return null; }
      }).filter(Boolean);

      res.json({ count: items.length, items });
    } catch { res.status(500).json({ error: 'Parse playlist gagal' }); }
  });
});

// ── 9. BATCH DOWNLOAD (queue info) ──────────────────────────────
app.post('/api/batch/info', (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls) || !urls.length) return res.status(400).json({ error: 'urls[] wajib diisi' });
  if (!YTDLP_BIN) return res.status(503).json({ error: 'yt-dlp tidak tersedia' });

  const limit = Math.min(urls.length, 10);
  const results = [];
  let pending = limit;

  for (let i = 0; i < limit; i++) {
    const safeUrl = urls[i].replace(/["`]/g, '');
    if (safeUrl.includes('tiktok.com')) {
      downloadTikTokViaTikwm(safeUrl)
        .then(info => results.push({ url: safeUrl, title: info.title, thumbnail: info.thumbnail, ok: true }))
        .catch(() => results.push({ url: safeUrl, title: safeUrl, ok: false }))
        .finally(() => { if (--pending === 0) res.json({ results }); });
    } else {
      const cmd = `"${YTDLP_BIN}" --no-warnings -j --no-playlist "${safeUrl}"`;
      exec(cmd, { timeout: 20000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
        try {
          if (err) throw err;
          const info = JSON.parse(stdout.trim().split('\n')[0]);
          results.push({ url: safeUrl, title: info.title || 'Video', thumbnail: info.thumbnail || '', ok: true });
        } catch { results.push({ url: safeUrl, title: safeUrl, ok: false }); }
        if (--pending === 0) res.json({ results });
      });
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
  detectZscale();

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