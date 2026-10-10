# architecture/

馬可無序（makamujo）のエンジニアリング向け設計・契約ドキュメント置き場。

既存の [`docs/`](../docs/) はランディングページ用の静的資産専用である。ここに Markdown の設計文書を混ぜない。

設計文書は原則このファイルにまとめる。個別の設計 Markdown は増設しない。

## 文書一覧

| ファイル / 領域 | 内容 |
|------|------|
| [domain-model-redesign.md](./domain-model-redesign.md) | 配信エージェント BC 再設計（#463 マージ済）。CommentPipeline / silence / Publication |
| [console-domain-model.md](./console-domain-model.md) | **管理コンソール BC**（Access / Status plan）。UI は `console/src`、純関数は `lib/domain/console` |
| [統計の読み取り](#統計の読み取り) | 配信ページを描画して統計行を読む。視聴者数 / コメント数 / ニコニコ広告ポイント / ギフトポイント |
| `legacy` vs `main` | orphan main の差分整理と取り込み方針は本 README の実装マップで追跡する（個別文書は持たない） |
| [legacy-vs-main-integration.md](./legacy-vs-main-integration.md) | **`legacy` vs `main` 差分整理と取り込み方針**（orphan main、port 済み/未着手） |
| [markov-cli.md](./markov-cli.md) | **markov CLI**（`tools/markov/`）。git `parse-options` と同じ「1 コマンド 1 ファイル、そのコマンドのオプション表だけ解析する」形。表は `--help` の出力（[表の確認方法](./markov-cli.md#表の確認方法)） |

## 読み方（実装エージェント向け）

1. 振る舞い変更はしない。観測可能な契約は設計書の characterization / observables 節に従う。
2. **配信エージェント**（#463 済）: `lib/Agent/index.test.ts` と CommentPipeline / `speechable` がゴールデン。
3. **管理コンソール**（継続）: `lib/domain/console/*` の純関数 + 既存 `console/src` / integration テストがゴールデン。
4. `docs/` は静的サイト専用。設計 Markdown は `architecture/` のみ。

## 統計の読み取り

視聴者数 / コメント数 / ニコニコ広告ポイント / ギフトポイントを
**配信ページをブラウザで描画し、画面に表示されている値**として読む経路の契約。
タイトル / 開始時刻 / 放送状態 / 番組 URL は対象外で、従来どおり
わんコメ（`POST /api/meta`）の値を公開する。

### なぜレンダリングが必要か（確定）

- 配信ページの統計行は HTML では全て `-` プレースホルダ（`data-blank="true"`）である。
- 実値は unama WebSocket の `dwango.nicolive.chat.data.Statistics`
  （`viewers` / `comments` / `ad_points` / `gift_points`）をページの JS が受けて
  埋める。HTML に `adPoint` / `giftPoint` は **0 箇所**しか存在しない。
- HTTP で完結する統計 API は存在しない。`/api/live/{lv}/program` 等は 404、
  `pollingApiBaseUrl`（`papi.live.nicovideo.jp`）は `/api/relive/notifybox.*` 専用。
- よって「ページが表示している値」は JS 実行後の DOM にしか無い。

### 読む値

| 指標 | ページ上の枠 |
|------|--------------|
| 視聴者数 → `niconama.meta.total.listeners` | `watch-count-item` |
| コメント数 → `commentCount` | `comment-count-item` |
| ニコニコ広告ポイント → `niconama.meta.total.ad` | `nicoad-count-item` |
| ギフトポイント → `niconama.meta.total.gift` | `gift-count-item` |

ページが数値を出している項目はそれを公開する。ページが `-` の項目は
PUT / POST（`POST /api/meta`）にある値を消さない。どちらも無い項目は
直前に自己収集した値を残す。一度も値が無い項目だけキーを出さない
（コンソールは `formatMetricValue(undefined) === "-"`、オーバーレイは `0` 扱い）。
`POST /api/meta` が `niconama` を含まない更新は、直前の番組情報を残す。

### モジュール

| モジュール | 層 | 役割 |
|------------|----|------|
| `lib/domain/broadcasting/watchPageStatistics.ts` | domain（純関数） | 統計行の表示テキスト → 数値（`-` / `,` / `万` / `億` 対応） |
| `lib/domain/publication/assemblePublishedPayload.ts` | domain（純関数） | ページの数値だけ統計を更新し、PUT / POST に無い項目は消さない |
| `composition/watchPageBrowser.ts` | composition | ブラウザ実体の契約（`open` / `read` / `isAlive` / `discard`）と生読み取りの変換。Playwright 非依存 |
| `composition/chromiumWatchPageBrowser.ts` | composition | Playwright（Chromium）実装。**必要なときだけ動的 import** |
| `composition/watchPageStatisticsSource.ts` | composition | 環境変数・採取周期・ブラウザの生存確認と作り直し・失敗ログ。`index.ts` はこれを 1 回呼ぶだけ |

差し替え口は URL ではなく `createBrowser`（ブラウザ実体そのもの）。

### 環境変数

| 変数 | 既定 | 意味 |
|------|------|------|
| `NICONAMA_WATCH_PAGE_READ_INTERVAL_MS` | `30000` | 採取周期。ページは 30〜60 秒粒度なのでこれより短くしても無駄 |
| `NICONAMA_WATCH_PAGE_URL` | `DEFAULT_NICONAMA_WATCH_PAGE_URL` | **テスト専用の差し替え口**。本番で読むページはコードに固定している |
| `NICONAMA_WATCH_PAGE_DISABLED` | （未設定 = 有効） | `1` でブラウザ経路を起動しない。ブラウザを使わないテストが設定する（無効時は `POST /api/meta` へフォールバック） |

### ブラウザ操作の契約

- ページは**一度だけ開き、以降は開いたまま**統計行の表示テキストを読み直す
  （ページ自身が WebSocket で更新するため）。採取周期ごとに再読み込みはしない。
- **読み取りに失敗しても開いたページは捨てない。** 普通に視聴するときと同じで、
  ページは開いたら開きっぱなしにする。失敗はログに出し、公開中の値は直前の
  ものを保つ。次の採取では開いたままのページを読み直す。
- ブラウザ実体（未オープン / Chromium プロセス / ページが落ちた）だけ作り直す。
  判定は `WatchPageBrowser.isAlive()`（`open` / `read` / `discard` と同じ契約）。
  作り直しのときだけページを開くので、生きている間は開き直さない。
- 統計行そのものが無いページ（空 / エラーページ / JS 実行前）では `read()` が
  throw し、値を出さない。空の読み取りを「配信終了」と誤解させないため。
- 失敗ログは source 側でスロットルする（1 回目の直後と、その後は 10 回ごと）。

### 検証

- 純関数と採取ループは単体テストで覆う（ブラウザ不要）。
- 配信ページの描画経路は `tests/integration/watch-page-statistics.test.ts`。
  配信ページの代わりにローカル HTTP サーバを立て、JS が値を描き換える実際の
  ページと同じ挙動を再現する。Chromium が起動できない環境では skip する
  （CI は `pretest:e2e` 相当で Chromium を用意している）。

## 実装マップ

| 領域 | パス | 状態 |
|------|------|------|
| NGram / Silence / Topic / Scripts | `lib/domain/*` | 済 |
| 統計のページ読み取り | `lib/domain/broadcasting/watchPageStatistics.ts` | 済 |
| Publication assemble | `lib/domain/publication/` | 済 |
| AgentSession + services | `lib/application/` | 済 |
| 統計のブラウザ読み取り | `composition/watchPageBrowser.ts`, `composition/chromiumWatchPageBrowser.ts`, `composition/watchPageStatisticsSource.ts` | 済 |
| Console access / status plan / SSE frames | `lib/domain/console/` | 済（Basic auth 純関数含む） |
| systemd / make install（main から port） | `Makefile`, `etc/systemd/` | 済 |
| Outer console WS bridge | `composition/consoleOuterWebSocket.ts` | 済 |
| Console UI | `console/src/AgentStatus/` | ファサード維持 |

## 関連

- プロジェクト指示: [`AGENTS.md`](../AGENTS.md)
- 中核実装: [`lib/Agent/index.ts`](../lib/Agent/index.ts)、[`lib/streamState.ts`](../lib/streamState.ts)、[`index.ts`](../index.ts)
