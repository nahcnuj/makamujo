/**
 * 配信映像に常時流れる動きを足す鼓動。
 *
 * 映像全体が 1 秒以上まったく変わらないと、外からの配信異常検知
 * （`scripts/check-stream.ts` は改変しない: owner 契約 #807）は
 * `videoMinFps = 0` として停止とみなす。ゲームが結果画面やフリートークで
 * 静止している間は、コメントも発話も無いとオーバーレイまで静止し、合成出力は
 * 本当に全フレーム同一になる（2026-10-21 22:27 と 2026-10-22 の停止は音声と
 * media clock が進んだまま `videoMinFps` / `gameMinFps` が 0 だった）。動いていないのは
 * 合成経路の故障ではなく「絵が動かない」ことなので、常時動く線を 1 本だけ
 * 重ねて、配信が生きていることを映像でも示す。
 *
 * 帯は画面を横切る高さ 1vh・不透明度 0.2 の走査線にする。以前の全幅 12vh・
 * 0.6 秒の帯は配信映像に CRT の走査線として出すぎた（issue #1030 / #1197）。
 * 許容できるのは「ごくごく透明なテーマカラーで高さ 1vh 程度」までなので、
 * エメラルドを 2.0 秒で 0vh→99vh と流す。公開フレーム 30 枚すべてが検知側の
 * 差分しきい値を超え、1 秒バケットで 24 枚以上を保証する。動きは
 * `src/index.css` の `broadcast-heartbeat-sweep`（待ち無しの `infinite`）。
 * 止まる時間帯を作らないこと。境界と余裕は
 * `BroadcastHeartbeat.liveness.test.ts` が保証する。
 */
export function BroadcastHeartbeat() {
  return <div className="broadcast-heartbeat" aria-hidden="true" />;
}
