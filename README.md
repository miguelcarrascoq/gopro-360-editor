# 🎥 GoPro 360 Editor

Free local desktop tool to preview, trim, and export GoPro MAX / MAX 2 `.360` files as equirectangular MP4 videos compatible with YouTube and 360 players.

## ✨ Features

- **Interactive 360° preview**: Drag the mouse to look around in the video
- **Visual trim**: Pick start and end on an interactive timeline
- **MP4 export**: Convert to equirectangular format with spherical metadata added automatically
- **Audio preserved**: Keeps every audio track from the original file
- **Adjustable quality**: Choose high, medium, or low quality for export
- **Local web UI**: Use it from your browser without sending data to the cloud
- **CLI included**: Command-line tool for batch conversions

## 🔧 System requirements

- macOS (Apple Silicon or Intel; any platform with Node and ffmpeg will work)
- [Node.js](https://nodejs.org/) v18 or later (already installed if you meet the requirements)
- [ffmpeg](https://ffmpeg.org/) with `v360` support (already installed if you meet the requirements)

### Check your installation

```bash
node --version  # Should show v18.0.0 or later
ffmpeg -version # Should include the v360 filter
```

## 📦 Installation

1. **Clone or download this repository**:

```bash
git clone <repo-url>
cd gopro-360-editor
```

2. **Install dependencies**:

```bash
npm install
```

That's it. No extra configuration is required.

## 🚀 Usage

### Web interface (recommended)

1. **Start the server**:

```bash
npm start
```

2. **Open it in the browser**:

Go to [http://localhost:3000](http://localhost:3000)

3. **Load a file**:
   - Paste the full path to your `.360` file (example: `/Users/your-name/Videos/GS010001.360`)
   - Click "Load file"

4. **Generate a preview**:
   - Click "Generate preview" (this can take a few minutes)
   - When it is ready, you will see the interactive 360° video
   - **Drag with the mouse** to look around
   - Use the **▶** button to play or pause

5. **Trim (optional)**:
   - Drag the **green** (start) and **red** (end) markers on the timeline
   - The selected segment duration updates in real time

6. **Export**:
   - Choose the quality you want:
     - **High**: Best quality, larger files, slower conversion (CRF 18)
     - **Medium**: Balance of quality and size (CRF 23, recommended)
     - **Low**: Fast conversion, lower quality (CRF 28)
   - Enter a file name (optional)
   - Click "Export MP4"
   - The file is saved in the project's `temp/` folder

### Command line (CLI)

Useful for batch conversions or automated scripts.

**Show file information**:

```bash
npm run cli info /path/to/your/video.360
```

**Convert the full file**:

```bash
npm run cli convert /path/to/your/video.360 output.mp4
```

**Convert a trimmed segment**:

```bash
npm run cli convert /path/to/your/video.360 output.mp4 --start 30 --end 120 --quality high
```

CLI options:
- `--start <seconds>`: Trim start time (default: 0)
- `--end <seconds>`: Trim end time (default: full duration)
- `--quality <level>`: Output quality — `high`, `medium`, `low` (default: medium)

**Full example**:

```bash
# Export from second 10 to 45 at high quality
npm run cli convert ~/Videos/GS010001.360 my_clip.mp4 --start 10 --end 45 --quality high
```

## 🧪 Tests

Run the automated tests (they generate synthetic test files and validate the conversion):

```bash
npm test
```

The tests check:
- Generation of dual-stream test files
- Validation of .360 files
- Conversion to equirectangular format
- Correct 2:1 aspect ratio
- Audio preservation
- Trim accuracy

## 📁 Project structure

```
gopro-360-editor/
├── src/
│   ├── server.js              # Express server with REST API and WebSocket
│   ├── gopro-processor.js     # ffmpeg processing logic
│   ├── cli.js                 # Command-line tool
│   ├── test-generator.js      # Test file generator
│   └── gopro-processor.test.js # Test suite
├── public/
│   ├── index.html             # Web interface
│   └── app.js                 # JavaScript client with three.js
├── temp/                      # Temporary files and exports
├── test-output/               # Test output
├── package.json
└── README.md
```

## 🎯 How it works

### GoPro `.360` files

GoPro MAX `.360` files contain:
- **Stream 0**: Front video in EAC format (HEVC)
- **Stream 1**: Back video in EAC format (HEVC)
- **Stream 2**: Audio (AAC)
- **Stream 3**: GPMF telemetry (optional)

### Conversion process

1. **Extraction**: Both HEVC video streams are extracted
2. **Stacking**: The streams are stacked vertically (front on top, back on the bottom)
3. **Conversion**: ffmpeg's `v360` filter converts EAC to equirectangular
4. **Re-encoding**: The video is encoded as H.264 for browser compatibility
5. **Metadata injection**: Spherical metadata is added for YouTube and 360 players

The conversion uses this ffmpeg command (simplified):

```bash
ffmpeg -i input.360 \
  -filter_complex "[0:v:0][0:v:1]vstack=inputs=2[stacked];[stacked]v360=eac:e:cubic:3840:1920" \
  -c:v libx264 -preset medium -crf 23 \
  -c:a aac -b:a 192k \
  output.mp4
```

## 🐛 Troubleshooting

### "File not found" or "Not a dual-stream .360 file"

- Make sure the file path is correct and complete
- Confirm the file is a real GoPro MAX `.360` (and was not just renamed)

### The preview does not load or stays black

- Wait until the preview conversion finishes (it can take several minutes)
- Check the browser console (F12) for errors
- Make sure port 3000 is not blocked

### ffmpeg not found

```bash
# On macOS with Homebrew:
brew install ffmpeg

# On Linux (Ubuntu/Debian):
sudo apt install ffmpeg

# Check the installation:
ffmpeg -version
```

### Conversion is very slow

- Use "low" quality for quick tests
- Large files (4K+) can take a while to convert
- "High quality" uses the "slow" preset, which is much slower

### Exported files are very large

- Lower the quality to "medium" or "low"
- 360° videos are naturally large (3840x1920 at 30fps)
- Compress the final file with extra tools if you need a smaller size

## 🌐 Output format compatibility

Exported MP4 files work with:

- ✅ YouTube (direct upload as a 360° video)
- ✅ Facebook 360
- ✅ VLC Media Player
- ✅ GoPro Player (as an equirectangular video)
- ✅ Web 360° video players
- ✅ Virtual reality headsets

The resulting video has:
- Format: MP4 (H.264 + AAC)
- Projection: Equirectangular (2:1 aspect ratio)
- Metadata: Spherical video (Google spatial media)
- Resolution: 3840x1920 (4K), or whatever the source provides

## 📝 Technical notes

- **EAC vs equirectangular**: EAC (Equi-Angular Cubemap) is GoPro MAX's native format. It stores video more efficiently, but standard players cannot play it. Converting to equirectangular makes playback universal.

- **Conversion quality**: The `v360` filter with the `cubic` method gives good quality at a reasonable speed. `lanczos` can look better, but it is significantly slower.

- **Spherical metadata**: Injected using the Google Spatial Media standard so YouTube and other services detect the video as 360° automatically.

- **Web preview**: Browsers cannot play HEVC directly, so a lower-resolution H.264 conversion is generated for the interactive preview.

## 🤝 Contributing

This is an open-source project. Improvements, bug fixes, and new features are welcome.

## 📄 License

MIT — use, modify, and distribute freely.

## 🙏 Acknowledgments

- [three.js](https://threejs.org/) for 3D/360° rendering in the browser
- [ffmpeg](https://ffmpeg.org/) for powerful video processing
- The GoPro MAX community for documentation of the .360 format

---

**Questions or problems?** Open an issue in the project repository.

Enjoy converting your 360° videos! 🎬✨
