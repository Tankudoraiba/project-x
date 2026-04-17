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
[ storageDir, originals, outputs, tmp ].forEach(d => { if(!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }) });

const upload = multer({ dest: tmp });

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
  for (const t of tasks) {
    const src = path.join(req.sessionOriginals, t.name);
    if (!fs.existsSync(src)) continue;
    const ext = (t.toFormat || path.extname(t.name).slice(1)).toLowerCase();

    const outNameBase = path.basename(t.name, path.extname(t.name));
    if (t.action === 'frames') {
      try {
        const image = sharp(src, { pages: -1 });
        const metadata = await image.metadata();
        const frames = metadata.pages || 1;
        const zipName = `${outNameBase}-${randomSuffix(4)}-frames.zip`;
        const zipPath = path.join(req.sessionOutputs, zipName);
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip');
        archive.pipe(output);
        for (let i = 0; i < frames; i++) {
          const buf = await sharp(src, { page: i }).png().toBuffer();
          archive.append(buf, { name: `${outNameBase}-frame-${i}.png` });
        }
        await archive.finalize();
        outFiles.push({ input: t.name, output: zipName });
      } catch (e) {
        console.error('frames error', e);
      }
      continue;
    }

    const rand = randomSuffix(4);
    const outName = `${outNameBase}-${rand}.${ext}`;
    const outPath = path.join(req.sessionOutputs, outName);
    try {
      let pipeline = sharp(src, { animated: true });
      pipeline = pipeline.withMetadata();
      if (t.width || t.height) {
        const preserve = typeof t.preserve === 'boolean' ? t.preserve : true;
        const fit = preserve ? 'inside' : 'fill';
        pipeline = pipeline.resize(t.width || null, t.height || null, { fit });
      }

      if (ext === 'jpg' || ext === 'jpeg') await pipeline.jpeg().toFile(outPath);
      else if (ext === 'png') await pipeline.png().toFile(outPath);
      else if (ext === 'webp') await pipeline.webp().toFile(outPath);
      else if (ext === 'heic') await pipeline.toFile(outPath);
      else await pipeline.toFile(outPath);
      outFiles.push({ input: t.name, output: outName });
    } catch (e) {
      console.error('process error', e);
    }
  }
  res.json({ outputs: outFiles });
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
          console.log('removed expired session', s);
        }
      } catch (e) {}
    }
  } catch (e) { console.error('cleanup job error', e); }
}, 15 * 60 * 1000);

app.listen(port, () => console.log(`Listening ${port}`));
