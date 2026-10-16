import { spawn } from 'child_process';
import { mkdir } from 'fs/promises';
import { join } from 'path';

/**
 * Generate synthetic test files for GoPro 360 processing
 */
export class TestGenerator {
  /**
   * Generate a synthetic dual-stream .360-like test file
   * Creates two HEVC video streams that simulate GoPro EAC layout
   */
  async generateTestFile(outputPath, duration = 5) {
    const tempDir = join(process.cwd(), 'temp');
    await mkdir(tempDir, { recursive: true });

    const stream1Path = join(tempDir, 'stream1.mp4');
    const stream2Path = join(tempDir, 'stream2.mp4');

    console.log('Generating test streams...');

    try {
      // Generate first stream (front-facing, with blue color)
      await this._generateVideoStream(stream1Path, duration, 'blue', '0');
      
      // Generate second stream (back-facing, with green color)
      await this._generateVideoStream(stream2Path, duration, 'green', '1');

      console.log('Merging streams into .360 file...');

      // Merge both streams into a single file (simulating GoPro .360 structure)
      await this._mergeStreams(stream1Path, stream2Path, outputPath);

      console.log(`Test file created: ${outputPath}`);
      return outputPath;
      
    } catch (err) {
      throw new Error(`Failed to generate test file: ${err.message}`);
    }
  }

  _generateVideoStream(outputPath, duration, color, label) {
    return new Promise((resolve, reject) => {
      const args = [
        '-f', 'lavfi',
        '-i', `color=c=${color}:s=1920x960:d=${duration}`,
        '-f', 'lavfi',
        '-i', `sine=frequency=440:duration=${duration}`,
        '-vf', `drawtext=text='Stream ${label}':fontsize=120:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-c:a', 'aac',
        '-y',
        outputPath
      ];

      const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`Stream generation failed: ${stderr}`));
        }
        resolve(outputPath);
      });
    });
  }

  _mergeStreams(stream1Path, stream2Path, outputPath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', stream1Path,
        '-i', stream2Path,
        '-map', '0:v',
        '-map', '1:v',
        '-map', '0:a',
        '-c', 'copy',
        '-y',
        outputPath
      ];

      const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`Stream merge failed: ${stderr}`));
        }
        resolve(outputPath);
      });
    });
  }

  /**
   * Validate that a converted equirectangular file has correct properties
   */
  async validateEquirectangularOutput(filePath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', filePath,
        '-hide_banner'
      ];

      const ffprobe = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';

      ffprobe.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code !== 0 && !stderr.includes('Duration')) {
          return reject(new Error(`Validation failed: ${stderr}`));
        }

        // Check for video stream
        const hasVideo = /Stream.*Video/.test(stderr);
        
        // Check for expected equirectangular resolution (2:1 aspect ratio)
        // Match resolution from video stream line (e.g. "1920x960" or "3840x1920")
        const videoStreamMatch = stderr.match(/Stream.*Video.*?(\d{3,4})x(\d{3,4})/);
        let correctAspect = false;
        let resolution = 'unknown';
        
        if (videoStreamMatch) {
          const width = parseInt(videoStreamMatch[1]);
          const height = parseInt(videoStreamMatch[2]);
          resolution = `${width}x${height}`;
          const aspect = width / height;
          // Allow some tolerance for equirectangular (should be 2:1)
          correctAspect = Math.abs(aspect - 2.0) < 0.1;
        }

        // Check for audio
        const hasAudio = /Stream.*Audio/.test(stderr);

        resolve({
          valid: hasVideo && hasAudio,
          hasVideo,
          hasAudio,
          correctAspect,
          resolution
        });
      });
    });
  }
}
