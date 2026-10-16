import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { stat, unlink } from 'fs/promises';
import path from 'path';

/**
 * GoPro .360 file processor
 * 
 * GoPro MAX .360 files contain:
 * - Stream 0: Front-facing EAC video (HEVC)
 * - Stream 1: Back-facing EAC video (HEVC)
 * - Stream 2: Audio (AAC)
 * - Stream 3: GPMF telemetry data
 * 
 * EAC (Equi-Angular Cubemap) layout from GoPro:
 * - Each stream is 1/2 the sphere
 * - Need to be stacked vertically before converting to equirectangular
 */

/**
 * Latest encode position reported by ffmpeg, as a percent of duration.
 * ffmpeg prints a new `time=` (stderr) or `out_time=` (-progress) on every
 * update. Callers must use the last match in the chunk: the first one is the
 * oldest timestamp and stays near 0% for the whole job.
 */
export function ffmpegProgressPercent(text, durationSeconds) {
  if (!(durationSeconds > 0) || !text) return null;

  const pattern = /(?:out_)?time=(\d+):(\d+):(\d+(?:\.\d+)?)/g;
  let match;
  let last = null;
  while ((match = pattern.exec(text)) !== null) {
    last = match;
  }
  if (!last) return null;

  const currentTime = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
  return Math.min((currentTime / durationSeconds) * 100, 100);
}

export class GoProProcessor {
  /**
   * Get detailed info about a .360 file
   */
  async getFileInfo(filePath) {
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
          return reject(new Error(`ffprobe failed: ${stderr}`));
        }

