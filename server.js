const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const archiver = require('archiver');
// support both CommonJS and ESM-style default export from heic-decode
const _heicDecode = require('heic-decode');
const decode = (_heicDecode && (_heicDecode.default || _heicDecode)) || null;
const mime = require('mime-types');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

// add cookie parser and session middleware
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
app.use(cookieParser());

function randomSuffix(length = 4) {
  return crypto.randomBytes(length).toString('hex');
}

app.use((req, res, next) => {
  // ensure a session id exists in cookie
  try {
    let sid = (req.cookies && req.cookies.sid) || null;
    if (!sid) {
      sid = crypto.randomBytes(12).toString('hex');
      // httpOnly ensures JS can't read it, browser will still send it
      res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax' });
    }
    req.sid = sid;

    // create session-specific directories
    req.sessionDir = path.join(storageDir, 'sessions', sid);
    req.sessionOriginals = path.join(req.sessionDir, 'originals');
    req.sessionOutputs = path.join(req.sessionDir, 'outputs');
    req.sessionTmp = path.join(req.sessionDir, 'tmp');
    [req.sessionDir, req.sessionOriginals, req.sessionOutputs, req.sessionTmp].forEach(d => { if(!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }) });
  } catch (e) {
    console.error('session middleware error', e);
  }
  next();
});

const storageDir = path.join(__dirname, 'storage');
const originals = path.join(storageDir, 'originals');
const outputs = path.join(storageDir, 'outputs');
const tmp = path.join(storageDir, 'tmp');
const upload = multer({ dest: tmp });
const LOG_DIR = path.join(storageDir, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');
const PROCESS_TIMEOUT_MS = parseInt(process.env.PROCESS_TIMEOUT_MS) || 120000;
const GIF_PROCESS_TIMEOUT_MS = parseInt(process.env.GIF_PROCESS_TIMEOUT_MS) || PROCESS_TIMEOUT_MS * 2;
[ storageDir, originals, outputs, tmp, LOG_DIR ].forEach(d => { if(!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }) });

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) { console.error('Failed to write log:', e); }
}

function logError(err) {
  const message = err && err.stack ? err.stack : String(err);
  log(`ERROR: ${message}`);
}

