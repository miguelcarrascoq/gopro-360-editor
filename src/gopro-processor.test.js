import { test } from 'node:test';
import assert from 'node:assert';
import { join } from 'path';
import { mkdir, unlink, access } from 'fs/promises';
import { GoProProcessor, ffmpegProgressPercent, previewQualitySettings } from './gopro-processor.js';
import { TestGenerator } from './test-generator.js';

test('ffprobe resolution ignores codec tags like 0x31637668', () => {
  const processor = new GoProProcessor();
  const sample = [
    'Duration: 00:08:02.50, start: 0.000000, bitrate: 66408 kb/s',
    'Stream #0:0[0x1](eng): Video: hevc (Main) (hvc1 / 0x31637668), yuvj420p(pc, bt709), 4096x1344 [SAR 1:1 DAR 64:21], 29969 kb/s',
    'Stream #0:1[0x2](eng): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo',
    'Stream #0:5[0x6](eng): Video: hevc (Main) (hvc1 / 0x31637668), yuvj420p(pc, bt709), 4096x1344, 29968 kb/s'
  ].join('\n');

  const info = processor._parseFFprobeOutput(sample);
  assert.strictEqual(info.videoStreams.length, 2);
  assert.strictEqual(info.videoStreams[0].width, 4096);
  assert.strictEqual(info.videoStreams[0].height, 1344);
  assert.ok(info.duration > 482 && info.duration < 483);
});

test('preview quality maps to a proxy size', () => {
  assert.deepStrictEqual(previewQualitySettings('low'), {
    width: 960,
    height: 480,
    crf: '30',
    preset: 'veryfast'
  });
  assert.deepStrictEqual(previewQualitySettings('medium'), {
    width: 1280,
    height: 640,
    crf: '28',
    preset: 'veryfast'
  });
  assert.deepStrictEqual(previewQualitySettings('high'), {
    width: 1920,
    height: 960,
    crf: '23',
    preset: 'fast'
  });
  assert.strictEqual(previewQualitySettings('unknown').width, 1280);
});

test('ffmpeg progress uses the latest timestamp', () => {
  const chunk = [
    'frame=1 fps=0.0 time=00:00:00.03 bitrate=N/A',
    'frame=90 fps=30 time=00:00:03.00 bitrate=800k',
    'out_time=00:01:30.500000'
  ].join('\n');

  const progress = ffmpegProgressPercent(chunk, 180);
  assert.ok(progress > 50 && progress < 51, `expected ~50.3%, got ${progress}`);
  assert.strictEqual(ffmpegProgressPercent('no timestamps', 10), null);
});

const TEST_DIR = join(process.cwd(), 'test-output');
const TEST_FILE = join(TEST_DIR, 'test_dual_stream.mp4');
const TEST_OUTPUT = join(TEST_DIR, 'output.mp4');

test('GoPro 360 Processor Tests', async (t) => {
  const processor = new GoProProcessor();
  const generator = new TestGenerator();

  await t.before(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  await t.after(async () => {
    // Cleanup test files
    const files = [TEST_FILE, TEST_OUTPUT];
    for (const file of files) {
      try {
        await unlink(file);
      } catch {}
    }
  });

  await t.test('should generate synthetic test file', async () => {
    await generator.generateTestFile(TEST_FILE, 3);
    
    try {
      await access(TEST_FILE);
      assert.ok(true, 'Test file created');
    } catch {
      assert.fail('Test file was not created');
    }
  });

  await t.test('should validate .360 file structure', async () => {
    const validation = await processor.validate360File(TEST_FILE);
    
    assert.strictEqual(validation.valid, true, 'File should be valid');
    assert.ok(validation.info.hasMultipleVideoStreams, 'Should have multiple video streams');
    assert.ok(validation.info.videoStreams.length >= 2, 'Should have at least 2 video streams');
    assert.ok(validation.info.duration > 0, 'Should have duration > 0');
  });

  await t.test('should get file info', async () => {
    const info = await processor.getFileInfo(TEST_FILE);
    
    assert.ok(info.duration > 0, 'Duration should be positive');
    assert.ok(info.videoStreams.length >= 2, 'Should have multiple video streams');
    assert.ok(info.audioStreams.length >= 1, 'Should have audio');
  });

  await t.test('should convert to equirectangular', async () => {
    await processor.exportTrimmed(TEST_FILE, TEST_OUTPUT, 0, 2, 'low', (progress) => {
      console.log(`  Progress: ${Math.round(progress)}%`);
    });

    try {
      await access(TEST_OUTPUT);
      assert.ok(true, 'Output file created');
    } catch {
      assert.fail('Output file was not created');
    }

    const validation = await generator.validateEquirectangularOutput(TEST_OUTPUT);
    
    assert.strictEqual(validation.hasVideo, true, 'Output should have video');
    assert.strictEqual(validation.hasAudio, true, 'Output should have audio');
    assert.strictEqual(validation.correctAspect, true, 'Output should have 2:1 aspect ratio');
    
    console.log(`  Output resolution: ${validation.resolution}`);
  });

  await t.test('should trim video correctly', async () => {
    const info = await processor.getFileInfo(TEST_FILE);
    const trimStart = 0.5;
    const trimEnd = 1.5;
    const expectedDuration = trimEnd - trimStart;

    const trimmedOutput = join(TEST_DIR, 'trimmed.mp4');
    
    await processor.exportTrimmed(
      TEST_FILE,
      trimmedOutput,
      trimStart,
      trimEnd,
      'low'
    );

    const outputInfo = await processor.getFileInfo(trimmedOutput);
    
    // Allow 0.5s tolerance for trimming precision
    const durationDiff = Math.abs(outputInfo.duration - expectedDuration);
    assert.ok(durationDiff < 0.5, `Trimmed duration should be close to ${expectedDuration}s (got ${outputInfo.duration}s)`);
    
    await unlink(trimmedOutput);
  });

  await t.test('should reject invalid files', async () => {
    const validation = await processor.validate360File('/nonexistent/file.360');
    
    assert.strictEqual(validation.valid, false, 'Nonexistent file should be invalid');
    assert.ok(validation.reason, 'Should provide a reason');
  });
});
