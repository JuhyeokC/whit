const MSG = {
  START_SELECTION: 'WHIT_START_SELECTION',
  CANCEL_SELECTION: 'WHIT_CANCEL_SELECTION',
  FINISH_SELECTION: 'WHIT_FINISH_SELECTION',
  CAPTURE_REQUEST: 'WHIT_CAPTURE_REQUEST',
  CAPTURE_RESPONSE: 'WHIT_CAPTURE_RESPONSE',
  SET_LATEST_IMAGE: 'WHIT_SET_LATEST_IMAGE',
  GET_LATEST_IMAGE: 'WHIT_GET_LATEST_IMAGE',
  SAVE_HISTORY_ITEM: 'WHIT_SAVE_HISTORY_ITEM',
  GET_HISTORY: 'WHIT_GET_HISTORY',
  ANALYZE_REQUEST: 'WHIT_ANALYZE_REQUEST',
  ANALYZE_RESPONSE: 'WHIT_ANALYZE_RESPONSE',
  DELETE_HISTORY_ITEM: 'WHIT_DELETE_HISTORY_ITEM',
  CLEAR_HISTORY: 'WHIT_CLEAR_HISTORY',
};

// 캐시 관리
const CACHE_BUCKET_KEY = 'WHIT_ANALYSIS_CACHE';
const CACHE_MAX = 120; // 캐시 최대 보관 개수 (톤/이미지 조합 기준)

// SHA-256 해시 함수 (hex 문자열 반환)
async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  const bytes = Array.from(new Uint8Array(hash));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 캐시 로드
async function loadCache() {
  const { [CACHE_BUCKET_KEY]: cache = {} } = await chrome.storage.local.get(
    CACHE_BUCKET_KEY
  );
  return cache;
}

// 캐시 저장 (용량 관리 포함)
async function saveCache(cache) {
  // 용량 관리: 오래된 것부터 제거 (createdAt 오름차순 정렬 후 초과분 drop)
  const entries = Object.entries(cache);
  if (entries.length > CACHE_MAX) {
    entries.sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
    const drop = entries.length - CACHE_MAX;
    for (let i = 0; i < drop; i++) delete cache[entries[i][0]];
  }
  await chrome.storage.local.set({ [CACHE_BUCKET_KEY]: cache });
}

// 메시지 수신 처리
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      // 이미지 캡처 요청
      case MSG.CAPTURE_REQUEST: {
        try {
          const dataUrl = await chrome.tabs.captureVisibleTab(
            sender.tab.windowId,
            { format: 'png' }
          );
          sendResponse({ ok: true, dataUrl });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
        break;
      }

      // 최신 이미지 저장
      case MSG.SET_LATEST_IMAGE: {
        await chrome.storage.local.set({ WHIT_LATEST: message.payload });
        sendResponse({ ok: true });
        break;
      }

      // 최신 이미지 불러오기
      case MSG.GET_LATEST_IMAGE: {
        const { WHIT_LATEST } = await chrome.storage.local.get('WHIT_LATEST');
        sendResponse({ ok: true, payload: WHIT_LATEST || null });
        break;
      }

      // 히스토리 아이템 저장
      case MSG.SAVE_HISTORY_ITEM: {
        const { item } = message;
        const { WHIT_HISTORY = [] } = await chrome.storage.local.get(
          'WHIT_HISTORY'
        );
        WHIT_HISTORY.unshift(item);
        await chrome.storage.local.set({ WHIT_HISTORY });
        sendResponse({ ok: true });
        break;
      }

      // 히스토리 불러오기
      case MSG.GET_HISTORY: {
        const { WHIT_HISTORY = [] } = await chrome.storage.local.get(
          'WHIT_HISTORY'
        );
        sendResponse({ ok: true, items: WHIT_HISTORY });
        break;
      }

      // 이미지 분석 요청
      case MSG.ANALYZE_REQUEST: {
        try {
          const { dataUrl, prompt = '', tone = 'simple' } = message;

          // 프록시 주소
          const PROXY_URL = 'https://whit-proxy.bos2ablues.workers.dev/analyze';

          // 모델
          const { WHIT_MODEL = 'gpt-4o-mini' } = await chrome.storage.local.get(
            ['WHIT_MODEL']
          );

          // --- 캐시 키 생성 (이미지+모델+톤 조합) ---
          const cacheKey = await sha256Hex(`${WHIT_MODEL}|${tone}|${dataUrl}`);
          const cache = await loadCache();
          const hit = cache[cacheKey];
          if (hit?.result) {
            sendResponse({
              ok: true,
              result: hit.result,
              cached: true,
              model: WHIT_MODEL,
              tone,
            });
            break;
          }

          // --- 프록시 호출 ---
          const r = await fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dataUrl,
              model: WHIT_MODEL,
              prompt:
                prompt ||
                '이 이미지를 분석해줘. 주요 객체/텍스트/브랜드/맥락을 bullet로 간결히 요약해.',
            }),
          });

          // 오류 처리
          if (!r.ok) {
            let text = '';
            try {
              text = await r.text();
              const maybe = JSON.parse(text);
              if (maybe && maybe.error) {
                sendResponse({
                  ok: false,
                  error:
                    maybe.code === 'insufficient_quota'
                      ? `OpenAI 한도(크레딧) 초과: ${maybe.error}`
                      : `Proxy error ${r.status}: ${maybe.error}`,
                });
                break;
              }
            } catch {}
            sendResponse({
              ok: false,
              error: `Proxy error: ${r.status} ${text}`,
            });
            break;
          }

          // 정상 응답 처리
          const json = await r.json(); // { ok:true, result: string }
          if (json?.ok && json?.result) {
            // --- 캐시에 저장 ---
            cache[cacheKey] = {
              result: json.result,
              createdAt: Date.now(),
              model: WHIT_MODEL,
              tone,
            };
            await saveCache(cache);
          }
          sendResponse({ ...json, cached: false, model: WHIT_MODEL, tone });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
        break;
      }

      // 히스토리 아이템 삭제
      case MSG.DELETE_HISTORY_ITEM: {
        const { id } = message;
        const { WHIT_HISTORY = [] } = await chrome.storage.local.get(
          'WHIT_HISTORY'
        );
        const next = WHIT_HISTORY.filter((it) => it.id !== id);
        await chrome.storage.local.set({ WHIT_HISTORY: next });
        sendResponse({ ok: true, removed: WHIT_HISTORY.length - next.length });
        break;
      }

      // 전체 히스토리 삭제
      case MSG.CLEAR_HISTORY: {
        await chrome.storage.local.set({ WHIT_HISTORY: [] });
        sendResponse({ ok: true });
        break;
      }

      // 알 수 없는 메시지
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })();

  return true; // async sendResponse
});