function withTimeout(promise, ms, label = '') {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`timeout after ${ms}ms${label ? ` (${label})` : ''}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

// list stored files (session-scoped)
app.get('/api/list', (req, res) => {
  try {
    const files = fs.readdirSync(req.sessionOriginals).map(f => ({ name: f }));
    res.json(files);
  } catch (e) {
    res.json([]);
  }
});

// upload one or many (session-scoped)
app.post('/api/upload', upload.array('files'), async (req, res) => {
  const results = [];
  for (const file of req.files) {
    const dest = path.join(req.sessionOriginals, file.originalname);
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.heic') {
      try {
        const outPath = dest.replace(/\.heic$/i, '.jpg');
        await sharp(file.path).jpeg().toFile(outPath);
        fs.unlinkSync(file.path);
        results.push({ saved: path.basename(outPath) });
      } catch (e) {
        console.error('heic convert error', e);
        fs.renameSync(file.path, dest);
        results.push({ saved: path.basename(dest), note: 'saved raw' });
      }
    } else {
      fs.renameSync(file.path, dest);
      results.push({ saved: file.originalname });
    }
  }
  res.json(results);
});

// process endpoint: accepts array of tasks with settings per file or global setting (session-scoped)
app.post('/api/process', async (req, res) => {
  const tasks = req.body.tasks || [];
  const outFiles = [];
  const missing = [];
  const taskErrors = [];
  log(`process request: ${tasks.length} task(s) for session ${req.sid}`);
  try {
    for (const t of tasks) {
      const src = path.join(req.sessionOriginals, t.name);
      if (!fs.existsSync(src)) {
        missing.push(t.name);
        continue;
      }
      const ext = (t.toFormat || path.extname(t.name).slice(1)).toLowerCase();

      const outNameBase = path.basename(t.name, path.extname(t.name));
      if (t.action === 'frames') {
        try {
          const image = sharp(src, { pages: -1, limitInputPixels: false });
          const metadata = await image.metadata();
          const frames = metadata.pages || 1;
          const zipName = `${outNameBase}-${randomSuffix(4)}-frames.zip`;
          const zipPath = path.join(req.sessionOutputs, zipName);
          const output = fs.createWriteStream(zipPath);
          const archive = archiver('zip');
          archive.pipe(output);
          for (let i = 0; i < frames; i++) {
            const buf = await sharp(src, { page: i, limitInputPixels: false }).png().toBuffer();
            archive.append(buf, { name: `${outNameBase}-frame-${i}.png` });
          }
          await archive.finalize();
          outFiles.push({ input: t.name, output: zipName });
        } catch (e) {
          logError(`frames processing error [${t.name}]: ${e}`);
          taskErrors.push({ input: t.name, action: 'frames', error: e.message || String(e), stack: e.stack });
        }
        continue;
      }

      const rand = randomSuffix(4);
      const outName = `${outNameBase}-${rand}.${ext}`;
      const outPath = path.join(req.sessionOutputs, outName);
      try {
        let pipeline = sharp(src, { animated: true, limitInputPixels: false });
        pipeline = pipeline.withMetadata();
        if (t.width || t.height) {
          const preserve = typeof t.preserve === 'boolean' ? t.preserve : true;
          const fit = preserve ? 'inside' : 'fill';
          pipeline = pipeline.resize(t.width || null, t.height || null, { fit });
        }

        if (ext === 'jpg' || ext === 'jpeg') await withTimeout(pipeline.jpeg().toFile(outPath), PROCESS_TIMEOUT_MS, `jpg-${t.name}`);
        else if (ext === 'png') await withTimeout(pipeline.png().toFile(outPath), PROCESS_TIMEOUT_MS, `png-${t.name}`);
        else if (ext === 'webp') await withTimeout(pipeline.webp().toFile(outPath), PROCESS_TIMEOUT_MS, `webp-${t.name}`);
        else if (ext === 'gif') await withTimeout(pipeline.gif().toFile(outPath), GIF_PROCESS_TIMEOUT_MS, `gif-${t.name}`);
        else if (ext === 'heic') await withTimeout(pipeline.toFile(outPath), PROCESS_TIMEOUT_MS, `heic-${t.name}`);
        else await withTimeout(pipeline.toFile(outPath), PROCESS_TIMEOUT_MS, `default-${t.name}`);

        outFiles.push({ input: t.name, output: outName });
      } catch (e) {
        logError(`process task error [${t.name}] [${ext}]: ${e}`);
        taskErrors.push({ input: t.name, error: e.message || String(e), stack: e.stack });
      }
    }
  } catch (e) {
    logError(`process endpoint failed: ${e}`);
    return res.status(500).json({ error: 'Processing failed', details: e.message || String(e), errors: taskErrors });
  }
  res.json({ outputs: outFiles, missing, errors: taskErrors });
});

// session-scoped download endpoints
app.get('/api/download/original/:file', (req, res) => {
  const p = path.join(req.sessionOriginals, req.params.file);
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(p);
});

app.get('/api/download/output/:file', (req, res) => {
  const p = path.join(req.sessionOutputs, req.params.file);
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(p);
});

app.get('/api/download/all', (req, res) => {
  const sessionOutputs = req.sessionOutputs;
  if (!fs.existsSync(sessionOutputs)) return res.status(404).send('not found');
  const files = fs.readdirSync(sessionOutputs).filter(f => fs.statSync(path.join(sessionOutputs, f)).isFile());
  if (files.length === 0) return res.status(404).send('not found');

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="resutan-outputs.zip"');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => {
    console.error('zip error', err);
    if (!res.headersSent) res.status(500).send('Archive creation failed');
  });
  archive.pipe(res);

  files.forEach(file => {
    archive.file(path.join(sessionOutputs, file), { name: file });
  });

  archive.finalize();
});

app.use((err, req, res, next) => {
  logError(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Cleanup job: remove session folders older than TTL
const SESSION_TTL_MS = (parseInt(process.env.SESSION_TTL_SECONDS) || 1800) * 1000; // default 30min
setInterval(() => {
  try {
    const sessionsRoot = path.join(storageDir, 'sessions');
    if (!fs.existsSync(sessionsRoot)) return;
    const items = fs.readdirSync(sessionsRoot);
    const now = Date.now();
    for (const s of items) {
      const p = path.join(sessionsRoot, s);
      try {
        const st = fs.statSync(p);
        const age = now - st.mtimeMs;
        if (age > SESSION_TTL_MS) {
          fs.rmSync(p, { recursive: true, force: true });
          log(`removed expired session ${s}`);
        }
      } catch (e) { logError(e); }
    }
  } catch (e) { logError(e); }
}, 15 * 60 * 1000);

process.on('uncaughtException', err => {
  logError(`uncaughtException: ${err}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logError(`unhandledRejection: ${reason}`);
});

process.on('SIGTERM', () => log('SIGTERM received, shutting down'));
process.on('SIGINT', () => log('SIGINT received, shutting down'));
process.on('SIGQUIT', () => log('SIGQUIT received, shutting down'));
process.on('exit', code => log(`Process exiting with code ${code}`));
process.on('beforeExit', code => log(`Process beforeExit with code ${code}`));
process.on('uncaughtExceptionMonitor', err => logError(`uncaughtExceptionMonitor: ${err}`));
process.on('warning', warning => logError(`Warning: ${warning.name} ${warning.message}\n${warning.stack}`));

const server = app.listen(port, () => log(`Listening ${port} pid=${process.pid} env=${process.env.NODE_ENV || 'development'}`));
server.on('error', err => logError(`Server error: ${err}`));
