import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { mkdir, access, readdir, readFile, unlink, stat } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { GoProProcessor } from './gopro-processor.js';
import { TestGenerator } from './test-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const processor = new GoProProcessor();

// Ensure temp directory exists
const TEMP_DIR = join(process.cwd(), 'temp');
const SAMPLES_DIR = join(process.cwd(), 'samples');
const SAMPLE_FILE = join(SAMPLES_DIR, 'example.360');
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

async function directoryIfExists(dirPath) {
  try {
    const info = await stat(dirPath);
    return info.isDirectory() ? dirPath : null;
  } catch {
    return null;
  }
}

async function getQuickPlaces() {
  const home = homedir();
  const candidates = [
    ['Home', home],
    ['Desktop', join(home, 'Desktop')],
    ['Desktop', join(home, 'Escritorio')],
    ['Documents', join(home, 'Documents')],
    ['Documents', join(home, 'Documentos')],
    ['Downloads', join(home, 'Downloads')],
    ['Downloads', join(home, 'Descargas')],
    ['Videos', join(home, 'Videos')],
    ['Videos', join(home, 'Vídeos')],
    ['OneDrive Videos', join(home, 'OneDrive', 'Videos')],
    ['OneDrive Desktop', join(home, 'OneDrive', 'Desktop')],
  ];
  const seen = new Set();
  const places = [];

  for (const [name, candidate] of candidates) {
    const dir = await directoryIfExists(candidate);
    if (!dir) continue;
    const key = resolve(dir).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({ name, path: dir });
  }

  return places;
}

async function listDrives() {
  if (process.platform !== 'win32') {
    return [{ name: '/', path: '/' }];
  }

  const drives = [];
  for (let code = 65; code <= 90; code++) {
    const drivePath = `${String.fromCharCode(code)}:\\`;
    if (await directoryIfExists(drivePath)) {
      drives.push({ name: drivePath, path: drivePath });
    }
  }
  return drives;
}

function browseNavigation(dirPath) {
  const parent = dirname(dirPath);
  if (parent !== dirPath) {
    return { canGoUp: true, upTarget: parent };
  }
  if (process.platform === 'win32') {
    return { canGoUp: true, upTarget: 'computer' };
  }
  return { canGoUp: false, upTarget: null };
}

async function listDirectory(dirPath) {
  const dir = resolve(dirPath);
  const info = await stat(dir);
  if (!info.isDirectory()) {
    const error = new Error('Not a folder');
    error.status = 400;
    throw error;
  }

  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      const error = new Error('Cannot open this folder');
      error.status = 403;
      throw error;
    }
    throw err;
  }

  const entries = [];
  const files = [];
  for (const entry of dirents) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push({ name: entry.name, path: full, kind: 'dir' });
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.360')) {
      files.push({ name: entry.name, path: full, kind: 'file' });
    }
  }

  await Promise.all(files.map(async (file) => {
    try {
      file.size = (await stat(file.path)).size;
    } catch {
      file.size = null;
    }
  }));
  entries.push(...files);

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  return {
    path: dir,
    ...browseNavigation(dir),
    entries,
  };
}

let samplePromise = null;

