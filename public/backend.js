'use strict';

/**
 * 화면(app.js)이 쓰는 데이터 창구.
 * - 웹/exe: 같은 주소의 서버 API(/api)를 호출한다.
 * - 모바일 앱(Capacitor): 서버 없이 코어(core.js)를 앱 안에서 직접 실행하고,
 *   등록 목록은 localStorage에 저장한다. (Capacitor의 네이티브 HTTP가 CORS를 우회한다)
 */
(function () {
  const isNativeApp =
    Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) ||
    location.protocol === 'capacitor:' ||
    location.origin === 'https://localhost';

  async function api(path, options) {
    const res = await fetch(path, {
      ...(options || {}),
      headers: { 'Content-Type': 'application/json' },
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // 본문이 없는 응답
    }
    if (!res.ok) {
      const error = new Error((data && data.error) || `요청에 실패했어요 (${res.status})`);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  const serverBackend = {
    list: () => api('/api/streamers'),
    add: (platform, input) => api('/api/streamers', { method: 'POST', body: JSON.stringify({ platform, input }) }),
    remove: (platform, id) => api(`/api/streamers/${platform}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    search: (keyword) => api(`/api/search?q=${encodeURIComponent(keyword)}`),
  };

  function createLocalBackend() {
    const KEY = 'streamer-tracker:list';
    const service = window.StreamerCore.createService({
      read() {
        try {
          const list = JSON.parse(localStorage.getItem(KEY) || '[]');
          return Array.isArray(list) ? list : [];
        } catch {
          return [];
        }
      },
      write(list) {
        localStorage.setItem(KEY, JSON.stringify(list));
      },
    });
    return {
      list: () => service.list(),
      add: (platform, input) => service.add(platform, input),
      remove: (platform, id) => service.remove(platform, id),
      search: (keyword) => service.search(keyword),
    };
  }

  window.backend = isNativeApp ? createLocalBackend() : serverBackend;
  document.documentElement.classList.toggle('native-app', isNativeApp);
})();
