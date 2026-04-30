#!/usr/bin/env bun
import http from 'http';

const port = process.env.PORT ? Number(process.env.PORT) : 8888;

const server = http.createServer((req, res) => {
  if (req.url === '/console/api/ws') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // Send a well-formed event first
    res.write('data: HELLO\n\n');
    // After a short delay write a partial event and abruptly destroy
    setTimeout(() => {
      try {
        res.write('data: PARTIAL'); // no terminating newline(s)
        // Abruptly close the socket to simulate an upstream truncation
        res.socket && (res.socket as any).destroy();
      } catch (e) {}
    }, 50);
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, () => {
  console.log('mock-upstream ready');
});
