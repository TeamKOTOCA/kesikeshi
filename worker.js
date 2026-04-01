// Transformers.jsをCDNからロード
import { pipeline, env, RawImage } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// GitHub Pages等の静的ホスト向け設定
env.allowLocalModels = false;
env.useBrowserCache = false;

let segmenter;

self.onmessage = async (e) => {
    const { buffer, width, height } = e.data;

    try {
        // モデルのロード (初回のみ)
        if (!segmenter) {
            segmenter = await pipeline('image-segmentation', 'Briaai/RMBG-2.0');
        }

        // 移転されたバッファ(Uint8Array)をRawImage形式にラップ
        // 4はRGBAのチャンネル数
        const rawImage = new RawImage(new Uint8Array(buffer), width, height, 4);

        // 推論実行 (ここでWasmがフル稼働)
        const output = await segmenter(rawImage);

        // 出力されたCanvasからピクセルデータ(ArrayBuffer)を取得
        const outCtx = output.canvas.getContext('2d');
        const outImageData = outCtx.getImageData(0, 0, output.canvas.width, output.canvas.height);
        const outBuffer = outImageData.data.buffer;

        // メインスレッドに所有権を戻す
        self.postMessage({
            outputBuffer: outBuffer,
            width: output.canvas.width,
            height: output.canvas.height
        }, [outBuffer]);

    } catch (err) {
        self.postMessage({ error: err.message });
    }
};
