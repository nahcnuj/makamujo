#!/usr/bin/env bun
const url = process.argv[2];
const token = process.argv[3];
if (!url) {
  console.error(
    "Usage: bun ./scripts/captureReliveWs.js <wss-url> [audienceToken]",
  );
  process.exit(1);
}
console.log(new Date().toISOString(), "connecting to", url);
const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";
ws.addEventListener("open", () => {
  console.log(new Date().toISOString(), "open");
  if (token) {
    // send an initial keepSeat and then periodically to keep connection alive
    const keep = () => {
      const msg = { type: "keepSeat", audienceToken: token };
      try {
        ws.send(JSON.stringify(msg));
        console.log(new Date().toISOString(), "sent keepSeat");
      } catch (e) {
        console.error("send error", e);
      }
    };
    keep();
    setInterval(keep, 15000);
  }
});
ws.addEventListener("message", (ev) => {
  const ts = new Date().toISOString();
  const data = ev.data;
  try {
    if (typeof data === "string") {
      try {
        const obj = JSON.parse(data);
        console.log(ts, "MSG", JSON.stringify(obj, null, 2));
      } catch {
        console.log(ts, "RAW", data.slice ? data.slice(0, 2000) : String(data));
      }
    } else if (data instanceof ArrayBuffer || ArrayBuffer.isView?.(data)) {
      const buf = data instanceof ArrayBuffer ? data : data.buffer;
      const text = new TextDecoder().decode(buf);
      try {
        const obj = JSON.parse(text);
        console.log(ts, "MSG(bin)", JSON.stringify(obj, null, 2));
      } catch {
        console.log(ts, "RAW(bin)", text.slice(0, 2000));
      }
    } else {
      console.log(ts, "UNKNOWN MESSAGE TYPE", typeof data);
    }
  } catch (e) {
    console.error(ts, "message handler error", e);
  }
});
ws.addEventListener("close", (ev) => {
  console.log(new Date().toISOString(), "CLOSE", ev.code, ev.reason || "");
});
ws.addEventListener("error", (ev) => {
  console.error(new Date().toISOString(), "ERROR", ev);
});