        const info = this._parseFFprobeOutput(stderr);
        resolve(info);
      });
    });
  }

  _parseFFprobeOutput(output) {
    const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
    const videoStreams = [];
    const audioStreams = [];
    
    const streamMatches = output.matchAll(/Stream #(\d+):(\d+).*?: (Video|Audio): ([^\n]+)/g);
    for (const match of streamMatches) {
      const streamInfo = {
        index: parseInt(match[2]),
        type: match[3].toLowerCase(),
        codec: match[4]
      };
      
      if (streamInfo.type === 'video') {
        // Skip codec tags such as 0x31637668; the real size is 4096x1344.
        const resMatch = match[4].match(/(\d{2,5})x(\d{2,5})(?!\d)/);
        if (resMatch) {
          streamInfo.width = parseInt(resMatch[1]);
          streamInfo.height = parseInt(resMatch[2]);
        }
        videoStreams.push(streamInfo);
      } else if (streamInfo.type === 'audio') {
        audioStreams.push(streamInfo);
      }
    }

    let duration = 0;
    if (durationMatch) {
      const hours = parseInt(durationMatch[1]);
      const minutes = parseInt(durationMatch[2]);
      const seconds = parseFloat(durationMatch[3]);
      duration = hours * 3600 + minutes * 60 + seconds;
    }

    return {
      duration,
      videoStreams,
      audioStreams,
      hasMultipleVideoStreams: videoStreams.length >= 2
    };
  }

  /**
   * Generate a preview proxy file (lower resolution for browser playback)
   * Converts dual EAC streams to equirectangular
   */
  async generatePreview(inputPath, outputPath, onProgress) {
    const info = await this.getFileInfo(inputPath);
    
    if (!info.hasMultipleVideoStreams) {
      throw new Error('File does not contain dual video streams (not a GoPro .360 file)');
    }

    // Shrink each EAC half before v360. A MAX 2 clip is two 4096x1344
    // HEVC streams; projecting that at full size just to preview 720p
    // spends minutes before the first percent tick.
    const previewWidth = 1280;
    const previewHeight = 640;
    const args = [
      '-i', inputPath,
      '-filter_complex',
      `[0:v:0]scale=${previewWidth}:-2[front];` +
      `[0:v:1]scale=${previewWidth}:-2[back];` +
      `[front][back]vstack=inputs=2,` +
      `v360=input=eac:output=equirect:interp=cubic:w=${previewWidth}:h=${previewHeight}[equirect]`,
      '-map', '[equirect]',
      '-map', '0:a:0?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '28',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-progress', 'pipe:1',
      '-stats_period', '0.5',
      '-y',
      outputPath
    ];

    await this._runFfmpeg(args, info.duration, onProgress);
    return outputPath;
  }

  /**
   * Export trimmed segment as equirectangular MP4 with 360 metadata
   */
  async exportTrimmed(inputPath, outputPath, startTime, endTime, quality = 'high', onProgress) {
    const info = await this.getFileInfo(inputPath);
    
    if (!info.hasMultipleVideoStreams) {
      throw new Error('File does not contain dual video streams (not a GoPro .360 file)');
    }

    const duration = endTime - startTime;
    let crf, preset;
    switch (quality) {
      case 'high':
        crf = 18;
        preset = 'slow';
        break;
      case 'medium':
        crf = 23;
        preset = 'medium';
        break;
      case 'low':
        crf = 28;
        preset = 'fast';
        break;
      default:
        crf = 23;
        preset = 'medium';
    }

    const args = [
        '-ss', startTime.toString(),
        '-i', inputPath,
        '-t', duration.toString(),
        '-filter_complex',
        // Stack and convert to equirectangular at full resolution
        '[0:v:0][0:v:1]vstack=inputs=2[stacked];' +
        '[stacked]v360=input=eac:output=equirect:interp=cubic:w=3840:h=1920[equirect]',
        '-map', '[equirect]',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-preset', preset,
        '-crf', crf.toString(),
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        '-progress', 'pipe:1',
        '-stats_period', '0.5',
        '-y',
        outputPath
      ];

    await this._runFfmpeg(args, duration, onProgress);
    await this.inject360Metadata(outputPath);
    return outputPath;
  }

  _runFfmpeg(args, duration, onProgress) {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      let lastProgress = -1;

      const report = (chunk) => {
        const progress = ffmpegProgressPercent(chunk.toString(), duration);
        if (progress == null || progress <= lastProgress || !onProgress) return;
        lastProgress = progress;
        onProgress(progress);
      };

      ffmpeg.stdout.on('data', report);
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > 100000) stderr = stderr.slice(-50000);
        report(data);
      });

      ffmpeg.on('error', reject);
      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`ffmpeg failed: ${stderr}`));
        }
        resolve();
      });
    });
  }

  /**
   * Inject spherical 360 metadata into MP4 file
   * Uses spatial-media tool method via ffmpeg
   */
  async inject360Metadata(filePath) {
    const tempPath = filePath + '.temp.mp4';
    
    return new Promise((resolve, reject) => {
      // Add spherical metadata using ffmpeg
      const metadataXML = `<?xml version="1.0"?>
<rdf:SphericalVideo
xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
xmlns:GSpherical="http://ns.google.com/videos/1.0/spherical/">
<GSpherical:Spherical>true</GSpherical:Spherical>
<GSpherical:Stitched>true</GSpherical:Stitched>
<GSpherical:StitchingSoftware>GoPro 360 Editor</GSpherical:StitchingSoftware>
<GSpherical:ProjectionType>equirectangular</GSpherical:ProjectionType>
</rdf:SphericalVideo>`;

      const args = [
        '-i', filePath,
        '-c', 'copy',
        '-metadata:s:v:0', `spherical-video=${Buffer.from(metadataXML).toString('base64')}`,
        '-y',
        tempPath
      ];

      const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', async (code) => {
        if (code !== 0) {
          return reject(new Error(`Metadata injection failed: ${stderr}`));
        }

        try {
          await unlink(filePath);
          await stat(tempPath);
          
          // Rename temp to original
          const { default: fs } = await import('fs/promises');
          await fs.rename(tempPath, filePath);
          resolve(filePath);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  /**
   * Validate if a file is a GoPro .360 file
   */
  async validate360File(filePath) {
    if (!existsSync(filePath)) {
      return { valid: false, reason: 'File does not exist' };
    }

    try {
      const info = await this.getFileInfo(filePath);
      
      if (!info.hasMultipleVideoStreams) {
        return { valid: false, reason: 'Not a dual-stream .360 file' };
      }

      if (info.videoStreams.length < 2) {
        return { valid: false, reason: 'Missing video streams' };
      }

      return { valid: true, info };
    } catch (err) {
      return { valid: false, reason: err.message };
    }
  }
}
