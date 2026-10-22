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
| [配信画面の停止回復](#配信画面の停止回復) | 配信ページの描画した映像の動きを測り、複数周期静止し続けた合成出力を systemd 再起動で回復する |
| [オーバーレイの生存検知](#オーバーレイの生存検知と-obs-回復) | OBS の browser source が配信ページを描画しなくなった（オーバーレイが映像に一フレームも寄与しない）をサーバー側で検知し、OBS を再起動する |
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
- ブラウザ実体（Chromium プロセス / ページが落ちた）か、`open` に失敗したとき
  だけ作り直す。実体の生死は `WatchPageBrowser.isAlive()`（`open` / `read` /
  `discard` と同じ契約）で判定し、`open` に失敗した実体は source 側が破棄する。
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

## 配信画面の停止回復

 配信画面の**合成出力**（XSHM キャプチャ → x264 エンコード → RTMP の
 配信側機構）が固まり続けると、配信ページ経由で見える配信画面だけが
 静止する。検知は既存の配信異常検知がする（`scripts/check-stream.ts` は
 改変しない: owner 契約 #807）。ここで扱うのは**回復する**経路で、
 セッション内監視（gameStall / compositorHeartbeat / Aw, Snap! watchdog は
 Chromium 内しか見えない）の管轄外にあたる。

外からの検知は「配信映像が 1 秒間まったく変わらない」ことを停止とみなす
（`videoMinFps` / `gameMinFps`）。ゲームが結果画面やフリートークで止まって
いる間は、コメントも発話も無いとオーバーレイまで静止し、合成出力が**本当に**
全フレーム同一になる（2026-10-21 22:27 の停止は音声と media clock が進んだ
まま `videoMinFps` / `gameMinFps` が 0 だった）。これは合成経路の故障では
ないので再起動では直らない。そこで配信オーバーレイ（`src/App.tsx`）は、
全幅の帯を待ち無しで流し続ける鼓動（`src/components/BroadcastHeartbeat.tsx`
と `src/index.css` の `broadcast-heartbeat-sweep`）を常に重ね、発話が無い間も
浮遊キャプション（`SilentCaption`）を止めない。ゲーム部分として切り出す
左 60% にも帯が掛かるため、ゲームが静止していても「配信が生きている」こと
が映像で示せる。**静止した時間帯を作らないこと。**

### 判定の契約

- 配信ページを描画する統計用ブラウザが、開いたままのページで 1 窓だけ
  映像の動きを測る（`WatchPageBrowser.measurePictureMotion`）。動画の選別・
  広告の除外・ピクセルの比較の根拠は `scripts/check-stream.ts` の
  unit test 済み関数（`isCapturableMediaSource`, `isInAdContainer`）を
  文字列化して注入して借りる。判定は
  `composition/watchPageBrowser.ts` の `judgePictureMotion`:
  changed fps が `PICTURE_STILL_FPS_THRESHOLD`（既定 24）を下回る窓が `still`。
  測れない窓（広告が流れた、tainted、比較が少なすぎる）は判定できない。
  同じ測定が、対象 `<video>` の media clock（`currentTime`）が窓の間に進んだ
  秒数 `clockAdvancedSeconds` も返す。放映中かはこの前進（
  `CLOCK_ADVANCE_MIN_SECONDS` 超）で判断する（`isOnAirFromClock`）。合成出力が
  固まっていても hls.js はセグメントを再生し続けるので clock は進むため、
  「配信画面は静止しているのに放映中」を検知できる。わんコメの
  `POST /api/meta` が張ったセッション（`streamState`）を放映中の根拠には
  しない: cron の再起動直後は undefined で、わんコメの接続が切れていると
  一度も定義されず、その間 watchdog が毎周期を放映外とみなして測定すら行わず、
  本物の合成出力の停止を放置する（issue #929/#933: 音声と media clock は進み
  続け、外からの健康チェックだけが停止を繰り返し検知していた）。
  サンプラーは再生中の `<video>` しか選ばないため、統計用ブラウザは
  `--autoplay-policy=no-user-gesture-required` で起動し、ページを開いた直後と
  計測のたびに `startVideoPlayback` で全 `<video>` をミュート再生させる。
  これが無いと headless では要素が paused のままになり、観測が永久に
  `unknown` になって回復が一度も走らない（`check-stream.ts` と同じ扱い）。
  窓を開く前に、計測できる `<video>`（`videoWidth > 0` / `readyState >= 2` /
  再生中）が戻り、media clock が `MEASURABLE_VIDEO_ADVANCE_SECONDS` 以上進む
  のを待つ（`check-stream.ts` の `waitForMeasurableVideo` と同じ）。プレイヤーは
  中割り広告の明けや hls.js の復帰で `<video>` を作り直す。作り直し直後は
  静止した一枚絵を出すので、待たずに測ると本物の停止と区別できない。さらに
  開始時に要素が無いと空測定（判定不能）になり streak が途切れる。実際の
  停止中は hls.js が復帰を試み続けて作り直しが重なるため、ここを待たないと
  回復のラングが上がらない（2026-10-20 の停止では観測周期の約 2 割が空測定
  だった）。窓の途中で要素が入れ替わったらピクセル比較を切り、
  `clockAdvancedSeconds` は同じ要素の間の正の前進を足し上げる（作り直しで
  `currentTime` が 0 付近へ戻っても放映中の根拠を失わない）。
  中割り広告で `<video>` が止まると窓は静止に見えて判定不能（`unknown`）に
  なり、`CompositeFreezePolicy` の streak をリセットする。統計用ブラウザは
  サインアウトのまま長く開いておくので中割りが繰り返され、待たずに測ると
  清潔な窓がほとんど取れず本物の合成停止が回復に達しない。そこで測定の前に
  `waitForAdvertisementEnd` で流れる広告が終わるのを待つ（`check-stream.ts`
  の `waitForAdvertisementEnd` と同じ考え方。上限まで待っても流れていたら
  測定を続行し、その窓は判定不能として破棄される）。
- 広告かどうかは「プレイヤーを占拠しているか」で決める
  （`composition/watchPageBrowser.ts` の `isPlayerAdvertisement`）。配信ページは
  プレイヤーの外側に `___ad-sticky-video___` の常設広告面を持ち、そこでは
  クロスオリジンの広告動画がページを開いている間ずっと再生され続ける
  （2026-10-20 に 95 秒以上の連続再生を実測）。クロスオリジンというだけで
  広告と数えると、統計用ブラウザの測定は毎窓 `sawAdvertisement` になり、全ての
  窓が判定不能になって streak が永久に伸びず、合成出力が固まっていても回復
  ラングが一度も走らない（issue #946）。広告面の中にある要素は番組を止めない
  ので数えない。プリロール / 中割り広告はプレイヤー側に差し込まれて広告面の
  外に出るので、従来どおり広告として扱う。
- 測定は機会良く（開いたままのページがあるときだけ）。ページを作り直さない。
- 純ポリシー `lib/domain/broadcasting/CompositeFreezePolicy.ts` が、周期ごとの
  観測（`still` / `moving` / `unknown`）を折りたたむ:
  - `still` が `cyclesRequired`（既定 1）周期連続したら、回復ラングを打つ。
    測定の 1 窓（3 秒）は観測周期よりずっと短く、番組は止まっていなければ
    24 fps 以上で動く。`videoMinFps=0` の窓が 1 つ出た時点で合成出力は
    止まっている（2026-10-21 08:22:54 の停止: `videoMinFps=0` /
    `videoAvgFps=0.1` が 1 時間ごとの外部検知に繰り返し捉えられた）。
    既定 3 のときは回復を分単位で遅らせるだけで、その間に外部検知が
    issue を作り続けた。放映外の静止（番組終了の一枚絵）は media clock が
    進まないので `isOnAirFromClock` が上映外として先に除き、長さの
    ガードにはならない。よって streak は 1 周期で足りる。
  - `moving` は streak・ラング・クールダウンをすべてリセットする。映像が動いた
    以上、合成出力は回復しており、次の停止は最初のラングから始まる。
  - `unknown` は streak のみリセットする。測れなかった周期は「止まっていない」
    証拠ではないので、ラングとクールダウンは消さない
    （中割り広告が `<video>` を止めて静止に見えて streak を伸ばさない、は維持）。
    ここを全消しにすると、周期ごとに測れない本番（中割り広告・要素の再構築・
    プロセス再起動後の最初の周期）ではラングが `obs` のまま進まず、
    OBS を繰り返し落とすだけで合成出力が回復しなかった（issue #889）。
  - 回復の間隔は `recoveryCooldownMs`（既定 60 秒）。連続回復を防ぐ。
  - ラングは `obs` → `xorgAndObs` → `browserAndBroadcastStack` の順に深くなり
    最深で留まる。やることは systemd restart:
    `composition/broadcastFreezeWatchdog.ts` の `RECOVERY_SERVICES`。
    配信画面 `:10` の実体は ansible が導入する `makamujo-xvfb.service` を指す
    （リポジトリ同梱の `xorg10.service` は本番に無い。誤るとラングが進まない）。
    最深ラングは ansible が束ねるアプリ三連（`makamujo-screen.service` /
    `makamujo-browser.service` / `makamujo-obs.service`）+ xvfb。画面を生成する
    配信サーバ（`makamujo-screen.service`）を落とさないと、そこで起因する静止は
    最深ラングでも回復しない（2026-10-21 03:31 の停止: 音声と media clock は
    進み続け、映像全体が 0 fps のまま外部検知に繰り返し捉えられた）。watchdog
    自身がこの unit のプロセス（`bun start`）の中で動くので、再起動すると
    自プロセスが落ちて残りの unit に届かない。リストの最後に置いて、他の unit
    の再起動が済んでから触る（ポリシー状態は recover の前に永続化してあるので、
    次に起動したプロセスは最深のラングから観測を再開できる）。深いラングの中で
    自プロセスを落とすのは screen だけにする。systemd の `Requires=` は明示的な
    restart も下流に伝播する（systemd.unit(5)）ので、screen が xvfb を
    `Requires=` していると `xorgAndObs` ラング（xvfb → obs）の xvfb 再起動の
    時点で screen も再起動され、watchdog が落ちて、そのあとに並ぶ
    `makamujo-obs.service` の再起動がまったく実行されない。X の再起動の後に
    settle をはさんで OBS を作り直す一手しか、XSHM 側で固まった合成出力を
    回復する手段はなく、ここが欠けると回復ラングを上がっても停止が直らない
    （2026-10-21 06:25 の停止: 音声は流れ続け、映像全体とゲーム画面部分が
    0 fps のまま外部検知に繰り返し捉えられた）。そこで screen の xvfb 依存は
    `Wants=` にして伝播を断つ（`etc/systemd/makamujo-screen.service`。起動時に
    は引き続き `After=` で :10 を先に開く）。
- ポリシーの状態は `var/broadcast-freeze-state.json` に残して引き継ぐ
  （`lib/application/compositeFreezeStateStore.ts`）。サーバーは cron に
  11 分ごとに殺され start されるので、メモリだけの状態では最深のラングに
  届く前に毎回 `obs` からやり直しになる。原子的な書換え（一時ファイル → rename）で
  書き、壊れたファイルは新規扱いで起動する（`var/stream-baseline.json` と同じ）。
- 番組が放映外の間は観測をしない（番組終了の一枚絵を回復の対象にしない）。
  放映中かは測定した `<video>` の media clock の前進（`isOnAirFromClock`）で
  判断する。clock が進まない周期（番組終了の一枚絵 / paused）と測定不能な周期
  （ページ未オープン / 広告 / tainted）は、ポリシーに `unknown` として投入して
  streak をリセットするだけで、ラングとクールダウンは消さない。サーバーは cron に
  11 分ごとに殺され start されるたびに、起動直後の最初の周期は配信ページの開設が
  間に合わず測定不能に当たる。放映外 / 測定不能で状態を全消ししていた間は、
  永続化した状態が毎回の起動直後に消えてラングが `obs` のまま深まらず、合成出力が
  止まったままだった（#927）。放映中の根拠にわんコメのセッションを使うと、
  cron 再起動直後やわんコメ切断時に毎周期が放映外になり、測定すら走らない
  （#929/#933）。
- 観測周期の tick は例外を外へ漏らさない（`tick` の else で `log.error` して
  finally で続行）。漏らすと以降の周期が静かに止まり、回復の機会が失われる
  （issue #931）。
- 1 周期の測定にも上限を置く（`BROADCAST_FREEZE_MEASUREMENT_TIMEOUT_MS`）。
  例外は握れても、レンダラが固まったときの `page.evaluate` は解決せず、
  tick が `ticking` のまま残ると以降の周期がすべて素通りして回復が永久に
  走らなくなる。外からの健康チェックだけが停止を検知し続け、最深ラングに
  届いた後も回復しない。上限を超えた周期は測定不能 (`unknown`) として捨てて
  streak をリセットし、次の周期へ進む。`composition/chromiumWatchPageBrowser.ts`
  側でもセレクタ注入・広告確認・`<video>` 状態の読み取りを個別に打ち切る。
- 最深ラングの再起動順は 表示 (`makamujo-xvfb.service`) → ブラウザ → OBS →
  配信サーバ。ブラウザ / OBS / 配信サーバは `DISPLAY=:10` に描くので、Xorg を
  後から落とすと再起動したブラウザが表示を失ったまま残り、静止が回復しない。
- **ブラウザを restarted したときはゲームを開き直す**。ゲーム用ブラウザ実体
  （`makamujo-browser.service`）は再起動するたびに開いていたページを失う
  （`bin/x/browser.ts` の自動再起動、停止監視からのセッション終了、このラングの
  再起動）。そのページを開き直すのは配信エージェント側
  （`lib/application/GameplayApplicationService.ts`）の責務で、
  ブラウザセッションが（再）接続したときの `initialized` 状態を合図に、
  ソルバを作り直して最初の action（`open`）を返す。放任するとソルバは
  `initialized` を通常の sight として受け取って鍵を押すだけで、ゲームは戻らない:
  表示は空のまま、配信映像は静止したままになる。空の画面は配信異常検知から
  「映像全体 / ゲーム画面部分が停止し続けています」として報告される
  （issue #993）。**回復ラングのブラウザ再起動は、この開き直しが動いて初めて
  効く**。

### モジュールと配線

| モジュール | 層 | 役割 |
|------------|----|------|
| `lib/domain/broadcasting/CompositeFreezePolicy.ts` | domain（純関数） | 周期観測 → 回復ラングの決定 |
| `composition/watchPageBrowser.ts` | composition | 映像の動きの型と判定（Playwright 非依存） |
| `composition/chromiumWatchPageBrowser.ts` | composition | 1 窓の映像の動きを測る実装。rAF が来ない環境でも上限で帰る |
| `composition/watchPageStatisticsSource.ts` | composition | 開いたままのページでの測定の代理。無効時 / 未オープン時は `undefined` |
| `composition/broadcastFreezeWatchdog.ts` | composition | 採取の周期、ポリシーへの投入、systemd 回復の実行口 |
| `lib/application/compositeFreezeStateStore.ts` | application | ポリシー状態の `var/` への永続化（壊れたファイルは新規扱い） |

`index.ts` が統計の採取と同じ場所で 1 回だけ配線する。回復口は
`NODE_ENV=production` のときだけ systemd に触り、それ以外は dry run
（ログだけ）にする。テスト / E2E は統計の読み取り自体を
`NICONAMA_WATCH_PAGE_DISABLED=1` で無効化しているため、そもそも観測が流れない。
起動時に前プロセスの状態を引き継いだら journal に
`resumed the composite freeze state` を残す（どのラングまで進んでいたかの根拠）。

### 環境変数

| 変数 | 既定 | 意味 |
|------|------|------|
| `BROADCAST_FREEZE_CHECK_INTERVAL_MS` | `60000` | 観測周期 |
| `BROADCAST_FREEZE_MEASUREMENT_TIMEOUT_MS` | `180000` | 1 周期の測定の上限。超えたら測定不能として次へ進む |
| `BROADCAST_FREEZE_CYCLES` | `1` | 回復を打つまでに必要な `still` の連続周期 |
| `BROADCAST_FREEZE_RECOVERY_COOLDOWN_MS` | `60000` | 二つの回復の最短間隔 |

## オーバーレイの生存検知と OBS 回復

配信オーバーレイ（`src/App.tsx`）は OBS の browser source として
`http://127.0.0.1:7777/` を開いている。ゲームが静止しているあいだも映像を
動かし続けるため、鼓動の帯（`src/components/BroadcastHeartbeat.tsx` と
`src/index.css` の `broadcast-heartbeat-sweep`）を全幅に流している。この帯は
**browser source がページを描画しているあいだだけ**映像に載る。CEF の
renderer が居なくなれば（OBS の cgroup のメモリ圧で殺された / 落ちた /
配信サーバがまだページを配信していないうちに OBS が起動して読み込み失敗した）、
browser source は最後の絵を保持したまま動かず、オーバーレイは合成出力に
一フレームも寄与しない。

### 症状の見分け方

- 映像全体とゲーム部分の数値が**完全に一致**するなら、オーバーレイは映像に
  寄与していない（2026-10-22 14:27 JST: `videoMinFps` = `gameMinFps` = 14、
  `videoAvgFps` = `gameAvgFps` = 18.3）。帯は全幅なのでゲーム部分（左 60%）
  にも掛かるはずで、両者が一致するのは帯が届いていないことしか説明できない。
- 映像の停止回復の watchdog（`composition/broadcastFreezeWatchdog.ts`）は
  この故障を**検出できない**。合成出力全体を見る判定なので、ゲームが
  動いているあいだは「動いている」としか観測できず、帯が無くても回復の
  ラングは上がらない。
- 帯の速度は原因ではない。帯を実測で忠実再現すると changedFps 29.9〜30 が
  出る（#1008 / #1016 / #1022 の速度変更は意味を持たない）。
- Color Key フィルタも原因ではない。OBS の Color Key（`color_key_filter_v2`）
  は key 色との距離を alpha に変換するが、キー色が黒（`0xFF000000`）なら
  白い帯芯（距離 1.732）と緑の縁（un-premultiply 後の距離 約 1.174）は
  どちらも閾値（similarity 0.8 / smoothness 0.13）を大きく超えるので alpha
  は保存される。帯は Key 済みでも消えない（#983 の説は反証済み）。

### 判定の契約

- オーバーレイは 5 秒ごとに自分の存在をサーバに知らせる
  （`src/components/OverlayBeacon.tsx` → `GET /api/overlay-beacon` → 204）。
  ページは WebSocket を使わず unix socket 経由で `/api/speech` 等を poll する
  だけなので（メインサーバを経由しない）、この beacon だけが「ページは生きて
  いる」という証拠になる。この beacon は DOM に何も描画しない。
- サーバは beacon を受け取った時刻を覚える（`createOverlayBeaconTracker`）。
  監視は 30 秒周期。
- 沈黙が閾値（既定 60 秒）を超えたら OBS を再起動する（systemd の
  `makamujo-obs.service`）。判断は純ポリシー
  `lib/domain/broadcasting/OverlayLivenessPolicy.ts`。
- 一度も beacon を届けていないページは**放置する**。OBS が無い / 配信して
  いない環境ではノイズになるため。beacon が来ていたのに沈黙した場合だけが
  対象。
- 回復のクールダウンは既定 10 分。beacon が再開したらクールダウンは解除される
  （故障が終わるので、次の故障ではすぐ動く）。
- 状態は `var/overlay-liveness-state.json` に残す
  （`lib/application/overlayLivenessStateStore.ts`、原子書換え。壊れたファイル
  は新規扱い）。サーバーは cron で 11 分ごとに殺されるので、前プロセスの
  beacon を引き継ぐ。ただし**引き継いだ beacon は、プロセスが閾値（既定 60
  秒）以上動いた後**にしか「死んだページ」の証拠として使わない。直後に使うと
  cron での再起動のたびに OBS を再起動してしまう（ページが最初の beacon を
  送る前に判定が走ってしまう）。
- tick は例外を外へ漏らさない。回復の失敗も握って次の周期へ進む
  （漏らすと以降の周期が静かに止まり、回復の機会が失われる）。

### 起動順とメモリの修正

- `etc/systemd/makamujo-obs.service` の `MemoryHigh=32M` / `MemoryMax=256M`
  は、OBS 本体 + x264 + **CEF の browser source subprocess**
  （`KillMode=control-group` で同じ cgroup に入る）を収めるには狭かった。
  browser unit と同じ 1G / 1.5G へ緩めた。メモリ圧で殺されるのは
  同じ cgroup に入る CEF の renderer である。
- browser source は配信サーバ（`makamujo-screen.service`）のページを読むので、
  OBS の起動を `After=makamujo-screen.service` にした（画面が無いとページが
  読めず、browser source は真っ黒のまま）。Xvfb / screen とは `Wants=` で
  繋ぐ（`Requires=` だと明示的な restart が下流に伝播して、watchdog 自身の
  再起動に巻き込まれる）。

### モジュールと配線

| モジュール | 層 | 役割 |
|------------|----|------|
| `lib/domain/broadcasting/OverlayLivenessPolicy.ts` | domain（純関数） | 沈黙の観測 → 回復の決定 |
| `composition/overlayLivenessMonitor.ts` | composition | beacon の記録、監視の周期、systemd 回復の実行口 |
| `lib/application/overlayLivenessStateStore.ts` | application | ポリシー状態の `var/` への永続化（壊れたファイルは新規扱い） |
| `src/components/OverlayBeacon.tsx` | 配信ページ | 5 秒ごとに自分の存在を知らせる beacon |

`index.ts` が `/api/overlay-beacon` の route と監視の起動を 1 回だけ配線する。
回復口は `NODE_ENV=production` のときだけ systemd に触り、それ以外は dry run
（ログだけ）にする。停止回復の watchdog と同じ `createSystemdRecovery` を
使い、dry run / 本番の扱いとログの出し方を揃える。

### 環境変数

| 変数 | 既定 | 意味 |
|------|------|------|
| `OVERLAY_LIVENESS_CHECK_INTERVAL_MS` | `30000` | 監視の周期 |
| `OVERLAY_LIVENESS_SILENCE_THRESHOLD_MS` | `60000` | 沈黙を「死んだページ」とみなすまでの時間 |
| `OVERLAY_LIVENESS_RECOVERY_COOLDOWN_MS` | `600000` | 二つの回復の最短間隔 |

## 実装マップ

| 領域 | パス | 状態 |
|------|------|------|
| NGram / Silence / Topic / Scripts | `lib/domain/*` | 済 |
| 統計のページ読み取り | `lib/domain/broadcasting/watchPageStatistics.ts` | 済 |
| Publication assemble | `lib/domain/publication/` | 済 |
| AgentSession + services | `lib/application/` | 済 |
| 統計のブラウザ読み取り | `composition/watchPageBrowser.ts`, `composition/chromiumWatchPageBrowser.ts`, `composition/watchPageStatisticsSource.ts` | 済 |
| 配信画面の停止回復 | `lib/domain/broadcasting/CompositeFreezePolicy.ts`, `composition/broadcastFreezeWatchdog.ts` | 済 |
| オーバーレイの生存検知 | `lib/domain/broadcasting/OverlayLivenessPolicy.ts`, `composition/overlayLivenessMonitor.ts`, `src/components/OverlayBeacon.tsx` | 済 |
| Console access / status plan / SSE frames | `lib/domain/console/` | 済（Basic auth 純関数含む） |
| systemd / make install（main から port） | `Makefile`, `etc/systemd/` | 済 |
| Outer console WS bridge | `composition/consoleOuterWebSocket.ts` | 済 |
| Console UI | `console/src/AgentStatus/` | ファサード維持 |

## 関連

- プロジェクト指示: [`AGENTS.md`](../AGENTS.md)
- 中核実装: [`lib/Agent/index.ts`](../lib/Agent/index.ts)、[`lib/streamState.ts`](../lib/streamState.ts)、[`index.ts`](../index.ts)
