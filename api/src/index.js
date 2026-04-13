const express = require('express');
const multer = require('multer');
const { Queue } = require('bullmq');
const Redis = require('ioredis');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const STORAGE = process.env.STORAGE_PATH || '/data/storage';

// ensure storage
fs.mkdirSync(STORAGE, { recursive: true });

const connection = new Redis(REDIS_URL);
const queue = new Queue('jobs', { connection });

const app = express();
const upload = multer({ dest: '/tmp/uploads' });

app.use(express.json());

app.post('/api/upload', upload.array('files'), async (req, res) => {
  const files = req.files || [];
  const jobs = [];

  for (const file of files) {
    const id = uuidv4();
    const dest = path.join(STORAGE, id + path.extname(file.originalname));
    fs.copyFileSync(file.path, dest);

    const job = await queue.add('process-file', {
      id,
      originalName: file.originalname,
      path: dest,
      // default settings; frontend may override per file
      settings: req.body.settings || {}
    });
    jobs.push({ jobId: job.id, fileId: id });
  }

  res.json({ ok: true, jobs });
});

app.get('/api/ping', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API listening on ${port}`));
