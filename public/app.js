'use strict';

const PLATFORMS = {
  chzzk: {
    label: '치지직',
    placeholder: '닉네임, 채널 주소, 또는 채널 ID',
    hint: '닉네임으로 검색하거나 chzzk.naver.com 채널 주소를 붙여넣으세요.',
  },
  soop: {
    label: 'SOOP',
    placeholder: '아이디 또는 채널 주소',
    hint: '스트리머 아이디나 ch.sooplive.co.kr 채널 주소를 입력하세요.',
  },
};

const REFRESH_INTERVAL_MS = 30_000;
const STALE_AFTER_MS = 15_000;

const state = {
  platform: 'chzzk',
  streamers: [],
  loading: false,
  lastUpdated: null,
};

const $ = (selector) => document.querySelector(selector);

/* ---------- 작은 DOM 헬퍼 (외부 문자열은 항상 textContent로 넣는다) ---------- */

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/* ---------- 표시용 유틸 ---------- */

function formatViewers(count) {
  if (count == null) return '시청자 -';
  if (count >= 10000) return `시청자 ${(count / 10000).toFixed(1).replace(/\.0$/, '')}만`;
  return `시청자 ${count.toLocaleString('ko-KR')}`;
}

function formatTime(date) {
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function avatar(streamer, extraClass) {
  const initial = (streamer.name || '?').trim().charAt(0).toUpperCase();
  const fallback = () => h('span', { class: `avatar avatar-fallback ${extraClass || ''}`, 'aria-hidden': 'true' }, initial);
  if (!streamer.profileImage) return fallback();
  const img = h('img', {
    class: `avatar ${extraClass || ''}`,
    src: streamer.profileImage,
    alt: '',
    loading: 'lazy',
    referrerpolicy: 'no-referrer',
  });
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}

function platformChip(platform) {
  return h('span', { class: `chip chip-${platform}` }, PLATFORMS[platform].label);
}

function externalLink(attrs, ...children) {
  return h('a', { target: '_blank', rel: 'noopener noreferrer', ...attrs }, ...children);
}

/* ---------- 렌더링 ---------- */

function thumbnail(streamer) {
  const box = h('div', { class: 'thumb' });
  const placeholder = () => h('div', { class: 'thumb-empty' }, '썸네일 없음');

  if (streamer.thumbnail) {
    const img = h('img', {
      src: streamer.thumbnail,
      alt: '',
      loading: 'lazy',
      referrerpolicy: 'no-referrer',
    });
    img.addEventListener('error', () => img.replaceWith(placeholder()), { once: true });
    box.append(img);
  } else {
    box.append(placeholder());
  }

  box.append(
    h('span', { class: 'badge-live' }, 'LIVE'),
    h('span', { class: 'badge-viewers' }, formatViewers(streamer.viewers)),
  );
  return box;
}

function removeButton(streamer) {
  return h(
    'button',
    {
      class: 'link-btn',
      type: 'button',
      'aria-label': `${streamer.name} 삭제`,
      onclick: () => removeStreamer(streamer),
    },
    '삭제',
  );
}

function liveCard(streamer) {
  const title = `${streamer.locked ? '🔒 ' : ''}${streamer.title || '(제목 없음)'}`;
  return h(
    'article',
    { class: 'live-card' },
    externalLink({ href: streamer.url, 'aria-label': `${streamer.name} 방송 보기` }, thumbnail(streamer)),
    externalLink({ class: 'live-title', href: streamer.url }, title),
    h(
      'div',
      { class: 'who' },
      avatar(streamer),
      h('span', { class: 'name' }, streamer.name),
      platformChip(streamer.platform),
      h('span', { class: 'spacer' }),
      removeButton(streamer),
    ),
  );
}

function offlineRow(streamer) {
  return h(
    'li',
    null,
    avatar(streamer),
    externalLink({ class: 'name', href: streamer.url }, streamer.name),
    platformChip(streamer.platform),
    h('span', { class: 'spacer' }),
    streamer.error
      ? h('span', { class: 'status-text error', title: streamer.error }, '조회 실패')
      : h('span', { class: 'status-text' }, '방송 종료'),
    removeButton(streamer),
  );
}

function render() {
  const live = state.streamers.filter((s) => s.live).sort((a, b) => (b.viewers ?? -1) - (a.viewers ?? -1));
  const offline = state.streamers.filter((s) => !s.live);

  $('#live-grid').replaceChildren(...live.map(liveCard));
  $('#offline-list').replaceChildren(...offline.map(offlineRow));
  $('#live-count').textContent = live.length;
  $('#offline-count').textContent = offline.length;

  $('#live-section').hidden = live.length === 0;
  $('#offline-section').hidden = offline.length === 0;
  $('#empty').hidden = state.streamers.length !== 0;

  document.title = live.length ? `(${live.length}) 방송 체크` : '방송 체크';
  $('#updated').textContent = state.lastUpdated ? `마지막 확인 ${formatTime(state.lastUpdated)}` : '';
}

/* ---------- 메시지 / 검색 결과 ---------- */

function setMessage(text, type) {
  const el = $('#message');
  el.textContent = text || '';
  el.classList.toggle('error', type === 'error');
}

function clearSearch() {
  const list = $('#search-results');
  list.hidden = true;
  list.replaceChildren();
}

function showSearchResults(results) {
  const list = $('#search-results');
  list.replaceChildren(
    ...results.map((result) =>
      h(
        'li',
        null,
        avatar(result),
        h(
          'span',
          { class: 'grow' },
          result.name,
          result.verified ? h('span', { class: 'verified' }, '인증됨') : null,
        ),
        h(
          'button',
          {
            class: 'btn btn-quiet btn-small',
            type: 'button',
            'aria-label': `${result.name} 추가`,
            onclick: (event) => addFromSearch(result, event.currentTarget),
          },
          '추가',
        ),
      ),
    ),
  );
  list.hidden = results.length === 0;
}

/* ---------- 데이터 로딩 / 변경 ---------- */

async function load() {
  if (state.loading) return;
  state.loading = true;
  $('#refresh').disabled = true;
  try {
    state.streamers = await backend.list();
    state.lastUpdated = new Date();
    $('#load-error').hidden = true;
  } catch (err) {
    $('#load-error').textContent = `목록을 불러오지 못했어요. ${err.message}`;
    $('#load-error').hidden = false;
  } finally {
    state.loading = false;
    $('#refresh').disabled = false;
    render();
  }
}

async function addStreamer(platform, input) {
  const streamer = await backend.add(platform, input);
  setMessage(`추가했어요: ${streamer.name}`);
  await load();
}

async function addFromSearch(result, button) {
  button.disabled = true;
  try {
    await addStreamer('chzzk', result.id);
    clearSearch();
    $('#add-input').value = '';
  } catch (err) {
    setMessage(err.message, 'error');
    button.disabled = false;
  }
}

async function runSearch(keyword) {
  const results = await backend.search(keyword);
  if (results.length === 0) {
    setMessage('검색 결과가 없어요. 채널 주소로 추가해보세요.', 'error');
    return;
  }
  setMessage('추가할 스트리머를 선택하세요.');
  showSearchResults(results);
}

async function removeStreamer(streamer) {
  if (!window.confirm(`${streamer.name}을(를) 목록에서 삭제할까요?`)) return;
  try {
    await backend.remove(streamer.platform, streamer.id);
    setMessage('');
    await load();
  } catch (err) {
    setMessage(err.message, 'error');
  }
}

/* ---------- 이벤트 ---------- */

function selectPlatform(platform) {
  state.platform = platform;
  for (const button of document.querySelectorAll('.seg button')) {
    button.setAttribute('aria-pressed', String(button.dataset.platform === platform));
  }
  $('#add-input').placeholder = PLATFORMS[platform].placeholder;
  $('#hint').textContent = PLATFORMS[platform].hint;
  setMessage('');
  clearSearch();
}

async function onSubmit(event) {
  event.preventDefault();
  const input = $('#add-input').value.trim();
  if (!input) return;

  $('#add-btn').disabled = true;
  setMessage('');
  clearSearch();
  try {
    await addStreamer(state.platform, input);
    $('#add-input').value = '';
  } catch (err) {
    if (err.status === 422 && err.data && err.data.needsSearch) {
      try {
        await runSearch(input);
      } catch (searchError) {
        setMessage(searchError.message, 'error');
      }
    } else {
      setMessage(err.message, 'error');
    }
  } finally {
    $('#add-btn').disabled = false;
  }
}

for (const button of document.querySelectorAll('.seg button')) {
  button.addEventListener('click', () => selectPlatform(button.dataset.platform));
}
$('#add-form').addEventListener('submit', onSubmit);
$('#refresh').addEventListener('click', load);

// 탭이 보일 때만 주기적으로 갱신한다
setInterval(() => {
  if (!document.hidden) load();
}, REFRESH_INTERVAL_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && (!state.lastUpdated || Date.now() - state.lastUpdated > STALE_AFTER_MS)) load();
});

selectPlatform('chzzk');
load();
