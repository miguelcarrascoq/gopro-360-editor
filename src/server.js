import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdir, access, readdir, unlink } from 'fs/promises';
import { GoProProcessor } from './gopro-processor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const processor = new GoProProcessor();

// Ensure temp directory exists
const TEMP_DIR = join(process.cwd(), 'temp');
await mkdir(TEMP_DIR, { recursive: true });

// Serve static files
app.use(express.static(join(__dirname, '../public')));
app.use('/temp', express.static(TEMP_DIR));

// Store active processing jobs
const jobs = new Map();

// WebSocket connection for progress updates
wss.on('connection', (ws) => {
  console.log('Client connected');
  
  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Broadcast progress to all connected clients
function broadcastProgress(jobId, progress, status, message) {
  const data = JSON.stringify({ jobId, progress, status, message });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(data);
    }
  });
}

// API: Get file info
app.get('/api/info', async (req, res) => {
  try {
    const filePath = req.query.file;
    
    if (!filePath) {
      return res.status(400).json({ error: 'Missing file parameter' });
    }

    // Check if file exists
    try {
      await access(filePath);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    const validation = await processor.validate360File(filePath);
    
    if (!validation.valid) {
      return res.status(400).json({ error: validation.reason });
    }

    res.json(validation.info);
  } catch (err) {
    console.error('Error getting file info:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Generate preview
app.post('/api/preview', express.json(), async (req, res) => {
  try {
    const { filePath } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: 'Missing filePath' });
    }

    const validation = await processor.validate360File(filePath);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.reason });
    }

    const jobId = Date.now().toString();
    const outputPath = join(TEMP_DIR, `preview_${jobId}.mp4`);

    jobs.set(jobId, { status: 'processing', outputPath });

    res.json({ jobId, message: 'Preview generation started' });

    // Process in background
    (async () => {
      try {
        await processor.generatePreview(filePath, outputPath, (progress) => {
          broadcastProgress(jobId, progress, 'processing', 'Generating preview...');
        });

        jobs.set(jobId, { status: 'complete', outputPath });
        broadcastProgress(jobId, 100, 'complete', 'Preview ready');
      } catch (err) {
        console.error('Preview generation error:', err);
        jobs.set(jobId, { status: 'error', error: err.message });
        broadcastProgress(jobId, 0, 'error', err.message);
      }
    })();
  } catch (err) {
    console.error('Error starting preview:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Export trimmed video
app.post('/api/export', express.json(), async (req, res) => {
  try {
    const { filePath, startTime, endTime, quality = 'medium', outputName } = req.body;
    
    if (!filePath || startTime === undefined || endTime === undefined) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    if (startTime < 0 || endTime <= startTime) {
      return res.status(400).json({ error: 'Invalid time range' });
    }

    const validation = await processor.validate360File(filePath);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.reason });
    }

    const jobId = Date.now().toString();
    const sanitizedName = (outputName || `export_${jobId}`).replace(/[^a-z0-9_-]/gi, '_');
    const outputPath = join(TEMP_DIR, `${sanitizedName}.mp4`);

    jobs.set(jobId, { status: 'processing', outputPath });

    res.json({ jobId, message: 'Export started' });

    (async () => {
      try {
        await processor.exportTrimmed(
          filePath,
          outputPath,
          startTime,
          endTime,
          quality,
          (progress) => {
            broadcastProgress(jobId, progress, 'processing', 'Exporting video...');
          }
        );

        jobs.set(jobId, { status: 'complete', outputPath });
        broadcastProgress(jobId, 100, 'complete', 'Export complete');
      } catch (err) {
        console.error('Export error:', err);
        jobs.set(jobId, { status: 'error', error: err.message });
        broadcastProgress(jobId, 0, 'error', err.message);
      }
    })();
  } catch (err) {
    console.error('Error starting export:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Get job status
app.get('/api/job/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json(job);
});

// API: List temp files
app.get('/api/temp-files', async (req, res) => {
  try {
    const files = await readdir(TEMP_DIR);
    const fileList = files.map(f => ({
      name: f,
      path: `/temp/${f}`
    }));
    res.json(fileList);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Clean temp files
app.delete('/api/temp-files/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = join(TEMP_DIR, filename);
    await unlink(filePath);
    res.json({ message: 'File deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cleanup old temp files on startup
async function cleanupOldFiles() {
  try {
    const files = await readdir(TEMP_DIR);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const file of files) {
      const filePath = join(TEMP_DIR, file);
      const match = file.match(/(preview|export)_(\d+)/);
      
      if (match) {
        const timestamp = parseInt(match[2]);
        if (now - timestamp > maxAge) {
          await unlink(filePath).catch(() => {});
          console.log(`Cleaned up old file: ${file}`);
        }
      }
    }
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}

// Start server
server.listen(PORT, () => {
  console.log(`\n🎥 GoPro 360 Editor running at http://localhost:${PORT}\n`);
  cleanupOldFiles();
});
