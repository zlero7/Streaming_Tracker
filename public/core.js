/**
 * 방송 체크 공용 코어
 * - 치지직 / SOOP 상태 조회 로직과 "등록 목록 서비스"를 한 곳에 모았다.
 * - Node.js 서버(server.js)와 브라우저/모바일 앱(public/backend.js)에서 똑같이 쓴다.
 * - 저장 방식은 storage 어댑터({ read(), write(list) })로 주입한다.
 *
 * 치지직·SOOP 모두 공식 공개 API가 아니라 웹사이트가 쓰는 API라서,
 * 응답 형식이 바뀌면 아래 providers 부분만 고치면 된다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StreamerCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  const CACHE_TTL_MS = 15000; // 같은 스트리머를 15초 안에 다시 조회하면 캐시 사용
  const ERROR_CACHE_TTL_MS = 5000;
  const REQUEST_TIMEOUT_MS = 8000;

  class HttpError extends Error {
    constructor(status, message, extra) {
      super(message);
      this.status = status;
      this.data = Object.assign({ error: message }, extra || {});
    }
  }

  async function fetchJson(url, options) {
    options = options || {};
    let res;
    try {
      res = await fetch(url, {
        ...options,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(options.headers || {}) },
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined,
      });
    } catch (err) {
      throw new HttpError(502, '네트워크에 연결할 수 없어요');
    }
    if (res.status === 404) throw new HttpError(404, '채널을 찾을 수 없어요');
    if (!res.ok) throw new HttpError(502, '상대 서버 응답 오류 (' + res.status + ')');
    try {
      return await res.json();
    } catch (err) {
      throw new HttpError(502, '상대 서버 응답을 읽을 수 없어요');
    }
  }

  function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function absoluteUrl(value) {
    if (!value || typeof value !== 'string') return null;
    return value.startsWith('//') ? 'https:' + value : value;
  }

  /* ------------------------------------------------------------------------ */
  /* Providers                                                                 */
  /* parseInput(text) → id | null, status(id) → 정규화된 상태                     */
  /* status 반환값: { name, profileImage, live, title, viewers, thumbnail, url }  */
  /* ------------------------------------------------------------------------ */

  const CHZZK_ID_PATTERN = /[0-9a-f]{32}/i;

  const chzzk = {
    label: '치지직',
    channelUrl: (id) => 'https://chzzk.naver.com/' + id,

    parseInput(text) {
      const match = text.match(CHZZK_ID_PATTERN);
      return match ? match[0].toLowerCase() : null;
    },

    async status(id) {
      const json = await fetchJson('https://api.chzzk.naver.com/service/v3/channels/' + id + '/live-detail');
      const content = json && json.content;
      if (!content) throw new HttpError(404, '채널을 찾을 수 없어요');

      let channel = content.channel || {};
      if (!channel.channelName) {
        // live-detail에 채널 정보가 없으면 채널 API로 보충
        const info = await fetchJson('https://api.chzzk.naver.com/service/v1/channels/' + id);
        channel = (info && info.content) || {};
      }

      const live = content.status === 'OPEN';
      return {
        name: channel.channelName || null,
        profileImage: channel.channelImageUrl || null,
        live,
        title: live ? content.liveTitle || null : null,
        viewers: live ? toNumber(content.concurrentUserCount) : null,
        // 치지직 썸네일 URL에는 {type} 자리표시자가 있다 (480 = 480p 이미지)
        thumbnail: live && content.liveImageUrl ? content.liveImageUrl.replace('{type}', '480') : null,
        url: live ? 'https://chzzk.naver.com/live/' + id : chzzk.channelUrl(id),
      };
    },

    async search(keyword) {
      const url = 'https://api.chzzk.naver.com/service/v1/search/channels?keyword=' + encodeURIComponent(keyword) + '&size=8';
      const json = await fetchJson(url);
      const rows = (json && json.content && json.content.data) || [];
      return rows
        .map((row) => row.channel || row)
        .filter((ch) => ch && ch.channelId)
        .map((ch) => ({
          id: ch.channelId,
          name: ch.channelName,
          profileImage: ch.channelImageUrl || null,
          verified: Boolean(ch.verifiedMark),
        }));
    },
  };

  const SOOP_ID_PATTERN = /^[a-z0-9_]{2,30}$/;

  const soop = {
    label: 'SOOP',
    channelUrl: (id) => 'https://ch.sooplive.co.kr/' + id,

    parseInput(text) {
      let candidate = text.trim();
      try {
        const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : 'https://' + candidate);
        if (/(sooplive\.co\.kr|afreecatv\.com)$/i.test(url.hostname)) {
          // ch.sooplive.co.kr/아이디, play.sooplive.co.kr/아이디/방송번호 등
          candidate = url.pathname.split('/').filter(Boolean)[0] || '';
        }
      } catch (err) {
        // URL이 아니면 아이디로 간주
      }
      candidate = candidate.toLowerCase();
      return SOOP_ID_PATTERN.test(candidate) ? candidate : null;
    },

    async status(id) {
      let data;
      try {
        data = await fetchJson('https://chapi.sooplive.co.kr/api/' + encodeURIComponent(id) + '/station', {
          headers: { Referer: 'https://ch.sooplive.co.kr/' },
        });
      } catch (err) {
        if (err.status === 404) throw err;
        return soopFallbackStatus(id); // 스테이션 API가 막히면 플레이어 API로 대체
      }

      const station = (data && data.station) || {};
      const name = station.user_nick || station.user_id || null;
      if (!name) throw new HttpError(404, '채널을 찾을 수 없어요');

      const broad = data.broad && data.broad.broad_no ? data.broad : null;
      return {
        name,
        profileImage: absoluteUrl(data.profile_image),
        live: Boolean(broad),
        title: broad ? broad.broad_title || broad.title || null : null,
        viewers: broad ? toNumber(broad.current_sum_viewer) : null,
        thumbnail: broad ? 'https://liveimg.sooplive.co.kr/m/' + broad.broad_no : null,
        url: broad ? 'https://play.sooplive.co.kr/' + id + '/' + broad.broad_no : soop.channelUrl(id),
        locked: broad ? Boolean(broad.is_password) : false,
      };
    },
  };

  // 시청자 수 없이 방송 여부/제목만 알 수 있는 대체 경로
  async function soopFallbackStatus(id) {
    const body = new URLSearchParams({
      bid: id,
      type: 'live',
      pwd: '',
      player_type: 'html5',
      stream_type: 'common',
      quality: 'HD',
      mode: 'landing',
      from_api: '0',
    }).toString();
    const json = await fetchJson('https://live.sooplive.co.kr/afreeca/player_live_api.php?bjid=' + encodeURIComponent(id), {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://play.sooplive.co.kr/' + id },
    });
    const channel = (json && json.CHANNEL) || {};
    const live = Number(channel.RESULT) === 1 && Boolean(channel.BNO);
    return {
      name: channel.BJNICK || null,
      profileImage: null,
      live,
      title: live ? channel.TITLE || null : null,
      viewers: null,
      thumbnail: live ? 'https://liveimg.sooplive.co.kr/m/' + channel.BNO : null,
      url: live ? 'https://play.sooplive.co.kr/' + id + '/' + channel.BNO : soop.channelUrl(id),
      locked: false,
    };
  }

  const providers = { chzzk, soop };

  /* ------------------------------------------------------------------------ */
  /* 서비스: 등록 목록 관리 + 상태 조회(캐시)                                       */
  /* storage: { read(): list | Promise<list>, write(list): void | Promise }     */
  /* ------------------------------------------------------------------------ */

  function createService(storage) {
    const cache = new Map(); // key → { expires, promise }
    let lock = Promise.resolve();

    // 읽기-수정-쓰기를 한 줄로 세워서 동시 요청에도 목록이 꼬이지 않게 한다
    function update(mutator) {
      const run = lock.then(async () => {
        const list = await storage.read();
        const result = await mutator(list);
        await storage.write(list);
        return result;
      });
      lock = run.catch(() => {});
      return run;
    }

    const keyOf = (item) => item.platform + ':' + item.id;

    async function buildStatus(item) {
      const provider = providers[item.platform];
      const base = {
        platform: item.platform,
        id: item.id,
        name: item.name,
        profileImage: item.profileImage || null,
        live: false,
        title: null,
        viewers: null,
        thumbnail: null,
        locked: false,
        url: provider.channelUrl(item.id),
      };
      try {
        const s = await provider.status(item.id);
        return {
          ...base,
          name: s.name || base.name,
          profileImage: s.profileImage || base.profileImage,
          live: s.live,
          title: s.title,
          viewers: s.viewers,
          thumbnail: s.thumbnail,
          locked: Boolean(s.locked),
          url: s.url || base.url,
        };
      } catch (err) {
        return { ...base, error: (err && err.message) || '조회에 실패했어요' };
      }
    }

    function getStatus(item) {
      const key = keyOf(item);
      const hit = cache.get(key);
      if (hit && hit.expires > Date.now()) return hit.promise;

      const promise = buildStatus(item);
      const entry = { expires: Date.now() + CACHE_TTL_MS, promise };
      cache.set(key, entry);
      promise.then((value) => {
        if (value.error) entry.expires = Date.now() + ERROR_CACHE_TTL_MS;
      });
      return promise;
    }

    async function list() {
      const items = await storage.read();
      return Promise.all(items.map(getStatus));
    }

    async function add(platform, input) {
      const provider = providers[platform];
      if (!provider) throw new HttpError(400, '지원하지 않는 플랫폼이에요');

      const text = String(input || '').trim();
      if (!text) throw new HttpError(400, '스트리머를 입력해주세요');

      const id = provider.parseInput(text);
      if (!id) {
        if (platform === 'chzzk') throw new HttpError(422, '닉네임으로 검색할게요', { needsSearch: true });
        throw new HttpError(400, 'SOOP 아이디나 채널 주소를 입력해주세요');
      }

      const exists = (items) => items.some((s) => s.platform === platform && s.id === id);
      if (exists(await storage.read())) throw new HttpError(409, '이미 등록된 스트리머예요');

      // 실제로 존재하는 채널인지 확인하면서 이름/프로필도 함께 저장한다
      const info = await provider.status(id);
      const item = {
        platform,
        id,
        name: info.name || id,
        profileImage: info.profileImage || null,
        addedAt: new Date().toISOString(),
      };

      await update((items) => {
        if (exists(items)) throw new HttpError(409, '이미 등록된 스트리머예요');
        items.push(item);
      });

      cache.delete(keyOf(item));
      return getStatus(item);
    }

    async function remove(platform, id) {
      await update((items) => {
        const index = items.findIndex((s) => s.platform === platform && s.id === id);
        if (index === -1) throw new HttpError(404, '등록되지 않은 스트리머예요');
        items.splice(index, 1);
      });
      cache.delete(platform + ':' + id);
    }

    async function search(keyword) {
      const q = String(keyword || '').trim();
      if (!q) throw new HttpError(400, '검색어를 입력해주세요');
      return chzzk.search(q.slice(0, 50));
    }

    return { list, add, remove, search };
  }

  return { HttpError, providers, createService };
});
