/* Serves the app to phones and browsers on the same network, for trying the phone version before
   it is put on a web host. Open the address it prints on the phone. */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'};

/* A plain file server for the `app` folder. Resolves to the server once it is listening. */
export function serve(port = 8377, host = '0.0.0.0') {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname), file = path.normalize(path.join(root, rel));
    /* the bare address opens the app, at the address its files are found from */
    if (rel === '/') { res.writeHead(302, {Location: '/ui/index.html'}).end(); return; }
    if (!file.startsWith(root) || /\.cjs$/.test(file)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache'}).end(data);
    });
  });
  return new Promise(done => server.listen(port, host, () => done(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await serve(+process.argv[2] || 8377);
  const port = server.address().port;
  console.log('On this computer:  http://localhost:' + port + '/ui/index.html');
  for (const list of Object.values(os.networkInterfaces())) for (const a of list) if (a.family === 'IPv4' && !a.internal) console.log('On your phone:     http://' + a.address + ':' + port + '/ui/index.html');
}
