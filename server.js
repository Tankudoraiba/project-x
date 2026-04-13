const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const archiver = require('archiver');
const { decode } = require('heic-decode');
const mime = require('mime-types');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

// Remove or block problematic Permissions-Policy / Permission-Policy headers
// This prevents browsers from logging warnings about unrecognized or origin-trial features
app.use((req, res, next) => {
  try {
    // remove any already-set header
    if (typeof res.removeHeader === 'function') {
      res.removeHeader('Permissions-Policy');
      res.removeHeader('Permission-Policy');
      res.removeHeader('Sec-Permissions-Policy');
    }
    // prevent future sets of these headers by overriding setHeader
    const originalSet = res.setHeader.bind(res);
    res.setHeader = (name, value) => {
      const n = String(name).toLowerCase();
      if (n === 'permissions-policy' || n === 'permission-policy' || n === 'sec-permissions-policy') return;
      return originalSet(name, value);
    };
  } catch (e) {
    // ignore
  }
  next();
});

const storageDir = path.join(__dirname, 'storage');
const originals = path.join(storageDir, 'originals');
const outputs = path.join(storageDir, 'outputs');
const tmp = path.join(storageDir, 'tmp');
[ storageDir, originals, outputs, tmp ].forEach(d => { if(!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }) });

const upload = multer({ dest: tmp });

// list stored files
app.get('/api/list', (req, res) => {
  const files = fs.readdirSync(originals).map(f => ({ name: f }));
  res.json(files);
});

// upload one or many
app.post('/api/upload', upload.array('files'), async (req, res) => {
  const results = [];
  for (const file of req.files) {
    const dest = path.join(originals, file.originalname);
    // if HEIC, convert to jpeg for storage preview
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.heic') {
      try {
        const input = fs.readFileSync(file.path);
        const decoded = await decode(input);
        const outPath = dest.replace(/\.heic$/i, '.jpg');
        await sharp(decoded.data, { raw: { width: decoded.width, height: decoded.height, channels: decoded.channels } }).jpeg().toFile(outPath);
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

// process endpoint: accepts array of tasks with settings per file OR a global setting
// tasks: [{ name, action: 'convert'|'resize'|'frames', toFormat, width, height, crop }]
app.post('/api/process', async (req, res) => {
  const tasks = req.body.tasks || [];
  const outFiles = [];
  for (const t of tasks) {
    const src = path.join(originals, t.name);
    if (!fs.existsSync(src)) continue;
    const ext = (t.toFormat || path.extname(t.name).slice(1)).toLowerCase();

    const outNameBase = path.basename(t.name, path.extname(t.name));
    if (t.action === 'frames') {
      // extract GIF frames using sharp by converting each frame - sharp can read animated gif as pages
      try {
        const image = sharp(src, { pages: -1 });
        const metadata = await image.metadata();
        const frames = metadata.pages || 1;
        const zipName = `${outNameBase}-frames.zip`;
        const zipPath = path.join(outputs, zipName);
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip');
        archive.pipe(output);
        for (let i = 0; i < frames; i++) {
          const buf = await sharp(src, { page: i }).png().toBuffer();
          archive.append(buf, { name: `${outNameBase}-frame-${i}.png` });
        }
        await archive.finalize();
        outFiles.push(zipName);
      } catch (e) {
        console.error('frames error', e);
      }
      continue;
    }

    let pipeline = sharp(src, { animated: true });
    if (t.crop) {
      // crop: expects { left, top, width, height } or { width, height, gravity, preserveAspect }
      if (t.crop.left != null) pipeline = pipeline.extract({ left: t.crop.left, top: t.crop.top, width: t.crop.width, height: t.crop.height });
      else if (t.crop.width && t.crop.height && t.crop.gravity) {
        // when gravity-based crop is requested, use resize with fit depending on preserveAspect
        const fitMode = t.crop.preserveAspect === false ? 'fill' : 'cover';
        pipeline = pipeline.resize(t.crop.width, t.crop.height, { position: t.crop.gravity, fit: fitMode });
      }
    }
    if (t.width || t.height) {
      // when resizing after crop, respect preserveAspect if provided
      const preserve = t.crop && typeof t.crop.preserveAspect !== 'undefined' ? t.crop.preserveAspect : true;
      const fit = preserve ? 'inside' : 'fill';
      pipeline = pipeline.resize(t.width || null, t.height || null, { fit });
    }

    const outName = `${outNameBase}.${ext}`;
    const outPath = path.join(outputs, outName);
    try {
      if (ext === 'jpg' || ext === 'jpeg') await pipeline.jpeg().toFile(outPath);
      else if (ext === 'png') await pipeline.png().toFile(outPath);
      else if (ext === 'webp') await pipeline.webp().toFile(outPath);
      else if (ext === 'heic') await pipeline.toFile(outPath); // sharp may write heif if libvips supports it
      else await pipeline.toFile(outPath);
      outFiles.push(outName);
    } catch (e) {
      console.error('process error', e);
    }
  }
  res.json({ outputs: outFiles });
});

app.get('/storage/outputs/:file', (req, res) => {
  const p = path.join(outputs, req.params.file);
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  res.sendFile(p);
});

app.listen(port, () => console.log(`Listening ${port}`));
