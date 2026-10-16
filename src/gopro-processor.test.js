import { test } from 'node:test';
import assert from 'node:assert';
import { join } from 'path';
import { mkdir, unlink, access } from 'fs/promises';
import { GoProProcessor } from './gopro-processor.js';
import { TestGenerator } from './test-generator.js';

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
