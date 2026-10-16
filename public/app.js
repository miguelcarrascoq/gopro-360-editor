import * as THREE from 'three';

class GoPro360Editor {
    constructor() {
        this.currentFile = null;
        this.fileInfo = null;
        this.previewPath = null;
        this.video = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.sphere = null;
        this.isPlaying = false;
        this.isDragging = false;
        this.previousMousePosition = { x: 0, y: 0 };
        this.startTime = 0;
        this.endTime = 0;
        this.ws = null;

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
        document.getElementById('preview-btn').addEventListener('click', () => this.generatePreview());
        document.getElementById('export-btn').addEventListener('click', () => this.exportVideo());
        document.getElementById('play-pause').addEventListener('click', () => this.togglePlayback());

        const canvas = document.getElementById('viewer');
        canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        canvas.addEventListener('mouseup', () => this.onMouseUp());
        canvas.addEventListener('mouseleave', () => this.onMouseUp());

        // Timeline markers
        document.getElementById('start-marker').addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.draggingMarker = 'start';
        });

        document.getElementById('end-marker').addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.draggingMarker = 'end';
        });

        document.getElementById('timeline').addEventListener('mousemove', (e) => {
            if (this.draggingMarker && this.fileInfo) {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const percent = Math.max(0, Math.min(1, x / rect.width));
                const time = percent * this.fileInfo.duration;

                if (this.draggingMarker === 'start') {
                    this.startTime = Math.min(time, this.endTime - 1);
                } else {
                    this.endTime = Math.max(time, this.startTime + 1);
                }

                this.updateTimelineUI();
            }
        });

        document.addEventListener('mouseup', () => {
            this.draggingMarker = null;
        });
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

        this.camera.rotation.y += deltaX * 0.005;
        this.camera.rotation.x += deltaY * 0.005;

        this.camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.camera.rotation.x));

        this.previousMousePosition = {
            x: event.clientX,
            y: event.clientY
        };
    }

    onMouseUp() {
        this.isDragging = false;
    }

    async loadFile() {
        const filePath = document.getElementById('file-path').value.trim();
        
        if (!filePath) {
            alert('Por favor ingresa la ruta del archivo');
            return;
        }

        try {
            const response = await fetch(`/api/info?file=${encodeURIComponent(filePath)}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Error al cargar el archivo');
            }

            this.currentFile = filePath;
            this.fileInfo = data;
            this.startTime = 0;
            this.endTime = data.duration;

            this.displayFileInfo(data);
            document.getElementById('preview-btn').disabled = false;
            document.getElementById('file-info').style.display = 'block';

        } catch (err) {
            alert(`Error: ${err.message}`);
        }
    }

    displayFileInfo(info) {
        const html = `
            <div class="file-info-item">
                <span class="file-info-label">Duración:</span>
                <span>${this.formatTime(info.duration)}</span>
            </div>
            <div class="file-info-item">
                <span class="file-info-label">Streams de video:</span>
                <span>${info.videoStreams.length}</span>
            </div>
            <div class="file-info-item">
                <span class="file-info-label">Resolución:</span>
                <span>${info.videoStreams[0].width}x${info.videoStreams[0].height}</span>
            </div>
            <div class="file-info-item">
                <span class="file-info-label">Audio:</span>
                <span>${info.audioStreams.length > 0 ? 'Sí' : 'No'}</span>
            </div>
        `;
        document.getElementById('file-info').innerHTML = html;
    }

    async generatePreview() {
        const progressDiv = document.getElementById('preview-progress');
        progressDiv.style.display = 'block';
        progressDiv.innerHTML = '<div class="progress-text">Generando vista previa...</div><div class="progress-bar"><div class="progress-fill" style="width: 0%"></div></div>';

        document.getElementById('preview-btn').disabled = true;

        try {
            const response = await fetch('/api/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: this.currentFile })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Error al generar vista previa');
            }

            this.currentJobId = data.jobId;

        } catch (err) {
            alert(`Error: ${err.message}`);
            progressDiv.style.display = 'none';
            document.getElementById('preview-btn').disabled = false;
        }
    }

    async exportVideo() {
        const quality = document.getElementById('quality').value;
        const outputName = document.getElementById('output-name').value.trim() || 'export';

        const progressDiv = document.getElementById('export-progress');
        progressDiv.style.display = 'block';
        progressDiv.innerHTML = '<div class="progress-text">Exportando...</div><div class="progress-bar"><div class="progress-fill" style="width: 0%"></div></div>';

        document.getElementById('export-btn').disabled = true;

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
                throw new Error(data.error || 'Error al exportar');
            }

            this.currentJobId = data.jobId;

        } catch (err) {
            alert(`Error: ${err.message}`);
            progressDiv.style.display = 'none';
            document.getElementById('export-btn').disabled = false;
        }
    }

    handleProgress(data) {
        const { jobId, progress, status, message } = data;

        let progressDiv;
        
        // Determine which progress div to update
        if (document.getElementById('preview-progress').querySelector('.progress-text')?.textContent.includes('Generando')) {
            progressDiv = document.getElementById('preview-progress');
        } else {
            progressDiv = document.getElementById('export-progress');
        }

        if (status === 'processing') {
            const fill = progressDiv.querySelector('.progress-fill');
            const text = progressDiv.querySelector('.progress-text');
            if (fill) fill.style.width = `${progress}%`;
            if (text) text.textContent = `${message} (${Math.round(progress)}%)`;
        } else if (status === 'complete') {
            if (progressDiv === document.getElementById('preview-progress')) {
                this.loadPreview(jobId);
            } else {
                progressDiv.innerHTML = '<div class="progress-text" style="color: #4ade80;">✓ Exportación completa. Verifica la carpeta temp/</div>';
                setTimeout(() => {
                    progressDiv.style.display = 'none';
                    document.getElementById('export-btn').disabled = false;
                }, 3000);
            }
        } else if (status === 'error') {
            progressDiv.innerHTML = `<div class="progress-text" style="color: #ef4444;">Error: ${message}</div>`;
            setTimeout(() => {
                progressDiv.style.display = 'none';
                if (progressDiv === document.getElementById('preview-progress')) {
                    document.getElementById('preview-btn').disabled = false;
                } else {
                    document.getElementById('export-btn').disabled = false;
                }
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

            const videoPath = job.outputPath.replace(/.*\/temp\//, '/temp/');
            this.setupVideoPlayer(videoPath);

            document.getElementById('preview-progress').style.display = 'none';
            document.getElementById('export-btn').disabled = false;
            document.getElementById('timeline-container').style.display = 'block';
            document.getElementById('placeholder').style.display = 'none';

            this.updateTimelineUI();

        } catch (err) {
            alert(`Error loading preview: ${err.message}`);
        }
    }

    setupVideoPlayer(videoPath) {
        this.video = document.createElement('video');
        this.video.src = videoPath;
        this.video.crossOrigin = 'anonymous';
        this.video.loop = true;
        this.video.muted = true;

        const texture = new THREE.VideoTexture(this.video);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;

        const geometry = new THREE.SphereGeometry(500, 60, 40);
        geometry.scale(-1, 1, 1);

        const material = new THREE.MeshBasicMaterial({ map: texture });

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
    }

    animate() {
        requestAnimationFrame(() => this.animate());
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

    updateCurrentTime() {
        if (!this.video) return;

        const current = this.video.currentTime;
        const duration = this.fileInfo ? this.fileInfo.duration : this.video.duration;

        document.getElementById('current-time').textContent = 
            `${this.formatTime(current)} / ${this.formatTime(duration)}`;
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

// Initialize the app
new GoPro360Editor();
