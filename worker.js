import { pipeline, env, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

let segmenter;


self.onmessage = async (e) => {
    const { buffer, width, height, modelPath, webgpu, quantized } = e.data;

    try {
        if (!segmenter) {
            // まずは確実に動く1.4でテストしてください
            segmenter = await pipeline('image-segmentation', modelPath, {
                // ここが重要！
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

        /* 修正ポイント：
           output.canvas が無い場合に備え、
           output.mask (RawImage) を使ってピクセルデータを作成する
        */
        const mask = output.mask || output[0].mask; 
        
        // 元の画像のRGBに、モデルが作ったAlpha(透明度)を合成する
        const outRGBA = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            outRGBA[i * 4]     = rgba[i * 4];     // R
            outRGBA[i * 4 + 1] = rgba[i * 4 + 1]; // G
            outRGBA[i * 4 + 2] = rgba[i * 4 + 2]; // B
            outRGBA[i * 4 + 3] = mask.data[i];    // A (モデルが計算した透過値)
        }

        const outBuffer = outRGBA.buffer;

        // メインスレッドに返却
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