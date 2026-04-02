# KesiKeshi

## 概要
KesiKeshiはブラウザだけで写真の背景を切り抜いて透明PNGを生成する、PWA対応のミニマルなツールです。ファイル選択またはドラッグ＆ドロップで画像を読み込み、Hugging Face Transformers.jsのセマンティックセグメンテーションを使ってピクセル単位のマスクを生成し、ダウンロード可能な結果を表示します。

## 特徴
- **プログレッシブなUI**: ドラッグ可能なドロップゾーン、進捗バー、ステータス表示で処理状況を逐次フィードバック。
- **複数モデルサポート**: RMBG-1.4、MODNet、ISNet、テスト用モデル（BEN2-ONNX）から選択でき、必要に応じて近似精度・サイズを使い分け可能。
- **サービスワーカー＋マニフェスト**: `manifest.webmanifest`でスタンドアロン表示・テーマカラーを定義し、`pwa-sw.js`が静的リソースとセグメンテーション結果をキャッシュしてオフライン化。
- **Web Worker処理**: `worker.js`上のHugging Faceパイプライン（Transformers.js）で画像をRGBA→RGBへ変換し、セグメンテーション実行後にマスクを合成して透過PNGを返却。

## モデルとライブラリ
| 名前 | 説明 | 由来／ライセンス |
| --- | --- | --- |
| RMBG-1.4 | BRIA AI提供の高品質背景除去モデル | `briaai/RMBG-1.4`（CC BY-NC 4.0）|
| MODNet | ZHKUNのMODNet、細部の切り抜きを強化 | `Xenova/modnet`（GitHub）|
| ISNet | RMBGの補完で急上昇しているセグメンテーション | `imgly/isnet-general-onnx`|
| test | ベンチマーク用の`BEN2-ONNX`で挙動確認 | `onnx-community/BEN2-ONNX`|

## 使い方
1. **ローカルで起動**: 静的ホスティングで`index.html`を公開（例：`python -m http.server 4173`または`npx http-server .`）。
2. **画像を読み込む**: ドラッグ＆ドロップまたはファイル入力から複数枚の画像を追加。
3. **モデルを選択**: プルダウンから希望のモデルを選び、処理を自動開始。
4. **ダウンロード**: 処理済みカードの「Download PNG」ボタンをクリックして透過PNGを取得。名前は`kesikeshi_YYYYMMDD_HHMM_<元画像>.png`形式で保存されます。

## 内部処理と拡張
- `worker.js`はHugging Face Transformers.jsをESモジュールとして読み込み、`pipeline('image-segmentation', ...)`でモデルを初期化。`postMessage`/`onmessage`で進捗イベントと結果をやり取り。
- ピクセル変換中に進捗を更新し、必要なら`masks`で任意のセグメントを合成できる（現在未公開だが構造あり）。
- `style.css`はモダンなカードレイアウト、レスポンシブ対応、アクセシブルな状態表現を定義。
- `pwa-sw.js`はキャッシュリストを手動で定義し、`manifest.webmanifest`に記した192/512サイズのアイコンやカラーを利用してPWAランチャーを構成。オフライン時でも最後に読んだアセットを再利用できる。

## 開発・ホスティング
- このプロジェクトにビルドステップは不要。静的ファイルなので任意のHTTPサーバーで配信するだけです。
- モデルやライブラリを更新したい場合は`worker.js`の`pipeline`呼び出し先を変更し、`modellist`定義を`index.html`内で調整してください。

## ライセンス
[LICENSE](LICENSE)に従います。
