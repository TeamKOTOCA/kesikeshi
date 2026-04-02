import { pipeline, env, RawImage, AutoModelForSemanticSegmentation } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.0-next.7';

env.allowLocalModels = false;
env.useBrowserCache = true;

const semanticSegmentationMappings = AutoModelForSemanticSegmentation.MODEL_CLASS_MAPPINGS?.[0];
if (semanticSegmentationMappings && !semanticSegmentationMappings.has('SegformerForSemanticSegmentation')) {
    semanticSegmentationMappings.set('SegformerForSemanticSegmentation', 'SegformerForSemanticSegmentation');
}

let segmenter;


let initializedConfig;

self.onmessage = async (e) => {
    const { buffer, width, height, modelPath, device, dtype } = e.data;

    try {
        const resolvedDevice = device ?? 'wasm';
        const resolvedDtype = dtype ?? (resolvedDevice === 'webgpu' ? 'fp32' : 'q8');

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
        }

        // RGBA -> RGB 変換
        const rgba = new Uint8ClampedArray(buffer);
        const rgb = new Uint8Array(width * height * 3);
        for (let i = 0; i < width * height; i++) {
            rgb[i * 3]     = rgba[i * 4];
            rgb[i * 3 + 1] = rgba[i * 4 + 1];
            rgb[i * 3 + 2] = rgba[i * 4 + 2];
        }

        const rawImage = new RawImage(rgb, width, height, 3);

        // 推論実行
        const output = await segmenter(rawImage);

        const mask = output.mask || output[0].mask; 
        
        const outRGBA = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            outRGBA[i * 4]     = rgba[i * 4];     // R
            outRGBA[i * 4 + 1] = rgba[i * 4 + 1]; // G
            outRGBA[i * 4 + 2] = rgba[i * 4 + 2]; // B
            outRGBA[i * 4 + 3] = mask.data[i];    // A (モデルが計算した透過値)
        }

        const outBuffer = outRGBA.buffer;

        self.postMessage({
            outputBuffer: outBuffer,
            width: width,
            height: height
        }, [outBuffer]);

    } catch (err) {
        console.error(err);
        self.postMessage({ error: err.message });
    }
};
