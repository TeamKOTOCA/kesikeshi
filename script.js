        const worker = new Worker('worker.js', { type: 'module' });
        const fileInput = document.getElementById('fileInput');
        const dropZone = document.getElementById('dropZone');
        const resultsContainer = document.getElementById('resultsContainer');
        const modellist_ui = document.getElementById('model_list');
        const status = document.getElementById('status');
        const progressBarFill = document.getElementById('progressBarFill');
        const progressPercent = document.getElementById('progressPercent');

        const modellist = {
            "RMBG-1.4": {
                path: "RMBG-1.4",
                description: "汎用 - 中速",
                device: "wasm",
                dtype: "fp32"
            },
            "modnet": {
                path: "MODnet",
                description: "人用 - 高速",
                device: "wasm",
                dtype: "q8"
            },
            "isnet": {
                path: "isnet",
                description: "汎用 - RMBGの代用",
                device: "wasm",
                dtype: "fp32"
            },
            "BEN2": {
                path: "BEN2",
                description: "高性能",
                device: "wasm",
                dtype: "fp16"
            }
        };

        const queue = [];
        let now_model = null;
        let processing = false;
        let requestCounter = 0;
        const pendingRequests = new Map();

        const formatModelLabel = (model) => {
            const deviceLabel = model.device === 'webgpu' ? 'WEBGPU' : 'WASM';
            const dtypeLabel = model.dtype ? model.dtype.toUpperCase() : 'AUTO';
            return `${deviceLabel} ${dtypeLabel}`;
        };

        const updateStatus = (text, percent = null) => {
            status.textContent = text;
            if (typeof percent === 'number') {
                const clamped = Math.min(100, Math.max(0, Math.round(percent)));
                progressBarFill.style.width = `${clamped}%`;
                progressPercent.textContent = `${clamped}%`;
            } else {
                progressPercent.textContent = '---';
            }
        };

        document.addEventListener('DOMContentLoaded', () => {
            modellist_ui.innerHTML = '';
            Object.entries(modellist).forEach(([key, model]) => {
                const opt = document.createElement('option');
                opt.value = model.path;
                opt.textContent = `${model.description} (${key}) — ${model.path}`;
                modellist_ui.appendChild(opt);
            });

            if (modellist_ui.options.length > 0) {
                modellist_ui.selectedIndex = 0;
            }

            attachDropZone();
            updateNowModel();
            updateStatus('Images ready', 0);
        });

        function updateNowModel() {
            const selectedPath = modellist_ui.value;
            now_model = Object.values(modellist).find(m => m.path === selectedPath) ?? null;
            if (!now_model) {
                updateStatus('Select a model', 0);
            } else {
                updateStatus(`Model selected: ${now_model.description}`, 0);
            }
        }

        modellist_ui.addEventListener('change', () => {
            updateNowModel();
        });

        fileInput.addEventListener('change', (event) => {
            handleFiles(event.target.files);
            fileInput.value = '';
        });

        const attachDropZone = () => {
            const prevent = (event) => {
                event.preventDefault();
                event.stopPropagation();
            };
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((name) => {
                dropZone.addEventListener(name, prevent);
            });
            dropZone.addEventListener('dragenter', () => dropZone.classList.add('is-active'));
            dropZone.addEventListener('dragover', () => dropZone.classList.add('is-active'));
            dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-active'));
            dropZone.addEventListener('drop', (event) => {
                dropZone.classList.remove('is-active');
                handleFiles(event.dataTransfer?.files);
            });
            dropZone.addEventListener('click', () => fileInput.click());
            dropZone.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    fileInput.click();
                }
            });
        };

        const handleFiles = (fileList) => {
            const files = Array.from(fileList ?? []).filter(file => file.type.startsWith('image/'));
            if (!files.length) {
                updateStatus('Please choose image files', 0);
                return;
            }
            files.forEach(file => queue.push(file));
            processQueue();
        };

        const processQueue = async () => {
            if (processing) return;
            if (!now_model) return;
            processing = true;
            while (queue.length) {
                const file = queue.shift();
                const card = createResultCard(file.name);
                updateStatus(`Processing: ${file.name}`, 5);
                try {
                    await processFile(file, card);
                    card.statusEl.textContent = 'Complete';
                    card.progressEl.textContent = '100%';
                } catch (error) {
                    card.statusEl.textContent = 'Error';
                    card.progressEl.textContent = '0%';
                    card.card.classList.add('is-error');
                    updateStatus(error?.message ?? 'Error while processing files', 0);
                }
            }
            processing = false;
            updateStatus('Ready for new images', 0);
        };

        const createResultCard = (fileName) => {
            const card = document.createElement('article');
            card.className = 'result-card';
            card.innerHTML = `
                <header>
                    <div>
                        <strong>${fileName}</strong>
                        <p class="result-status">待機中...</p>
                    </div>
                    <span class="result-progress">0%</span>
                </header>
                <div class="canvas-wrap">
                    <canvas></canvas>
                </div>
                <div class="result-actions">
                    <button type="button" disabled>ダウンロード</button>
                    <button type="button" class="edit-result" disabled>編集</button>
                </div>
            `;
            resultsContainer.prepend(card);
            const canvas = card.querySelector('canvas');
            const result = {
                card,
                canvas,
                ctx: canvas.getContext('2d'),
                fileName,
                statusEl: card.querySelector('.result-status'),
                progressEl: card.querySelector('.result-progress'),
                downloadButton: card.querySelector('button'),
                editButton: card.querySelector('.edit-result')
            };
            result.editButton.addEventListener('click', () => openEditor(result));
            return result;
        };

        const processFile = async (file, cardRefs) => {
            const requestId = ++requestCounter;
            const bitmap = await createImageBitmap(file);
            const { width, height } = bitmap;
            const offscreen = new OffscreenCanvas(width, height);
            const offCtx = offscreen.getContext('2d');
            offCtx.drawImage(bitmap, 0, 0);
            const imageData = offCtx.getImageData(0, 0, width, height);
            const buffer = imageData.data.buffer;
            const basePixels = new Uint8ClampedArray(imageData.data);
            cardRefs.basePixels = basePixels;
            cardRefs.baseImageData = new ImageData(new Uint8ClampedArray(basePixels), width, height);
            cardRefs.baseBitmap = bitmap;

            const requestPromise = new Promise((resolve, reject) => {
                pendingRequests.set(requestId, { ...cardRefs, resolve, reject });
            });

            worker.postMessage({
                requestId,
                buffer,
                width,
                height,
                modelPath: now_model.path,
                device: now_model.device,
                dtype: now_model.dtype,
                masks: Array.isArray(now_model.masks) ? now_model.masks : undefined
            }, [buffer]);

            const result = await requestPromise;
            const { outputBuffer, width: resultWidth, height: resultHeight } = result;
            cardRefs.canvas.width = resultWidth;
            cardRefs.canvas.height = resultHeight;
            const outputImageData = new ImageData(
                new Uint8ClampedArray(outputBuffer),
                resultWidth,
                resultHeight
            );
            cardRefs.ctx.putImageData(outputImageData, 0, 0);
            cardRefs.downloadButton.disabled = false;
            cardRefs.downloadButton.addEventListener('click', () => {
                const dataUrl = cardRefs.canvas.toDataURL('image/png');
                const link = document.createElement('a');
                link.href = dataUrl;
                link.download = `kesikeshi_${createTimestamp(file.name)}.png`;
                link.click();
            });

            const pixelCount = resultWidth * resultHeight;
            const maskData = new Uint8ClampedArray(pixelCount);
            const outputPixels = new Uint8ClampedArray(outputBuffer);
            for (let i = 0; i < pixelCount; i++) {
                maskData[i] = outputPixels[i * 4 + 3];
            }
            cardRefs.maskData = maskData;
            cardRefs.width = resultWidth;
            cardRefs.height = resultHeight;
            cardRefs.editButton.disabled = false;
        };

        worker.onmessage = (event) => {
            const data = event.data;
            if (!data?.requestId) return;
            const entry = pendingRequests.get(data.requestId);
            if (data.type === 'progress') {
                if (entry) {
                    const suffix = typeof data.progress === 'number' ? ` (${data.progress}%)` : '';
                    entry.statusEl.textContent = `${data.detail}${suffix}`;
                    if (typeof data.progress === 'number') {
                        entry.progressEl.textContent = `${Math.min(100, Math.max(0, Math.round(data.progress)))}%`;
                    }
                }
                updateStatus(data.detail, data.progress ?? null);
                return;
            }
            pendingRequests.delete(data.requestId);
            if (!entry) return;
            if (data.type === 'error' || data.error) {
                entry.statusEl.textContent = 'Error';
                entry.progressEl.textContent = '0%';
                entry.card.classList.add('is-error');
                entry.reject(new Error(data.error || 'Unknown error'));
                return;
            }
            entry.resolve({
                outputBuffer: data.outputBuffer,
                width: data.width,
                height: data.height
            });
        };

        const createTimestamp = (fileName) => {
            const now = new Date();
            const pad = (value) => String(value).padStart(2, '0');
            const sanitized = fileName.replace(/[^a-zA-Z0-9_-]/g, '_');
            return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}_${sanitized}`;
        };

        const editorOverlay = createEditorOverlay();
        const editorBaseCanvas = editorOverlay.querySelector('.editor-base-canvas');
        const editorMaskCanvas = editorOverlay.querySelector('.editor-mask-canvas');
        const editorCanvas = editorMaskCanvas;
        const editorTitle = editorOverlay.querySelector('.editor-title');
        const brushSizeInput = editorOverlay.querySelector('.brush-size');
        const brushSizeLabel = editorOverlay.querySelector('.brush-size-value');
        const modeButtons = Array.from(editorOverlay.querySelectorAll('[data-mode]'));
        const closeEditorButton = editorOverlay.querySelector('.editor-close');
        const cancelEditButton = editorOverlay.querySelector('.cancel-edit');
        const applyEditButton = editorOverlay.querySelector('.apply-edit');
        let editorCtx = editorMaskCanvas.getContext('2d');
        let editorBaseCtx = editorBaseCanvas.getContext('2d');
        const editorState = {
            activeCard: null,
            maskData: null,
            width: 0,
            height: 0,
            brushMode: 'add',
            brushSize: Number(brushSizeInput.value),
            isDrawing: false
        };

        const updateBrushLabel = (value) => {
            brushSizeLabel.textContent = `${value}px`;
        };

        const renderEditorPreview = () => {
            if (!editorState.activeCard || !editorState.maskData) {
                editorBaseCtx.clearRect(0, 0, editorBaseCanvas.width, editorBaseCanvas.height);
                editorCtx.clearRect(0, 0, editorMaskCanvas.width, editorMaskCanvas.height);
                return;
            }
            editorBaseCtx.clearRect(0, 0, editorBaseCanvas.width, editorBaseCanvas.height);
            editorBaseCtx.globalAlpha = 0.35;
            if (editorState.activeCard.baseBitmap) {
                editorBaseCtx.drawImage(editorState.activeCard.baseBitmap, 0, 0, editorState.width, editorState.height);
            } else {
                editorBaseCtx.putImageData(editorState.activeCard.baseImageData, 0, 0);
            }
            editorBaseCtx.globalAlpha = 1;
            editorCtx.clearRect(0, 0, editorMaskCanvas.width, editorMaskCanvas.height);
            const overlayData = editorCtx.createImageData(editorState.width, editorState.height);
            for (let i = 0, len = editorState.maskData.length; i < len; i++) {
                const alpha = editorState.maskData[i];
                if (!alpha) {
                    continue;
                }
                const offset = i * 4;
                overlayData.data[offset] = 59;
                overlayData.data[offset + 1] = 130;
                overlayData.data[offset + 2] = 246;
                overlayData.data[offset + 3] = Math.round((alpha / 255) * 120);
            }
            editorCtx.putImageData(overlayData, 0, 0);
        };

        const paintMask = (x, y) => {
            if (!editorState.maskData) return;
            const targetValue = editorState.brushMode === 'add' ? 255 : 0;
            const { width, height, brushSize } = editorState;
            const radius = brushSize;
            const minX = Math.max(0, Math.floor(x - radius));
            const maxX = Math.min(width - 1, Math.ceil(x + radius));
            const minY = Math.max(0, Math.floor(y - radius));
            const maxY = Math.min(height - 1, Math.ceil(y + radius));
            const radiusSq = radius * radius;
            for (let py = minY; py <= maxY; py++) {
                const rowOffset = py * width;
                for (let px = minX; px <= maxX; px++) {
                    const dx = px - x;
                    const dy = py - y;
                    if (dx * dx + dy * dy > radiusSq) continue;
                    editorState.maskData[rowOffset + px] = targetValue;
                }
            }
            renderEditorPreview();
        };

        const paintFromEvent = (event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            const rect = editorCanvas.getBoundingClientRect();
            const scaleX = editorCanvas.width / rect.width;
            const scaleY = editorCanvas.height / rect.height;
            const x = (event.clientX - rect.left) * scaleX;
            const y = (event.clientY - rect.top) * scaleY;
            paintMask(x, y);
        };

        const handlePointerDown = (event) => {
            event.preventDefault();
            editorState.isDrawing = true;
            editorCanvas.setPointerCapture(event.pointerId);
            paintFromEvent(event);
        };

        const handlePointerMove = (event) => {
            if (!editorState.isDrawing) return;
            paintFromEvent(event);
        };

        const handlePointerUp = (event) => {
            editorState.isDrawing = false;
            try {
                editorCanvas.releasePointerCapture(event.pointerId);
            } catch (err) {
                // ignore if pointer not captured
            }
        };

        const applyMaskToCard = (card, maskData) => {
            if (!card || !card.basePixels || !card.width || !card.height) return;
            const pixelCount = maskData.length;
            const updatedPixels = new Uint8ClampedArray(card.basePixels);
            for (let i = 0; i < pixelCount; i++) {
                updatedPixels[i * 4 + 3] = maskData[i];
            }
            card.ctx.putImageData(new ImageData(updatedPixels, card.width, card.height), 0, 0);
        };

        function openEditor(card) {
            if (!card || !card.maskData || !card.baseImageData) {
                return;
            }
            editorState.activeCard = card;
            editorState.width = card.width;
            editorState.height = card.height;
            editorState.maskData = new Uint8ClampedArray(card.maskData);
            editorBaseCanvas.width = editorState.width;
            editorBaseCanvas.height = editorState.height;
            editorMaskCanvas.width = editorState.width;
            editorMaskCanvas.height = editorState.height;
            editorBaseCtx = editorBaseCanvas.getContext('2d');
            editorCtx = editorMaskCanvas.getContext('2d');
            brushSizeInput.value = editorState.brushSize;
            updateBrushLabel(editorState.brushSize);
            editorTitle.textContent = card.fileName ? `${card.fileName} のマスク` : 'マスク編集';
            editorOverlay.classList.add('is-open');
            document.body.style.overflow = 'hidden';
            renderEditorPreview();
        }

        const closeEditor = () => {
            editorOverlay.classList.remove('is-open');
            document.body.style.overflow = '';
            editorState.isDrawing = false;
            editorState.activeCard = null;
            editorState.maskData = null;
        };

        const applyEditorChanges = () => {
            if (!editorState.activeCard || !editorState.maskData) return;
            const maskCopy = new Uint8ClampedArray(editorState.maskData);
            editorState.activeCard.maskData = maskCopy;
            applyMaskToCard(editorState.activeCard, maskCopy);
            closeEditor();
        };

        modeButtons.forEach((button) => {
            button.addEventListener('click', () => {
                editorState.brushMode = button.dataset.mode ?? 'add';
                modeButtons.forEach((btn) => btn.classList.toggle('active', btn === button));
            });
        });

        brushSizeInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            editorState.brushSize = value;
            updateBrushLabel(value);
        });

        closeEditorButton.addEventListener('click', closeEditor);
        cancelEditButton.addEventListener('click', closeEditor);
        applyEditButton.addEventListener('click', applyEditorChanges);
        editorOverlay.addEventListener('click', (event) => {
            if (event.target === editorOverlay) {
                closeEditor();
            }
        });

        editorCanvas.addEventListener('pointerdown', handlePointerDown);
        editorCanvas.addEventListener('pointermove', handlePointerMove);
        editorCanvas.addEventListener('pointerup', handlePointerUp);
        editorCanvas.addEventListener('pointerleave', handlePointerUp);

        function createEditorOverlay() {
            const overlay = document.createElement('div');
            overlay.className = 'editor-overlay';
            overlay.innerHTML = `
                <div class="editor-panel">
                    <header>
                        <h3 class="editor-title">マスク編集</h3>
                        <button type="button" class="editor-close" aria-label="閉じる">×</button>
                    </header>
                        <div class="editor-body">
                            <div class="editor-canvas-wrap">
                                <canvas class="editor-base-canvas" width="1" height="1"></canvas>
                                <canvas class="editor-mask-canvas" width="1" height="1"></canvas>
                            </div>
                        <p class="editor-hint">描画で消しすぎ・残しすぎを直接修正できます。残すモードで描くと背景を復元、消すモードで描くと透明にします。</p>
                        <div class="editor-controls">
                            <button type="button" data-mode="add" class="active">残す</button>
                            <button type="button" data-mode="erase">消す</button>
                            <label class="brush-control">
                                ブラシ
                                <input type="range" min="8" max="96" step="2" value="32" class="brush-size">
                                <span class="brush-size-value">32px</span>
                            </label>
                        </div>
                        <div class="editor-actions">
                            <button type="button" class="cancel-edit">キャンセル</button>
                            <button type="button" class="apply-edit">適用</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            return overlay;
        }

        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./pwa-sw.js').catch((err) => {
                    console.warn('Service worker registration failed', err);
                });
            });
        }
