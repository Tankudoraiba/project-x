const { Worker } = require('bullmq');
const Redis = require('ioredis');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const archiver = require('archiver');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const STORAGE = process.env.STORAGE_PATH || '/data/storage';

const connection = new Redis(REDIS_URL);

const worker = new Worker('jobs', async job => {
  const data = job.data;
  const filePath = data.path;
  const ext = path.extname(filePath).toLowerCase();
  const outDir = path.join(STORAGE, 'outputs');
  fs.mkdirSync(outDir, { recursive: true });

  // simple passthrough processing: create a resized copy and if gif -> extract frames
  const baseName = path.basename(filePath, ext);

  try {
    // create resized png (example)
    const outPng = path.join(outDir, baseName + '_resized.png');
    await sharp(filePath).resize(800, 800, { fit: 'inside' }).toFile(outPng);

    if (ext === '.gif') {
      // extract frames to a temp dir
      const framesDir = path.join('/tmp', baseName + '_frames');
      fs.mkdirSync(framesDir, { recursive: true });

      await new Promise((resolve, reject) => {
        ffmpeg(filePath)
          .output(path.join(framesDir, 'frame-%04d.png'))
          .on('end', resolve)
          .on('error', reject)
          .run();
      });

      // zip the frames
      const zipPath = path.join(outDir, baseName + '_frames.zip');
      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip');
        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(framesDir, false);
        archive.finalize();
      });

      // cleanup frames
      fs.rmSync(framesDir, { recursive: true, force: true });
    }

    return { ok: true, outputs: [outPng] };
  } catch (err) {
    console.error('processing error', err);
    throw err;
  }
}, { connection });

worker.on('completed', job => console.log('job completed', job.id));
worker.on('failed', (job, err) => console.log('job failed', job.id, err));

console.log('worker started');
