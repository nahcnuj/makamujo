# Program Info Reader（番組情報の読み取り）

番組情報（視聴者数 / コメント数 / ニコニコ広告ポイント / ギフトポイント）を
**配信ページをブラウザで描画し、画面に表示されている値**として読む経路の契約。

対象は配信ページの統計行と `embedded-data` であり、わんコメ
（`POST /api/meta`）の `niconama` / `points` は使わない。

## なぜレンダリングが必要か（確定）

- 配信ページの統計行は 5 枠（視聴者数 / コメント数 / タイムシフト予約数 /
  ニコニコ広告ポイント / ギフトポイント）を持つが、**HTML では全て `-`
  プレースホルダ**（`data-blank="true"`）である。
- 実値は unama WebSocket の `dwango.nicolive.chat.data.Statistics`
  （`viewers` / `comments` / `ad_points` / `gift_points`）をページの JS が受けて
  埋める。HTML には `adPoint` / `giftPoint` が **0 箇所**しか存在しない。
- HTTP で完結する統計 API は存在しない。`/api/live/{lv}/program` 等は 404、
  `pollingApiBaseUrl`（`papi.live.nicovideo.jp`）は `/api/relive/notifybox.*` 専用。
- よって「ページが表示している値」は JS 実行後の DOM にしか無い。

## 読む値

| 指標 | ページ上の枠 / 出どころ | 型 |
|------|--------------------------|---|
| 視聴者数 | `watch-count-item` | 視聴者数 |
| コメント数 | `comment-count-item` | コメント数 |
| ニコニコ広告 | `nicoad-count-item` | **ニコニコ広告ポイント**（件数ではない） |
| ギフト | `gift-count-item` | **ギフトポイント**（件数ではない） |
| タイトル / 開始時刻 / 放送状態 | `embedded-data` の `program.title` / `beginTime` / `status === 'ON_AIR'` | |
| 番組 URL | `embedded-data` の `program.watchPageUrl`（無ければ `/watch/{nicoliveProgramId}`） | 番組同一性のキー |

`StreamMeta.total` の各項目は optional。ページに値が無い（`-`）ときは
`undefined` のまま通し、コンソールは `formatMetricValue(undefined) === "-"` で
配信ページと同じ `-` を表示する。オーバーレイは `0` と同じ扱いで隠す。

## モジュール

| モジュール | 層 | 役割 |
|------------|----|------|
| `lib/domain/broadcasting/watchPageStatistics.ts` | domain（純関数） | 統計行の表示テキスト → 数値（`-` / `,` / `万` / `億` 対応） |
| `lib/domain/broadcasting/watchPageProgram.ts` | domain（純関数） | `embedded-data` → 番組同一性。ブラウザ経由で読む `parseWatchPageProgramProps` も公開 |
| `lib/application/ProgramInfoAssembler.ts` | application（純関数） | `WatchPageProgram` + `DisplayedStatistics` → `StreamData` |
| `composition/watchPageBrowserReader.ts` | composition | 採取ループ。Playwright 非依存（`createSession` 差し替え可） |
| `composition/watchPageBrowserSession.ts` | composition | Playwright 実装。**必要なときだけ動的 import** |

## 環境変数

| 変数 | 既定 | 意味 |
|------|------|------|
| `NICONAMA_WATCH_PAGE_READ_INTERVAL_MS` | `30000` | 採取周期。ページは 30〜60 秒粒度なのでこれより短くしても無駄 |
| `NICONAMA_WATCH_PAGE_URL` | `DEFAULT_NICONAMA_WATCH_PAGE_URL` | **テスト専用の差し替え口**。本番で読むページはコードに固定している |
| `NICONAMA_WATCH_PAGE_DISABLED` | （未設定 = 有効） | `1` で reader を起動しない。ブラウザ reader を使わないテストが設定する（無効時は `POST /api/meta` へフォールバック） |

## ブラウザ操作の契約

- ページは**一度だけ開き、以降は開いたまま**統計行の表示テキストを読み直す
  （ページ自身が WebSocket で更新するため）。採取周期ごとに再読み込みはしない。
- 読み取りに失敗したら `onError` に通知してセッションを破棄するが、
  `programInfo` は直前の値を保つ（勝手にはオフラインにしない）。次の採取で作り直す。
- **ページが読めていない（空 / エラーページ / JS 実行前）ときも同じ**：`read()` が
  throw し、`onSnapshot` には到達しない。空の読み取りを「配信終了」と誤解して
  番組情報を飛ばさないため。
- 配信ページが 200 で応答し、`status` が `ON_AIR` 以外なら **オフライン**として扱う
  （実ページでは配信していないユーザーでも直近の番組が載るため）。
- したがって「配信ページが 404 / 到達不能」の場合はオフラインにならず**直前値を
  維持**する。これは意図した trade-off（空読み取りで正しい番組情報を飛ばさない
  ことを優先）。

## 公開ペイロードへの反映

`assemblePublishedPayload` は `programInfo` 入力を受け取り、`niconama` と
`commentCount` は **配信ページ由来の値を下に採る**。`POST /api/meta` の
`niconama` / `points` は、ページ情報をまだ取得していない場合
（`programInfo === undefined`、= `NICONAMA_WATCH_PAGE_DISABLED=1` のとき）に
だけフォールバックとして効く。`replyTargetComment` などその他のフィールドは
従来どおり `POST /api/meta` から供給される。

## 検証

- 純関数と reader のループは単体テストで覆う（ブラウザ不要）。
- 配信ページの描画経路は `tests/integration/watch-page-program-info.test.ts`。
  配信ページの代わりにローカル HTTP サーバを立て、JS が値を描き換える実際の
  ページと同じ挙動を再現する。Chromium が起動できない環境では skip する
  （CI は `pretest:e2e` 相当で Chromium を用意している）。
