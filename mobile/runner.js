/**
 * 방송 시작 알림 - 백그라운드 러너 (Android 앱 전용)
 *
 * 이 파일은 앱 화면(WebView)과 별개의 가벼운 JS 환경(QuickJS)에서 실행돼요.
 * Android가 약 15분마다(배터리 상태에 따라 늦어질 수 있음) checkStreamers 이벤트로 불러줘요.
 * DOM, localStorage, URL 같은 웹 API는 없고, fetch / CapacitorKV / CapacitorNotifications만 써요.
 *
 * 저장하는 값 (CapacitorKV, 문자열만 가능)
 *   streamers  : [{ platform, id, name }]  화면이 saveStreamers 이벤트로 넘겨준 등록 목록
 *   liveState  : { "platform:id": true|false }  마지막으로 확인한 방송 상태
 *   notifiedAt : { "platform:id": 시각(ms) }  마지막으로 알림을 보낸 시각
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 8000;
const RENOTIFY_COOLDOWN_MS = 30 * 60 * 1000; // 방송이 잠깐 끊겼다 이어져도 30분 안에는 또 알리지 않는다
const PLATFORM_LABELS = { chzzk: '치지직', soop: 'SOOP' };

/* ---------- KV 도우미 ---------- */

function readJson(key, fallback) {
  try {
    const result = CapacitorKV.get(key);
    const raw = result && result.value;
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
}

function writeJson(key, value) {
  CapacitorKV.set(key, JSON.stringify(value));
}

const keyOf = (streamer) => streamer.platform + ':' + streamer.id;

/* ---------- 조회 (public/core.js 와 같은 주소를 쓰되 필요한 것만) ---------- */

function withTimeout(promise) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), REQUEST_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function getJson(url, options) {
  const res = await withTimeout(fetch(url, options));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function checkChzzk(id) {
  const json = await getJson('https://api.chzzk.naver.com/service/v3/channels/' + id + '/live-detail', {
    headers: { 'User-Agent': USER_AGENT },
  });
  const content = json && json.content;
  if (!content) throw new Error('no content');
  return {
    live: content.status === 'OPEN',
    title: content.liveTitle || '',
    name: (content.channel && content.channel.channelName) || '',
  };
}

async function checkSoopFallback(id) {
  const body =
    'bid=' + encodeURIComponent(id) + '&type=live&pwd=&player_type=html5&stream_type=common&quality=HD&mode=landing&from_api=0';
  const json = await getJson('https://live.sooplive.co.kr/afreeca/player_live_api.php?bjid=' + encodeURIComponent(id), {
    method: 'POST',
    body: body,
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: 'https://play.sooplive.co.kr/' + id,
    },
  });
  const channel = (json && json.CHANNEL) || {};
  return {
    live: Number(channel.RESULT) === 1 && Boolean(channel.BNO),
    title: channel.TITLE || '',
    name: channel.BJNICK || '',
  };
}

async function checkSoop(id) {
  let data;
  try {
    data = await getJson('https://chapi.sooplive.co.kr/api/' + encodeURIComponent(id) + '/station', {
      headers: { 'User-Agent': USER_AGENT, Referer: 'https://ch.sooplive.co.kr/' },
    });
  } catch (err) {
    return checkSoopFallback(id);
  }
  const broad = data && data.broad && data.broad.broad_no ? data.broad : null;
  return {
    live: Boolean(broad),
    title: broad ? broad.broad_title || broad.title || '' : '',
    name: (data && data.station && data.station.user_nick) || '',
  };
}

function check(streamer) {
  if (streamer.platform === 'chzzk') return checkChzzk(streamer.id);
  if (streamer.platform === 'soop') return checkSoop(streamer.id);
  return Promise.reject(new Error('unknown platform'));
}

/* ---------- 알림 ---------- */

function hashCode(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return hash;
}

function notifyLive(streamer, result) {
  const name = streamer.name || result.name || streamer.id;
  CapacitorNotifications.schedule([
    {
      id: hashCode(keyOf(streamer)), // 같은 스트리머는 알림이 하나로 합쳐진다
      title: name + ' 방송 시작',
      body: (result.title || '방송이 시작됐어요') + ' · ' + (PLATFORM_LABELS[streamer.platform] || ''),
      smallIcon: 'ic_stat_live',
      autoCancel: true,
    },
  ]);
}

/* ---------- 이벤트 ---------- */

// 앱 화면 → 러너: 등록 목록과 화면에서 이미 확인한 방송 상태를 저장
addEventListener('saveStreamers', (resolve, reject, args) => {
  try {
    const streamers = (args && args.streamers) || [];
    const seen = (args && args.live) || {};
    const previous = readJson('liveState', {});
    const next = {};

    for (const streamer of streamers) {
      const key = keyOf(streamer);
      // 화면에서 이미 본 방송 상태를 우선한다 → 이미 본 방송은 알림으로 다시 알리지 않는다
      if (key in seen) next[key] = Boolean(seen[key]);
      else if (key in previous) next[key] = previous[key];
    }

    writeJson('streamers', streamers);
    writeJson('liveState', next);
    resolve();
  } catch (err) {
    reject(err);
  }
});

// OS → 러너: 주기적으로 실행되어 방송 시작을 확인
addEventListener('checkStreamers', async (resolve, reject) => {
  try {
    const streamers = readJson('streamers', []);
    const liveState = readJson('liveState', {});
    const notifiedAt = readJson('notifiedAt', {});
    const now = Date.now();

    const results = await Promise.all(streamers.map((streamer) => check(streamer).catch(() => null)));

    streamers.forEach((streamer, index) => {
      const result = results[index];
      if (!result) return; // 확인에 실패하면 이전 상태를 그대로 둔다
      const key = keyOf(streamer);

      // 오프라인으로 알고 있던 스트리머가 방송 중으로 바뀐 순간에만 알린다
      const justStarted = result.live && liveState[key] === false;
      if (justStarted && !(notifiedAt[key] && now - notifiedAt[key] < RENOTIFY_COOLDOWN_MS)) {
        notifyLive(streamer, result);
        notifiedAt[key] = now;
      }
      liveState[key] = result.live;
    });

    writeJson('liveState', liveState);
    writeJson('notifiedAt', notifiedAt);
    resolve();
  } catch (err) {
    reject(err);
  }
});
