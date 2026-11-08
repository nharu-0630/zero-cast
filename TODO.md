# TODO

最終更新：2026-11-08
仕様は `docs/SPEC.md`、検証結果は `docs/POC.md` を参照する。

## 決定待ち

- [ ] Chirp 3 HD の検証に使う Google Cloud の課金先を決める。請求先アカウント「default」は紐づけ上限に達しており、新規プロジェクト `nharu-zero-cast` に課金を設定できなかった。
  - 案1：既存の Gemini Project で Text-to-Speech API を有効にする。他のプロジェクトに影響せず、すぐ検証できる。
  - 案2：GMaps Project の課金を外して枠を空ける。そのプロジェクトで課金が必要な機能を使っていると止まる。
  - 案3：Google に紐づけ上限の引き上げを申請する。承認まで検証が止まる。

## PoC の残り

- [ ] Chirp 3 HD で台本を合成する（`poc/pipeline/scripts/synthesize.mjs`）。スクリプトは未実行で、動作は未確認。
  - 実行前に `poc/pipeline/out/` の台本が必要。無い場合は `run-scripts.mjs` で再生成する（`out/` は Git の管理外）。
  - 確認項目：Google の MP3 のバイト連結、ビットレートと固定ビットレートかどうか、日本語の読み上げ速度。
  - `ab-raw.mp3` と `ab-kana.mp3` を聞き比べ、英語の略語をカタカナにする指示が必要かを決める。
- [ ] iPhone で再生を検証する（後回しにした項目）。
  1. Safari で https://zero-cast.nharu.dev/ を開き、ホーム画面に追加して、そのアイコンから起動する。
  2. ホーム画面アプリ内で Access のログインが完了するかを確認する。
  3. A と B を押して画面を消し、約3分半聞いて次の項目に進むかを確認する。
  4. 「音声をダウンロード」のあと機内モードにして、C と D を同様に試す。
  5. 機内モードを解除して「結果を送信」を押す。ログは R2 バケット `zero-cast-poc` の `logs/` に保存される。
- [ ] Access のログインが 168 時間維持されるか、Safari とホーム画面アプリでセッションが分かれるかを確認する。
- [ ] 普段読むサイト 30 件で本文取得の成功率を測る。

## PoC の後

- [ ] PoC の結果を `docs/SPEC.md` に反映する（特に、連続再生とオフラインの方式、英語の読みの扱い）。
- [ ] Gemma 4 の台本の目標文字数の式を見直す。実測では約 3,400 文字が上限だった。
- [ ] フェーズ1（MVP）を実装する。本番の Worker は `zero-cast.nharu.dev` を PoC から引き継ぐ。
- [ ] Worker に `Cf-Access-Jwt-Assertion` の検証を実装する（PoC では未実装）。

## 作成済みの外部リソース

| 種類 | 名前 | 備考 |
| --- | --- | --- |
| Cloudflare Worker | `zero-cast-poc-playback` | `zero-cast.nharu.dev` で公開。`nharu-private` で保護、`workers.dev` は無効 |
| Cloudflare R2 | `zero-cast-poc` | 検証用音声と端末から送信したログ |
| Google Cloud プロジェクト | `nharu-zero-cast` | 課金は未設定で、Text-to-Speech API も無効のまま。案1を選ぶなら不要なので削除する |
