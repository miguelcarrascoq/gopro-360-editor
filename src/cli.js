#!/usr/bin/env node
import { GoProProcessor } from './gopro-processor.js';
import { access } from 'fs/promises';
import { basename } from 'path';

const args = process.argv.slice(2);

function showHelp() {
  console.log(`
GoPro 360 Editor CLI

Usage:
  npm run cli <command> [options]

Commands:

  info <file.360>
    Show information about a .360 file

  convert <file.360> <output.mp4> [options]
    Convert a .360 file to an equirectangular MP4

    Options:
      --start <seconds>     Start time (default: 0)
      --end <seconds>       End time (default: full duration)
      --quality <level>     Quality: high, medium, low (default: medium)

Examples:

  # Show file information
  npm run cli info /path/to/video.360

  # Convert the full file
  npm run cli convert /path/to/video.360 output.mp4

  # Convert a trimmed segment
  npm run cli convert /path/to/video.360 output.mp4 --start 10 --end 30 --quality high
`);
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function showInfo(filePath) {
  if (!await fileExists(filePath)) {
    console.error(`❌ Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const processor = new GoProProcessor();
  
  try {
    console.log(`\n📊 Analyzing ${basename(filePath)}...\n`);
    
    const validation = await processor.validate360File(filePath);
    
    if (!validation.valid) {
      console.error(`❌ Error: ${validation.reason}`);
      process.exit(1);
    }

    const info = validation.info;
    
    console.log(`✓ Valid GoPro .360 file`);
    console.log(`\nInformation:`);
    console.log(`  Duration: ${formatTime(info.duration)}`);
    console.log(`  Video streams: ${info.videoStreams.length}`);
    
    info.videoStreams.forEach((stream, i) => {
      console.log(`    Stream ${i}: ${stream.width}x${stream.height} (${stream.codec})`);
    });
    
    console.log(`  Audio streams: ${info.audioStreams.length}`);
    
    info.audioStreams.forEach((stream, i) => {
      console.log(`    Stream ${i}: ${stream.codec}`);
    });
    
    console.log('');
    
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

async function convert(filePath, outputPath, options = {}) {
  if (!await fileExists(filePath)) {
    console.error(`❌ Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const processor = new GoProProcessor();
  
  try {
    console.log(`\n🎥 Converting ${basename(filePath)}...\n`);
    
    const validation = await processor.validate360File(filePath);
    
    if (!validation.valid) {
      console.error(`❌ Error: ${validation.reason}`);
      process.exit(1);
    }

    const info = validation.info;
    const startTime = options.start || 0;
    const endTime = options.end || info.duration;
    const quality = options.quality || 'medium';

    if (startTime < 0 || endTime > info.duration || startTime >= endTime) {
      console.error(`❌ Error: Invalid time range`);
      process.exit(1);
    }

    console.log(`  Input: ${basename(filePath)}`);
    console.log(`  Output: ${basename(outputPath)}`);
    console.log(`  Range: ${formatTime(startTime)} - ${formatTime(endTime)} (${formatTime(endTime - startTime)})`);
    console.log(`  Quality: ${quality}`);
    console.log('');

    let lastProgress = 0;
    
    await processor.exportTrimmed(
      filePath,
      outputPath,
      startTime,
      endTime,
      quality,
      (progress) => {
        const rounded = Math.floor(progress);
        if (rounded > lastProgress && rounded % 5 === 0) {
          process.stdout.write(`\r  Progress: ${'█'.repeat(rounded / 5)}${'░'.repeat(20 - rounded / 5)} ${rounded}%`);
          lastProgress = rounded;
        }
      }
    );

    console.log('\n\n✓ Conversion completed successfully!');
    console.log(`  File saved: ${outputPath}\n`);
    
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function parseArgs(args, startIndex) {
  const options = {};
  
  for (let i = startIndex; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];
    
    if (key === 'start' || key === 'end') {
      options[key] = parseFloat(value);
    } else {
      options[key] = value;
    }
  }
  
  return options;
}

// Main CLI handler
(async () => {
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case 'info':
      if (args.length < 2) {
        console.error('❌ Error: Missing input file');
        showHelp();
        process.exit(1);
      }
      await showInfo(args[1]);
      break;

    case 'convert':
      if (args.length < 3) {
        console.error('❌ Error: Missing input or output file');
        showHelp();
        process.exit(1);
      }
      const options = parseArgs(args, 3);
      await convert(args[1], args[2], options);
      break;

    default:
      console.error(`❌ Error: Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
})();
