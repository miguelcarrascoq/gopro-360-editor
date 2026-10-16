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
        const resMatch = match[4].match(/(\d+)x(\d+)/);
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

    return new Promise((resolve, reject) => {
      // Step 1: Stack the two EAC video streams vertically
      // Stream 0 (front) on top, Stream 1 (back) on bottom
      // Then convert from EAC (3:2 aspect) to equirectangular (2:1 aspect)
      const args = [
        '-i', inputPath,
        '-filter_complex',
        // Stack the two video streams vertically
        '[0:v:0][0:v:1]vstack=inputs=2[stacked];' +
        // Convert from EAC to equirectangular
        '[stacked]v360=eac:e:cubic:1920:960[equirect]',
        '-map', '[equirect]',
        '-map', '0:a:0?',  // Map audio if present
        '-c:v', 'libx264',  // Use H.264 for browser compatibility
        '-preset', 'fast',
        '-crf', '28',  // Lower quality for preview
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',  // Enable streaming
        '-y',
        outputPath
      ];

      const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
        
        if (onProgress) {
          const timeMatch = stderr.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
          if (timeMatch && info.duration > 0) {
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const seconds = parseFloat(timeMatch[3]);
            const currentTime = hours * 3600 + minutes * 60 + seconds;
            const progress = Math.min((currentTime / info.duration) * 100, 100);
            onProgress(progress);
          }
        }
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`ffmpeg failed: ${stderr}`));
        }
        resolve(outputPath);
      });
    });
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

    return new Promise((resolve, reject) => {
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
        '[stacked]v360=eac:e:cubic:3840:1920[equirect]',
        '-map', '[equirect]',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-preset', preset,
        '-crf', crf.toString(),
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        '-y',
        outputPath
      ];

      const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
        
        if (onProgress) {
          const timeMatch = stderr.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
          if (timeMatch && duration > 0) {
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const seconds = parseFloat(timeMatch[3]);
            const currentTime = hours * 3600 + minutes * 60 + seconds;
            const progress = Math.min((currentTime / duration) * 100, 100);
            onProgress(progress);
          }
        }
      });

      ffmpeg.on('close', async (code) => {
        if (code !== 0) {
          return reject(new Error(`ffmpeg failed: ${stderr}`));
        }
        
        // Inject 360 spherical metadata for YouTube/player compatibility
        try {
          await this.inject360Metadata(outputPath);
          resolve(outputPath);
        } catch (err) {
          reject(err);
        }
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
