# Quick Start — GoPro 360 Editor

## ⚡ Get started in 3 steps

### 1. Install dependencies

```bash
npm install
```

### 2. Start the app

```bash
npm start
```

### 3. Open it in the browser

Go to [http://localhost:3000](http://localhost:3000)

## 🎬 Typical workflow

1. **Paste the path** to your `.360` file in the text field
   - Example: `/Users/your-name/GoPro/GS010001.360`
   
2. **Load the file** — click "Load file"

3. **Generate a preview** — click "Generate preview"
   - Wait 2–5 minutes depending on the file size
   - The preview lets you explore the 360° video by dragging with the mouse

4. **Trim (optional)** — drag the green and red markers

5. **Export** — choose a quality and click "Export MP4"
   - The file is saved in the `temp/` folder

## 💡 Tips

- **First time**: Use "low" quality to try it quickly
- **For YouTube**: Use "high" or "medium" quality
- **Large files**: Conversion can take 10–20 minutes
- **Preview**: You can play and look around the video while you decide where to trim

## 🛠️ Command-line conversion

If you prefer the terminal:

```bash
# Show information
npm run cli info /path/to/file.360

# Convert the full file
npm run cli convert /path/to/file.360 output.mp4

# Trim and convert
npm run cli convert /path/to/file.360 output.mp4 --start 30 --end 120 --quality high
```

## ❓ Common problems

**"File not found"**
- Check the full file path
- On macOS, drag the file into the terminal to get the path

**"Not a dual-stream .360 file"**
- The file must come from a GoPro MAX or MAX 2
- Files from other cameras are not supported

**The preview does not load**
- Wait until conversion finishes (you will see progress on screen)
- Make sure port 3000 is free

## 📱 Next step: upload to YouTube

1. After export, go to [YouTube Studio](https://studio.youtube.com)
2. Click "Upload videos"
3. Select your exported MP4 file
4. YouTube will automatically detect that it is a 360° video
5. Done. The video will be playable as 360° on YouTube

---

For full documentation, see [README.md](README.md)
