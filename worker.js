import { pipeline, env, RawImage, AutoModelForSemanticSegmentation } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.0-next.7';

env.allowLocalModels = false;
env.useBrowserCache = true;

const semanticSegmentationMappings = AutoModelForSemanticSegmentation.MODEL_CLASS_MAPPINGS?.[0];
if (semanticSegmentationMappings && !semanticSegmentationMappings.has('SegformerForSemanticSegmentation')) {
    semanticSegmentationMappings.set('SegformerForSemanticSegmentation', 'SegformerForSemanticSegmentation');
}

let segmenter;

let initializedConfig;

const composeSelectedMasks = (segments, maskIndices, pixelCount) => {
    if (!Array.isArray(maskIndices) || maskIndices.length === 0 || pixelCount === 0) {
        return null;
    }

    const combined = new Uint8ClampedArray(pixelCount);
    const seen = new Set();
    let hasPixels = false;

    for (const value of maskIndices) {
        const index = Number(value);
        if (!Number.isFinite(index) || index < 0 || seen.has(index)) {
            continue;
        }
        seen.add(index);

        const segmentMask = segments[index]?.mask;
        const data = segmentMask?.data;
        if (!data || data.length !== pixelCount) {
            continue;
        }

        hasPixels = true;
        for (let i = 0; i < pixelCount; i++) {
            if (data[i]) {
                combined[i] = 255;
            }
        }
    }

    return hasPixels ? { data: combined } : null;
};

const postProgress = (detail, progress = null, requestId = null) => {
    const message = { type: 'progress', detail, requestId };
    if (typeof progress === 'number') {
        message.progress = Math.min(100, Math.max(0, Math.round(progress)));
    }
    self.postMessage(message);
};

self.onmessage = async (e) => {
    const { buffer, width, height, modelPath, device, dtype, masks: requestedMasks, requestId } = e.data;

    try {
        const resolvedDevice = device ?? 'wasm';
        const resolvedDtype = dtype ?? (resolvedDevice === 'webgpu' ? 'fp32' : 'q8');
        postProgress('モデルを初期化しています', 5, requestId);

        if (!segmenter || initializedConfig?.modelPath !== modelPath || initializedConfig.device !== resolvedDevice || initializedConfig.dtype !== resolvedDtype) {
            segmenter = await pipeline('image-segmentation', modelPath, {
                device: resolvedDevice,
                dtype: resolvedDtype
            });
            initializedConfig = {
                modelPath,
                device: resolvedDevice,
                dtype: resolvedDtype
            };
            postProgress('モデルを読み込みました', 20, requestId);
        }

        // RGBA -> RGB 螟画鋤
        const rgba = new Uint8ClampedArray(buffer);
        const rgb = new Uint8Array(width * height * 3);
        const totalPixels = width * height;
        const convertChunk = Math.max(1, Math.floor(totalPixels / 10));
        for (let i = 0; i < totalPixels; i++) {
            rgb[i * 3]     = rgba[i * 4];
            rgb[i * 3 + 1] = rgba[i * 4 + 1];
            rgb[i * 3 + 2] = rgba[i * 4 + 2];
            if (i % convertChunk === 0) {
                const percent = 30 + (i / totalPixels) * 20;
                postProgress('ピクセルを変換中', percent, requestId);
            }
        }
        postProgress('ピクセル変換完了', 45, requestId);

        const rawImage = new RawImage(rgb, width, height, 3);

        // 謗ｨ隲門ｮ溯｡・
        postProgress('セグメンテーションを実行しています', 50, requestId);
        const output = await segmenter(rawImage);
        postProgress('セグメンテーション完了', 60, requestId);
console.log(new Set(output.data));
        const segments = Array.isArray(output) ? output : [output];
        const fallbackMask = output?.mask ?? segments[0]?.mask;
        let mask = fallbackMask;
        const selectionMask = composeSelectedMasks(segments, requestedMasks, totalPixels);
        if (selectionMask) {
            mask = selectionMask;
        }
        if (!mask) {
            const defaultMaskData = new Uint8ClampedArray(totalPixels);
            defaultMaskData.fill(255);
            mask = { data: defaultMaskData };
        }

        const outRGBA = new Uint8ClampedArray(width * height * 4);
        const maskChunk = Math.max(1, Math.floor(totalPixels / 10));
        for (let i = 0; i < totalPixels; i++) {
            outRGBA[i * 4]     = rgba[i * 4];     // R
            outRGBA[i * 4 + 1] = rgba[i * 4 + 1]; // G
            outRGBA[i * 4 + 2] = rgba[i * 4 + 2]; // B
            outRGBA[i * 4 + 3] = mask.data[i];    // A
            if (i % maskChunk === 0) {
                const percent = 65 + (i / totalPixels) * 20;
                postProgress('マスクを合成中', percent, requestId);
            }
        }

        const outBuffer = outRGBA.buffer;
        postProgress('出力を準備中', 90, requestId);
        postProgress('完了しました', 100, requestId);
        self.postMessage({
            type: 'result',
            requestId,
            outputBuffer: outBuffer,
            width: width,
            height: height
        }, [outBuffer]);

    } catch (err) {
        console.error(err);
        self.postMessage({
            type: 'error',
            requestId,
            error: err.message
        });
    }
};
