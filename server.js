'use strict';

/**
 * 방송 체크 서버
 * - 웹 UI(public/)를 서빙하고, 등록 목록/방송 상태 API를 제공한다.
 * - 조회 로직은 public/core.js(공용 코어)에 있다. 모바일 앱도 같은 코어를 쓴다.
 * - 외부 패키지 없이 Node.js 18+ 만으로 동작한다.
 * - Electron(exe)에서는 start()를 불러 내부 서버로 사용한다.
 */

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { HttpError, createService } = require('./public/core.js');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 10 * 1024;

/* 등록 목록 저장소 (DATA_DIR/streamers.json) */

function createFileStorage(dataDir) {
  const file = path.join(dataDir, 'streamers.json');
  return {
    async read() {
      try {
        const list = JSON.parse(await fs.readFile(file, 'utf8'));
        return Array.isArray(list) ? list : [];
      } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
      }
    },
    async write(list) {
      await fs.mkdir(dataDir, { recursive: true });
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
      await fs.rename(tmp, file);
    },
  };
}

/* HTTP 처리 */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req) {
  // 다른 사이트에서 몰래 요청을 보내는 것을 막기 위해 JSON Content-Type을 요구한다.
  // (브라우저는 이 경우 사전 요청(preflight)을 보내고, 이 서버는 CORS를 허용하지 않으므로 차단된다)
  if (!/^application\/json/i.test(req.headers['content-type'] || '')) {
    throw new HttpError(415, 'JSON 요청만 받을 수 있어요');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, '요청이 너무 커요');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, '잘못된 요청이에요');
  }
}

async function handleApi(service, req, res, url) {
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/api/streamers') {
    return sendJson(res, 200, await service.list());
  }

  if (req.method === 'POST' && pathname === '/api/streamers') {
    const body = await readJsonBody(req);
    return sendJson(res, 201, await service.add(body.platform, body.input));
  }

  const removeMatch = pathname.match(/^\/api\/streamers\/([a-z]+)\/([^/]+)$/);
  if (req.method === 'DELETE' && removeMatch) {
    await service.remove(removeMatch[1], decodeURIComponent(removeMatch[2]));
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/search') {
    return sendJson(res, 200, await service.search(url.searchParams.get('q')));
  }

  throw new HttpError(404, '존재하지 않는 API예요');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': [
    "default-src 'self'",
    'img-src https: data:',
    "style-src 'self' https://cdn.jsdelivr.net",
    'font-src https://cdn.jsdelivr.net',
    "script-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

async function serveStatic(res, pathname) {
  const relative = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(relative));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, '접근할 수 없어요');

  let file;
  try {
    file = await fs.readFile(filePath);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') throw new HttpError(404, '페이지를 찾을 수 없어요');
    throw err;
  }
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    ...SECURITY_HEADERS,
  });
  res.end(file);
}

/**
 * 서버를 시작한다.
 * @param {{host?: string, port?: number, dataDir?: string}} options  port: 0이면 빈 포트 자동 선택
 * @returns {Promise<http.Server>}
 */
function start(options = {}) {
  const host = options.host || process.env.HOST || '127.0.0.1'; // 로컬 전용. 외부 공개하려면 HOST=0.0.0.0
  const port = options.port ?? (Number(process.env.PORT) || 3000);
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data');
  const service = createService(createFileStorage(dataDir));

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) return await handleApi(service, req, res, url);

      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        throw new HttpError(400, '잘못된 주소예요');
      }
      return await serveStatic(res, pathname);
    } catch (err) {
      const known = err instanceof HttpError;
      if (!known) console.error(err);
      if (!res.headersSent) {
        sendJson(res, known ? err.status : 500, known ? err.data : { error: '서버에서 문제가 생겼어요' });
      } else {
        res.end();
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

module.exports = { start };

if (require.main === module) {
  start().then((server) => {
    const { address, port } = server.address();
    console.log(`방송 체크 실행 중: http://${address === '0.0.0.0' ? 'localhost' : address}:${port}`);
  });
}