async function ensureSampleFile() {
  await mkdir(SAMPLES_DIR, { recursive: true });
  try {
    const info = await stat(SAMPLE_FILE);
    if (info.isFile() && info.size > 0) {
      return { name: 'example.360', path: SAMPLE_FILE, size: info.size };
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  console.log('Generating sample .360 file...');
  const generator = new TestGenerator();
  await generator.generateTestFile(SAMPLE_FILE, 5);
  const info = await stat(SAMPLE_FILE);
  return { name: 'example.360', path: SAMPLE_FILE, size: info.size };
}

function loadSampleFile() {
  if (!samplePromise) {
    samplePromise = ensureSampleFile().catch((err) => {
      samplePromise = null;
      console.error('Sample file unavailable:', err.message);
      return null;
    });
  }
  return samplePromise;
}

async function fileSizes(paths) {
  const requested = Array.isArray(paths) ? paths.slice(0, 32) : [];
  const sizes = {};
  await Promise.all(requested.map(async (filePath) => {
    if (typeof filePath !== 'string' || !filePath.trim()) return;
    try {
      const info = await stat(filePath);
      sizes[filePath] = info.isFile() ? info.size : null;
    } catch {
      sizes[filePath] = null;
    }
  }));
  return sizes;
}

async function defaultBrowsePath(places) {
  const videos = places.find((place) => place.name === 'Videos' || place.name === 'OneDrive Videos');
  if (videos) return videos.path;
  return places.find((place) => place.name === 'Home')?.path || homedir();
}

function runCommand(command, args, { windowsHide = true } = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, { windowsHide });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      resolveCommand({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function dialogWasCancelled(stderr, stdout) {
  const text = `${stderr}\n${stdout}`.toLowerCase();
  return text.includes('cancel');
}

async function openWindowsFileDialog() {
  const pickFile = join(tmpdir(), `gopro-360-pick-${randomBytes(8).toString('hex')}.txt`);
  const script = `
$pathFile = '${pickFile.replace(/'/g, "''")}'
$owner = $null
try {
  Add-Type -AssemblyName System.Windows.Forms
  $owner = New-Object System.Windows.Forms.Form
  $owner.TopMost = $true
  $owner.ShowInTaskbar = $false
  $owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
  $owner.Size = New-Object System.Drawing.Size(1, 1)
  $owner.Opacity = 0
  $owner.Show()
  $owner.Activate()
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Filter = 'GoPro 360 (*.360)|*.360|All files (*.*)|*.*'
  $dialog.Title = 'Select a GoPro .360 file'
  $dialog.CheckFileExists = $true
  $dialog.Multiselect = $false
  $videos = [Environment]::GetFolderPath('MyVideos')
  if ($videos) { $dialog.InitialDirectory = $videos }
  $result = $dialog.ShowDialog($owner)
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    [System.IO.File]::WriteAllText($pathFile, $dialog.FileName, [System.Text.UTF8Encoding]::new($false))
  }
} finally {
  if ($owner) { $owner.Close(); $owner.Dispose() }
}
`.trim();

  const { code, stderr } = await runCommand('powershell.exe', [
    '-STA', '-NoProfile', '-Command', script,
  ], { windowsHide: false });

  try {
    const picked = (await readFile(pickFile, 'utf8')).replace(/^\uFEFF/, '').trim();
    return picked || null;
  } catch (err) {
    if (err.code === 'ENOENT') {
      if (code !== 0) throw new Error(stderr || 'Could not open the file dialog');
      return null;
    }
    throw err;
  } finally {
    await unlink(pickFile).catch(() => {});
  }
}

async function openFileDialog() {
  if (process.platform === 'win32') return openWindowsFileDialog();

  if (process.platform === 'darwin') {
    const { code, stdout, stderr } = await runCommand('osascript', [
      '-e', 'POSIX path of (choose file with prompt "Select a GoPro .360 file")',
    ]);
    if (code !== 0) {
      if (dialogWasCancelled(stderr, stdout)) return null;
      throw new Error(stderr || 'Could not open the file dialog');
    }
    return stdout || null;
  }

  try {
    const { code, stdout, stderr } = await runCommand('zenity', [
      '--file-selection',
      '--title=Select a GoPro .360 file',
      '--file-filter=*.360',
    ]);
    if (code !== 0) {
      if (code === 1 || dialogWasCancelled(stderr, stdout)) return null;
      throw new Error(stderr || 'Could not open the file dialog');
    }
    return stdout || null;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const { code, stdout, stderr } = await runCommand('kdialog', [
    '--getopenfilename', homedir(), '*.360|GoPro 360 files',
  ]);
  if (code !== 0) {
    if (dialogWasCancelled(stderr, stdout)) return null;
    throw new Error(stderr || 'Could not open the file dialog. Install zenity or kdialog.');
  }
  return stdout || null;
}

let fileDialogOpen = false;

app.get('/api/fs', async (req, res) => {
  try {
    const places = await getQuickPlaces();
    const drives = await listDrives();
    const sample = await loadSampleFile();

    if (req.query.view === 'computer') {
      return res.json({
        path: '',
        canGoUp: false,
        upTarget: null,
        atComputer: true,
        places,
        drives,
        sample,
        entries: drives.map((drive) => ({ name: drive.name, path: drive.path, kind: 'dir' })),
      });
    }

    const requested = typeof req.query.path === 'string' ? req.query.path : '';
    const listing = await listDirectory(requested || await defaultBrowsePath(places));
    res.json({ ...listing, atComputer: false, places, drives, sample });
  } catch (err) {
    const status = err.status || (err.code === 'ENOENT' ? 404 : 500);
    const message = err.code === 'ENOENT' ? 'Folder not found' : err.message;
    res.status(status).json({ error: message });
  }
});

app.post('/api/file-sizes', express.json(), async (req, res) => {
  const paths = req.body?.paths;
  if (paths !== undefined && !Array.isArray(paths)) {
    return res.status(400).json({ error: 'paths must be a list' });
  }
  if (Array.isArray(paths) && paths.length > 32) {
    return res.status(400).json({ error: 'Too many paths' });
  }

  try {
    res.json({ sizes: await fileSizes(paths) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pick-file', async (req, res) => {
  if (fileDialogOpen) {
    return res.status(409).json({ error: 'A file dialog is already open' });
  }

  fileDialogOpen = true;
  try {
    const picked = await openFileDialog();
    if (!picked) return res.json({ cancelled: true });
    res.json({ path: picked });
  } catch (err) {
    console.error('File dialog error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    fileDialogOpen = false;
  }
});

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
    const { filePath, quality = 'medium' } = req.body;
    
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
        }, quality);

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
  loadSampleFile();
});
