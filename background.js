// background.js (MV3, module)
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
  // ⬇️ 새로 추가
  DELETE_HISTORY_ITEM: 'WHIT_DELETE_HISTORY_ITEM',
  CLEAR_HISTORY: 'WHIT_CLEAR_HISTORY',
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
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

      case MSG.SET_LATEST_IMAGE: {
        await chrome.storage.local.set({ WHIT_LATEST: message.payload });
        sendResponse({ ok: true });
        break;
      }

      case MSG.GET_LATEST_IMAGE: {
        const { WHIT_LATEST } = await chrome.storage.local.get('WHIT_LATEST');
        sendResponse({ ok: true, payload: WHIT_LATEST || null });
        break;
      }

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

      case MSG.GET_HISTORY: {
        const { WHIT_HISTORY = [] } = await chrome.storage.local.get(
          'WHIT_HISTORY'
        );
        sendResponse({ ok: true, items: WHIT_HISTORY });
        break;
      }

      case MSG.ANALYZE_REQUEST: {
        const { dataUrl } = message;
        const analysis = `분석 데모: 이미지 길이 ${dataUrl?.length?.toLocaleString()} bytes`;
        sendResponse({ ok: true, result: analysis });
        break;
      }

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

      case MSG.CLEAR_HISTORY: {
        await chrome.storage.local.set({ WHIT_HISTORY: [] });
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })();

  return true; // async sendResponse
});
