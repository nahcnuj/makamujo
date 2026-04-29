const net = require('net');
const crypto = require('crypto');

const host = process.argv[2] || '127.0.0.1';
const port = parseInt(process.argv[3], 10) || 7777;
const path = process.argv[4] || '/console/api/ws';

const key = crypto.randomBytes(16).toString('base64');
const req = `GET ${path} HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://${host}\r\n\r\n`;

console.log('Sending handshake:\n', req);

const client = net.createConnection({ host, port }, () => {
  client.write(req);
});

client.on('data', (data) => {
  console.log('Received response:\n', data.toString());
  client.end();
});

client.on('error', (err) => {
  console.error('Connection error', err);
});

client.on('end', () => {
  console.log('Connection ended');
});
