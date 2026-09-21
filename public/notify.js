'use strict';

/**
 * 방송 시작 알림 (Android 앱 전용)
 *
 * 앱 화면은 앱을 닫으면 멈춘다. 그래서 등록 목록을 백그라운드 러너(mobile/runner.js)에 넘겨두면,
 * Android가 약 15분마다 러너를 실행해 방송이 시작됐는지 확인하고 알림을 보낸다.
 * 웹/exe에서는 아무 일도 하지 않는다(supported = false).
 */
(function () {
  const LABEL = 'com.streamertracker.app.check';

  function findPlugin() {
    const cap = window.Capacitor;
    if (!cap) return null;
    if (cap.Plugins && cap.Plugins.BackgroundRunner) return cap.Plugins.BackgroundRunner;
    if (typeof cap.registerPlugin === 'function') return cap.registerPlugin('BackgroundRunner');
    return null;
  }

  const isNative = document.documentElement.classList.contains('native-app');
  const runner = isNative ? findPlugin() : null;
  let lastSignature = '';

  window.notifier = {
    supported: Boolean(runner),

    /** 'granted' | 'denied' | 'prompt' | 'unknown' */
    async permission() {
      if (!runner) return 'unknown';
      try {
        const result = await runner.checkPermissions();
        return result.notifications || 'unknown';
      } catch {
        return 'unknown';
      }
    },

    async request() {
      if (!runner) return 'unknown';
      try {
        const result = await runner.requestPermissions({ apis: ['notifications'] });
        return result.notifications || 'unknown';
      } catch {
        return 'unknown';
      }
    },

    /** 등록 목록과 화면에서 확인한 방송 상태를 러너에 넘긴다 (바뀐 게 있을 때만) */
    sync(streamers) {
      if (!runner) return;
      const list = streamers.map((s) => ({ platform: s.platform, id: s.id, name: s.name }));
      const live = {};
      for (const s of streamers) {
        if (!s.error) live[`${s.platform}:${s.id}`] = Boolean(s.live);
      }
      const signature = JSON.stringify([list, live]);
      if (signature === lastSignature) return;
      lastSignature = signature;
      runner
        .dispatchEvent({ label: LABEL, event: 'saveStreamers', details: { streamers: list, live } })
        .catch(() => {
          lastSignature = ''; // 실패하면 다음 갱신 때 다시 시도
        });
    },
  };
})();
