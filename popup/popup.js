// popup/popup.js
const MSG = {
  START_SELECTION: 'WHIT_START_SELECTION',
  GET_LATEST_IMAGE: 'WHIT_GET_LATEST_IMAGE',
  SAVE_HISTORY_ITEM: 'WHIT_SAVE_HISTORY_ITEM',
  GET_HISTORY: 'WHIT_GET_HISTORY',
  ANALYZE_REQUEST: 'WHIT_ANALYZE_REQUEST',
  DELETE_HISTORY_ITEM: 'WHIT_DELETE_HISTORY_ITEM',
  CLEAR_HISTORY: 'WHIT_CLEAR_HISTORY',
};

const $ = (sel) => document.querySelector(sel);

const btnSelect = $('#btn-select');
const btnAnalyze = $('#btn-analyze');
const btnSave = $('#btn-save');
const preview = $('#preview');
const previewImg = $('#preview-img');
const analysisPre = $('#analysis');
const historyList = $('#history-list');
const btnClearHistory = $('#btn-clear-history');

let latestImagePayload = null;

init().catch(console.error);

async function init() {
  wireTabs();
  btnSelect.addEventListener('click', onClickSelect);
  btnAnalyze.addEventListener('click', onClickAnalyze);
  btnSave.addEventListener('click', onClickSave);

  if (btnClearHistory) {
    btnClearHistory.addEventListener('click', onClickClearHistory);
  }

  await loadLatest(); // 드래그 후 재오픈 시 미리보기 표시
  await renderHistory();
}

function wireTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach((b) => {
    b.addEventListener('click', () => {
      tabBtns.forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const target = b.dataset.tab;
      document
        .querySelectorAll('.tab')
        .forEach((t) => t.classList.remove('active'));
      $('#tab-' + target).classList.add('active');
    });
  });
}

async function onClickSelect() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    await chrome.tabs.sendMessage(tab.id, { type: MSG.START_SELECTION });
  }
  window.close();
}

async function loadLatest() {
  const resp = await chrome.runtime.sendMessage({ type: MSG.GET_LATEST_IMAGE });
  if (resp?.ok && resp.payload?.imageDataUrl) {
    latestImagePayload = resp.payload;
    previewImg.src = resp.payload.imageDataUrl;
    preview.classList.remove('hidden');
  } else {
    preview.classList.add('hidden');
    latestImagePayload = null;
  }
}

async function onClickAnalyze() {
  if (!latestImagePayload?.imageDataUrl) return;
  analysisPre.textContent = '분석 중...';
  const resp = await chrome.runtime.sendMessage({
    type: MSG.ANALYZE_REQUEST,
    dataUrl: latestImagePayload.imageDataUrl,
  });
  if (resp?.ok) {
    analysisPre.textContent = resp.result;
    await saveHistoryItem(latestImagePayload.imageDataUrl, resp.result);
    await renderHistory();
  } else {
    analysisPre.textContent = `분석 실패: ${resp?.error || 'unknown'}`;
  }
}

async function onClickSave() {
  if (!latestImagePayload?.imageDataUrl) return;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  await chrome.downloads.download({
    url: latestImagePayload.imageDataUrl,
    filename: `WHIT/whit-${ts}.png`,
    saveAs: true,
  });
}

async function onClickClearHistory() {
  const yes = confirm('모든 기록을 삭제할까요? (되돌릴 수 없음)');
  if (!yes) return;
  const resp = await chrome.runtime.sendMessage({ type: MSG.CLEAR_HISTORY });
  if (resp?.ok) {
    await renderHistory();
  } else {
    alert('삭제 실패');
  }
}

async function saveHistoryItem(dataUrl, resultText = '') {
  const item = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    thumb: dataUrl,
    result: resultText,
  };
  await chrome.runtime.sendMessage({ type: MSG.SAVE_HISTORY_ITEM, item });
}

async function deleteHistoryItem(id) {
  const resp = await chrome.runtime.sendMessage({
    type: MSG.DELETE_HISTORY_ITEM,
    id,
  });
  if (resp?.ok) {
    await renderHistory();
  } else {
    alert('항목 삭제 실패');
  }
}

async function renderHistory() {
  const resp = await chrome.runtime.sendMessage({ type: MSG.GET_HISTORY });
  if (!resp?.ok) return;
  const items = resp.items || [];
  historyList.innerHTML = '';

  if (items.length === 0) {
    historyList.innerHTML =
      '<div style="color:#6b7280; font-size:12px;">기록이 없습니다.</div>';
    return;
  }

  items.forEach((it) => {
    const el = document.createElement('div');
    el.className = 'history-item';
    const dt = new Date(it.createdAt);
    el.innerHTML = `
      <button class="del" data-id="${it.id}">삭제</button>
      <img src="${it.thumb}" alt="thumb"/>
      <div class="meta">
        <div>${formatDate(dt)}</div>
        <div style="margin-top:4px; color:#111827; font-weight:600; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">
          ${escapeHtml(it.result || '분석 결과 없음')}
        </div>
      </div>
    `;
    historyList.appendChild(el);

    const delBtn = el.querySelector('.del');
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = delBtn.getAttribute('data-id');
      deleteHistoryItem(id);
    });
  });
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function escapeHtml(str = '') {
  return str.replace(
    /[&<>"']/g,
    (s) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[
        s
      ])
  );
}
