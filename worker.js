import { pipeline, env, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

let segmenter;


self.onmessage = async (e) => {
    const { buffer, width, height, modelPath, webgpu, quantized } = e.data;

    try {
        if (!segmenter) {
            segmenter = await pipeline('image-segmentation', modelPath, {
                device: webgpu ? 'webgpu' : 'wasm', 
                quantized: quantized
            });
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