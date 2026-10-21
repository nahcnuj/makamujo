/**
 * 配信映像に常時流れる動きを足す鼓動。
 *
 * 映像全体が 1 秒以上まったく変わらないと、外からの配信異常検知
 * （`scripts/check-stream.ts` は改変しない: owner 契約 #807）は
 * `videoMinFps = 0` として停止とみなす。ゲームが結果画面やフリートークで
 * 静止している間は、コメントも発話も無いとオーバーレイまで静止し、合成出力は
 * 本当に全フレーム同一になる（2026-10-21 22:27 の停止は音声と media clock が
 * 進んだまま `videoMinFps` / `gameMinFps` が 0 だった）。動いていないのは
 * 合成経路の故障ではなく「絵が動かない」ことなので、常時動く帯を 1 本だけ
 * 重ねて、配信が生きていることを映像でも示す。
 *
 * 帯は全幅なので、ゲーム部分として切り出す画面の左 60% にも必ず掛かる。
 * 動きは `src/index.css` の `broadcast-heartbeat-sweep`（待ち無しの
 * `infinite`）。止まる時間帯を作らないこと。
 */
export function BroadcastHeartbeat() {
  return <div className="broadcast-heartbeat" aria-hidden="true" />;
}
