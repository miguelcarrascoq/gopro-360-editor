import * as THREE from 'three';

function previewMediaUrl(outputPath) {
    const name = String(outputPath).split(/[/\\]/).pop();
    return `/temp/${name}`;
}

function wrapDegrees(degrees) {
    return ((degrees + 180) % 360 + 360) % 360 - 180;
}

class GoPro360Editor {
    constructor() {
        this.currentFile = null;
        this.fileInfo = null;
        this.previewPath = null;
        this.video = null;
        this.videoTexture = null;
        this.draggingMarker = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.sphere = null;
        this.isPlaying = false;
        this.isDragging = false;
        this.previousMousePosition = { x: 0, y: 0 };
        this.startTime = 0;
        this.endTime = 0;
        this.resumeAfterScrub = false;
        this.yaw = 0;
        this.pitch = 0;
        this.roll = 0;
        this.ws = null;
        this.activeJob = null;

        this.init();
        this.setupWebSocket();
        this.setupEventListeners();
    }

    init() {
        const canvas = document.getElementById('viewer');
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
            75,
            canvas.clientWidth / canvas.clientHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 0, 0.1);
        this.camera.rotation.order = 'YXZ';
        this.applyView();

        // Handle window resize
        window.addEventListener('resize', () => {
            const container = document.getElementById('viewer-container');
            this.camera.aspect = container.clientWidth / container.clientHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(container.clientWidth, container.clientHeight);
        });
    }

    setupWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.ws = new WebSocket(`${protocol}//${window.location.host}`);

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleProgress(data);
        };

        this.ws.onclose = () => {
            setTimeout(() => this.setupWebSocket(), 3000);
        };
    }

    setupEventListeners() {
        document.getElementById('load-btn').addEventListener('click', () => this.loadFile());
        document.getElementById('browse-btn').addEventListener('click', () => this.openFileBrowser());
        document.getElementById('placeholder').addEventListener('click', () => {
            if (document.getElementById('placeholder').classList.contains('is-busy')) return;
            this.openFileBrowser();
        });
        document.getElementById('browser-close').addEventListener('click', () => this.closeFileBrowser());
        document.getElementById('browser-backdrop').addEventListener('click', () => this.closeFileBrowser());
        document.getElementById('browser-up').addEventListener('click', () => this.goUp());
        document.getElementById('system-dialog-btn').addEventListener('click', () => this.pickWithSystemDialog());
        document.getElementById('file-path').addEventListener('keydown', (event) => {
            if (event.key === 'Enter') this.loadFile();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') this.closeFileBrowser();
        });
        document.getElementById('export-btn').addEventListener('click', () => this.exportVideo());
        document.getElementById('play-pause').addEventListener('click', () => this.togglePlayback());
        this.setupViewControls();

        const canvas = document.getElementById('viewer');
        canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        canvas.addEventListener('mouseup', () => this.onMouseUp());
        canvas.addEventListener('mouseleave', () => this.onMouseUp());

        // Timeline markers
        document.getElementById('start-marker').addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.beginMarkerDrag('start');
        });

        document.getElementById('end-marker').addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.beginMarkerDrag('end');
        });

        document.getElementById('playhead').addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.beginMarkerDrag('play');
        });

        document.getElementById('timeline').addEventListener('mousedown', (e) => {
            if (e.target.closest('#start-marker, #end-marker, #playhead')) return;
            e.preventDefault();
            this.beginMarkerDrag('play');
            this.scrubPlayhead(e);
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.draggingMarker || !this.fileInfo) return;

            const time = this.timeFromTimelineEvent(e);
            if (time == null) return;

            if (this.draggingMarker === 'start') {
                this.startTime = Math.max(0, Math.min(time, this.endTime - 1));
                this.updateTimelineUI();
                this.seekPreview(this.startTime);
            } else if (this.draggingMarker === 'end') {
                this.endTime = Math.min(this.fileInfo.duration, Math.max(time, this.startTime + 1));
                this.updateTimelineUI();
                this.seekPreview(this.endTime);
            } else {
                this.seekPreview(time);
            }
        });

        document.addEventListener('mouseup', () => {
            const resume = this.draggingMarker === 'play' && this.resumeAfterScrub;
            this.draggingMarker = null;
            this.resumeAfterScrub = false;
            if (resume) this.togglePlayback();
        });
    }

    timeFromTimelineEvent(event) {
        const timeline = document.getElementById('timeline');
        const rect = timeline.getBoundingClientRect();
        if (rect.width <= 0 || !this.fileInfo) return null;

        const x = event.clientX - rect.left;
        const percent = Math.max(0, Math.min(1, x / rect.width));
        return percent * this.fileInfo.duration;
    }

    scrubPlayhead(event) {
        const time = this.timeFromTimelineEvent(event);
        if (time == null) return;
        this.seekPreview(time);
    }

    beginMarkerDrag(which) {
        this.resumeAfterScrub = which === 'play' && this.isPlaying;
        this.draggingMarker = which;
        this.pausePreview();
        if (which !== 'play') {
            this.seekPreview(which === 'start' ? this.startTime : this.endTime);
        }
    }

    pausePreview() {
        if (this.video) this.video.pause();
        this.isPlaying = false;
        const button = document.getElementById('play-pause');
        if (button) button.textContent = '▶';
    }

    seekPreview(time) {
        if (!this.video) return;

        let maxTime = this.fileInfo ? this.fileInfo.duration : time;
        if (Number.isFinite(this.video.duration) && this.video.duration > 0) {
            maxTime = Math.min(maxTime, Math.max(0, this.video.duration - 0.05));
        }

        const clamped = Math.max(0, Math.min(time, maxTime));
        if (this.video.readyState >= 1 && Math.abs(this.video.currentTime - clamped) > 0.01) {
            this.video.currentTime = clamped;
        }
        this.updateCurrentTime(clamped);
    }

    onMouseDown(event) {
        this.isDragging = true;
        this.previousMousePosition = {
            x: event.clientX,
            y: event.clientY
        };
    }

    onMouseMove(event) {
        if (!this.isDragging) return;

        const deltaX = event.clientX - this.previousMousePosition.x;
        const deltaY = event.clientY - this.previousMousePosition.y;

        this.setAxisDegrees('yaw', this.yaw * 180 / Math.PI + deltaX * 0.005 * 180 / Math.PI);
        this.setAxisDegrees('pitch', this.pitch * 180 / Math.PI + deltaY * 0.005 * 180 / Math.PI);

        this.previousMousePosition = {
            x: event.clientX,
            y: event.clientY
        };
    }

    onMouseUp() {
        this.isDragging = false;
    }

    setupViewControls() {
        document.querySelectorAll('.view-knob').forEach((knob) => {
            const axis = knob.dataset.axis;
            const dial = knob.querySelector('.knob');
            dial.addEventListener('pointerdown', (event) => this.onKnobDown(event, axis));
            dial.addEventListener('wheel', (event) => this.onKnobWheel(event, axis), { passive: false });
            dial.addEventListener('dblclick', () => this.resetAxis(axis));
        });
        document.getElementById('view-reset').addEventListener('click', () => this.resetView());
    }

    onKnobDown(event, axis) {
        event.preventDefault();
        const dial = event.currentTarget;
        dial.setPointerCapture(event.pointerId);
        const startY = event.clientY;
        const startDegrees = this[axis] * 180 / Math.PI;
        const range = axis === 'pitch' ? 90 : 180;

        const move = (moveEvent) => {
            const delta = startY - moveEvent.clientY;
            const fine = moveEvent.shiftKey ? 0.15 : 1;
            this.setAxisDegrees(axis, startDegrees + delta * (range / 240) * fine);
        };
        const end = () => {
            dial.removeEventListener('pointermove', move);
            dial.removeEventListener('pointerup', end);
            dial.removeEventListener('pointercancel', end);
        };
        dial.addEventListener('pointermove', move);
        dial.addEventListener('pointerup', end);
        dial.addEventListener('pointercancel', end);
    }

    onKnobWheel(event, axis) {
        event.preventDefault();
        const step = event.shiftKey ? 0.2 : 1;
        const current = this[axis] * 180 / Math.PI;
        this.setAxisDegrees(axis, current + (event.deltaY < 0 ? step : -step));
    }

    setAxisDegrees(axis, degrees) {
        if (axis === 'pitch') {
            degrees = Math.max(-90, Math.min(90, degrees));
        } else {
            degrees = wrapDegrees(degrees);
        }
        this[axis] = degrees * Math.PI / 180;
        this.applyView();
    }

    resetAxis(axis) {
        this[axis] = 0;
        this.applyView();
    }

    resetView() {
        this.yaw = 0;
        this.pitch = 0;
        this.roll = 0;
        this.applyView();
    }

    applyView() {
        this.camera.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
        this.syncViewControls();
    }

    syncViewControls() {
        this.syncKnob('yaw', this.yaw);
        this.syncKnob('pitch', this.pitch);
        this.syncKnob('roll', this.roll);
    }

    syncKnob(axis, radians) {
        const knob = document.querySelector(`.view-knob[data-axis="${axis}"]`);
        if (!knob) return;

        const degrees = Math.round(radians * 180 / Math.PI);
        knob.querySelector('.knob-face').style.setProperty('--angle', `${degrees}deg`);
        knob.querySelector('.knob-value').textContent = `${degrees}°`;
        knob.querySelector('.knob').setAttribute('aria-valuenow', String(degrees));
    }

    openFileBrowser() {
        document.getElementById('file-browser').hidden = false;
        const currentPath = document.getElementById('file-path').value.trim();
        let folder = currentPath.replace(/[\\/][^\\/]+$/, '');
        if (/^[A-Za-z]:$/.test(folder)) folder += '\\';
        this.loadDirectory(folder || null, { fallbackToDefault: Boolean(folder) });
    }

    closeFileBrowser() {
        document.getElementById('file-browser').hidden = true;
    }

    async readJson(response) {
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch {
            const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (/Cannot (GET|POST|PUT|DELETE)/.test(plain)) {
                throw new Error('Restart the server (stop it, then run npm start) and try again.');
            }
            throw new Error(plain || `Unexpected server response (${response.status})`);
        }
    }

    async loadDirectory(dirPath, { atComputer = false, fallbackToDefault = false } = {}) {
        const requestId = (this.browserRequest || 0) + 1;
        this.browserRequest = requestId;

        const list = document.getElementById('browser-list');
        list.replaceChildren();
        const status = document.createElement('div');
        status.className = 'browser-status';
        status.textContent = 'Opening folder...';
        list.append(status);

        const url = atComputer
            ? '/api/fs?view=computer'
            : `/api/fs${dirPath ? `?path=${encodeURIComponent(dirPath)}` : ''}`;

        try {
            const response = await fetch(url);
            const data = await this.readJson(response);
            if (requestId !== this.browserRequest) return;
            if (!response.ok) throw new Error(data.error || 'Could not open folder');
            this.renderBrowser(data);
        } catch (err) {
            if (requestId !== this.browserRequest) return;
            if (fallbackToDefault && dirPath) {
                await this.loadDirectory(null);
                return;
            }
            list.replaceChildren();
            const error = document.createElement('div');
            error.className = 'browser-status error';
            error.textContent = err.message;
            list.append(error);
        }
    }

    renderBrowser(data) {
        this.browserUpTarget = data.canGoUp ? data.upTarget : null;
        document.getElementById('browser-up').disabled = !data.canGoUp;

        const current = document.getElementById('browser-current');
        current.textContent = data.atComputer ? 'This PC' : data.path;
        current.title = current.textContent;

        const places = document.getElementById('browser-places');
        places.replaceChildren();
        for (const place of data.places || []) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'place-btn';
            button.textContent = place.name;
            if (!data.atComputer && place.path === data.path) button.classList.add('active');
            button.addEventListener('click', () => this.loadDirectory(place.path));
            places.append(button);
        }

        const list = document.getElementById('browser-list');
        list.replaceChildren();
        if (!data.entries?.length) {
            const empty = document.createElement('div');
            empty.className = 'browser-empty';
            empty.textContent = 'This folder has no subfolders or .360 files.';
            list.append(empty);
            return;
        }

        for (const entry of data.entries) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `browser-item${entry.kind === 'file' ? ' file' : ''}`;

            const kind = document.createElement('span');
            kind.className = 'browser-kind';
            kind.textContent = entry.kind === 'file' ? '.360' : 'Folder';

            const name = document.createElement('span');
            name.textContent = entry.name;

            button.append(kind, name);
            button.addEventListener('click', () => {
                if (entry.kind === 'dir') this.loadDirectory(entry.path);
                else this.chooseFile(entry.path);
            });
            list.append(button);
        }
    }

    goUp() {
        if (!this.browserUpTarget) return;
        if (this.browserUpTarget === 'computer') this.loadDirectory(null, { atComputer: true });
        else this.loadDirectory(this.browserUpTarget);
    }

    async chooseFile(filePath) {
        document.getElementById('file-path').value = filePath;
        this.closeFileBrowser();
        await this.loadFile();
    }

    async pickWithSystemDialog() {
        const button = document.getElementById('system-dialog-btn');
        button.disabled = true;
        button.textContent = 'Waiting for the file dialog...';

        try {
            const response = await fetch('/api/pick-file', { method: 'POST' });
            const data = await this.readJson(response);
            if (!response.ok) throw new Error(data.error || 'Could not open the file dialog');
            if (!data.cancelled && data.path) await this.chooseFile(data.path);
        } catch (err) {
            alert(`Error: ${err.message}`);
        } finally {
            button.disabled = false;
            button.textContent = 'Use system file dialog';
        }
    }

    async loadFile() {
        const filePath = document.getElementById('file-path').value.trim();
        
        if (!filePath) {
            alert('Please enter the file path');
            return;
        }

        try {
            const response = await fetch(`/api/info?file=${encodeURIComponent(filePath)}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to load file');
            }

            this.currentFile = filePath;
            this.fileInfo = data;
            this.startTime = 0;
            this.endTime = data.duration;

            this.displayFileInfo(data);
            document.getElementById('file-info').style.display = 'block';
            await this.generatePreview();

        } catch (err) {
            alert(`Error: ${err.message}`);
        }
    }

    displayFileInfo(info) {
        const html = `
            <div class="file-info-item">
                <span class="file-info-label">Duration:</span>
                <span>${this.formatTime(info.duration)}</span>
            </div>
            <div class="file-info-item">
                <span class="file-info-label">Video streams:</span>
                <span>${info.videoStreams.length}</span>
            </div>
            <div class="file-info-item">
                <span class="file-info-label">Resolution:</span>
                <span>${info.videoStreams[0].width}x${info.videoStreams[0].height}</span>
            </div>
            <div class="file-info-item">
                <span class="file-info-label">Audio:</span>
                <span>${info.audioStreams.length > 0 ? 'Yes' : 'No'}</span>
            </div>
        `;
        document.getElementById('file-info').innerHTML = html;
    }

    showPlaceholderProgress(progress, message) {
        const placeholder = document.getElementById('placeholder');
        placeholder.style.display = '';
        placeholder.classList.add('is-busy');

        const shown = progress < 10 ? (Math.round(progress * 10) / 10) : Math.round(progress);
        const text = placeholder.querySelector('.progress-text');
        const fill = placeholder.querySelector('.progress-fill');
        if (text) text.textContent = `${message} (${shown}%)`;
        if (fill) fill.style.width = `${Math.max(0, Math.min(100, progress))}%`;

        document.getElementById('timeline-container').style.display = 'none';
        document.getElementById('view-controls').hidden = true;
        document.getElementById('export-btn').disabled = true;

        if (this.video) {
            this.video.pause();
            this.isPlaying = false;
        }
    }

    resetPlaceholder() {
        const placeholder = document.getElementById('placeholder');
        placeholder.classList.remove('is-busy');
        placeholder.style.display = '';
        const text = placeholder.querySelector('.progress-text');
        const fill = placeholder.querySelector('.progress-fill');
        if (text) text.textContent = 'Generating preview...';
        if (fill) fill.style.width = '0%';
    }

    async generatePreview() {
        this.activeJob = 'preview';
        this.currentJobId = null;
        this.showPlaceholderProgress(0, 'Generating preview...');

        try {
            const response = await fetch('/api/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: this.currentFile })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to generate preview');
            }

            this.currentJobId = data.jobId;

        } catch (err) {
            alert(`Error: ${err.message}`);
            this.activeJob = null;
            this.currentJobId = null;
            this.resetPlaceholder();
        }
    }

    async exportVideo() {
        const quality = document.getElementById('quality').value;
        const outputName = document.getElementById('output-name').value.trim() || 'export';

        const progressDiv = document.getElementById('export-progress');
        progressDiv.style.display = 'block';
        progressDiv.innerHTML = '<div class="progress-text">Exporting...</div><div class="progress-bar"><div class="progress-fill" style="width: 0%"></div></div>';

        document.getElementById('export-btn').disabled = true;
        this.activeJob = 'export';
        this.currentJobId = null;

        try {
            const response = await fetch('/api/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filePath: this.currentFile,
                    startTime: this.startTime,
                    endTime: this.endTime,
                    quality,
                    outputName
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to export');
            }

            this.currentJobId = data.jobId;

        } catch (err) {
            alert(`Error: ${err.message}`);
            progressDiv.style.display = 'none';
            document.getElementById('export-btn').disabled = false;
            this.activeJob = null;
            this.currentJobId = null;
        }
    }

    handleProgress(data) {
        const { jobId, progress, status, message } = data;
        if (!this.currentJobId || jobId !== this.currentJobId) return;

        if (this.activeJob === 'preview') {
            if (status === 'processing') {
                this.showPlaceholderProgress(progress, message);
            } else if (status === 'complete') {
                this.activeJob = null;
                this.loadPreview(jobId);
            } else if (status === 'error') {
                this.activeJob = null;
                this.currentJobId = null;
                this.resetPlaceholder();
                alert(`Error: ${message}`);
            }
            return;
        }

        if (this.activeJob !== 'export') return;

        const progressDiv = document.getElementById('export-progress');

        if (status === 'processing') {
            const fill = progressDiv.querySelector('.progress-fill');
            const text = progressDiv.querySelector('.progress-text');
            const shown = progress < 10 ? (Math.round(progress * 10) / 10) : Math.round(progress);
            if (fill) fill.style.width = `${progress}%`;
            if (text) text.textContent = `${message} (${shown}%)`;
        } else if (status === 'complete') {
            this.activeJob = null;
            progressDiv.innerHTML = '<div class="progress-text" style="color: #4ade80;">✓ Export complete. Check the temp/ folder</div>';
            setTimeout(() => {
                progressDiv.style.display = 'none';
                document.getElementById('export-btn').disabled = false;
            }, 3000);
        } else if (status === 'error') {
            this.activeJob = null;
            progressDiv.innerHTML = `<div class="progress-text" style="color: #ef4444;">Error: ${message}</div>`;
            setTimeout(() => {
                progressDiv.style.display = 'none';
                document.getElementById('export-btn').disabled = false;
            }, 5000);
        }
    }

    async loadPreview(jobId) {
        try {
            const response = await fetch(`/api/job/${jobId}`);
            const job = await response.json();

            if (job.status !== 'complete') {
                throw new Error('Preview not ready');
            }

            const videoPath = previewMediaUrl(job.outputPath);
            this.setupVideoPlayer(videoPath);

            document.getElementById('export-btn').disabled = false;
            document.getElementById('timeline-container').style.display = 'block';
            document.getElementById('view-controls').hidden = false;
            const placeholder = document.getElementById('placeholder');
            placeholder.classList.remove('is-busy');
            placeholder.style.display = 'none';

            this.updateTimelineUI();

        } catch (err) {
            if (document.getElementById('placeholder').classList.contains('is-busy')) {
                this.resetPlaceholder();
            }
            alert(`Error loading preview: ${err.message}`);
        }
    }

    setupVideoPlayer(videoPath) {
        this.video = document.createElement('video');
        this.video.src = videoPath;
        this.video.crossOrigin = 'anonymous';
        this.video.loop = true;
        this.video.muted = true;

        this.videoTexture = new THREE.VideoTexture(this.video);
        this.videoTexture.minFilter = THREE.LinearFilter;
        this.videoTexture.magFilter = THREE.LinearFilter;

        const geometry = new THREE.SphereGeometry(500, 60, 40);
        geometry.scale(-1, 1, 1);

        const material = new THREE.MeshBasicMaterial({ map: this.videoTexture });

        if (this.sphere) {
            this.scene.remove(this.sphere);
        }

        this.sphere = new THREE.Mesh(geometry, material);
        this.scene.add(this.sphere);

        this.video.addEventListener('loadedmetadata', () => {
            this.animate();
        });

        this.video.addEventListener('timeupdate', () => {
            this.updateCurrentTime();
        });

        this.video.addEventListener('seeked', () => {
            if (this.videoTexture) this.videoTexture.needsUpdate = true;
            this.updateCurrentTime();
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.video && !this.video.paused && !this.draggingMarker) {
            const duration = this.fileInfo ? this.fileInfo.duration : this.video.duration;
            this.updatePlayhead(this.video.currentTime, duration);
        }
        this.renderer.render(this.scene, this.camera);
    }

    togglePlayback() {
        if (!this.video) return;

        if (this.isPlaying) {
            this.video.pause();
            document.getElementById('play-pause').textContent = '▶';
        } else {
            this.video.play();
            document.getElementById('play-pause').textContent = '⏸';
        }

        this.isPlaying = !this.isPlaying;
    }

    updateCurrentTime(displayTime) {
        if (!this.video && displayTime == null) return;

        const current = displayTime != null ? displayTime : this.video.currentTime;
        const duration = this.fileInfo ? this.fileInfo.duration : this.video.duration;

        document.getElementById('current-time').textContent = 
            `${this.formatTime(current)} / ${this.formatTime(duration)}`;
        this.updatePlayhead(current, duration);
    }

    updatePlayhead(current, duration) {
        const playhead = document.getElementById('playhead');
        if (!playhead || !Number.isFinite(duration) || duration <= 0) return;

        const percent = Math.max(0, Math.min(100, (current / duration) * 100));
        playhead.style.left = `${percent}%`;
    }

    updateTimelineUI() {
        if (!this.fileInfo) return;

        const startPercent = (this.startTime / this.fileInfo.duration) * 100;
        const endPercent = (this.endTime / this.fileInfo.duration) * 100;

        document.getElementById('start-marker').style.left = `${startPercent}%`;
        document.getElementById('end-marker').style.left = `${endPercent}%`;

        const selection = document.querySelector('.timeline-selection');
        selection.style.left = `${startPercent}%`;
        selection.style.width = `${endPercent - startPercent}%`;

        document.getElementById('trim-start').textContent = this.formatTime(this.startTime);
        document.getElementById('trim-end').textContent = this.formatTime(this.endTime);
        document.getElementById('trim-duration').textContent = this.formatTime(this.endTime - this.startTime);
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

new GoPro360Editor();
