// Messages
const MSG = {
  START_SELECTION: 'WHIT_START_SELECTION',
  GET_LATEST_IMAGE: 'WHIT_GET_LATEST_IMAGE',
  SAVE_HISTORY_ITEM: 'WHIT_SAVE_HISTORY_ITEM',
  GET_HISTORY: 'WHIT_GET_HISTORY',
  ANALYZE_REQUEST: 'WHIT_ANALYZE_REQUEST',
  DELETE_HISTORY_ITEM: 'WHIT_DELETE_HISTORY_ITEM',
  CLEAR_HISTORY: 'WHIT_CLEAR_HISTORY',
};

// Shortcuts
const $ = (sel) => document.querySelector(sel);

// Elements
const btnSelect = $('#btn-select');
const btnAnalyze = $('#btn-analyze');
const btnSave = $('#btn-save');
const preview = $('#preview');
const previewImg = $('#preview-img');
const historyList = $('#history-list');
const btnClearHistory = $('#btn-clear-history');
const analysisCard = $('#analysis-card');
const analysisThumb = $('#analysis-thumb');
const analysisContent = $('#analysis-content');
const modelSelect = $('#model');

// Tone
let currentTone = 'simple';
document.querySelectorAll('.tone').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    document
      .querySelectorAll('.tone')
      .forEach((x) => x.classList.remove('active'));
    e.target.classList.add('active');
    currentTone = e.target.dataset.tone;
  });
});

// Latest image payload
let latestImagePayload = null;

// Init
init().catch(console.error);

async function init() {
  wireTabs();

  btnSelect.addEventListener('click', onClickSelect);
  btnAnalyze.addEventListener('click', onClickAnalyze);
  btnSave.addEventListener('click', onClickSave);
  btnClearHistory?.addEventListener('click', onClickClearHistory);

  await hydrateSettingsUI();
  await loadLatest();
  await renderHistory();
}

// Tab wiring
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

// Settings UI 초기화
async function hydrateSettingsUI() {
  const { WHIT_MODEL = 'gpt-4o-mini' } = await chrome.storage.local.get([
    'WHIT_MODEL',
  ]);
  if (modelSelect) modelSelect.value = WHIT_MODEL;
  modelSelect?.addEventListener('change', async () => {
    await chrome.storage.local.set({ WHIT_MODEL: modelSelect.value });
  });
}

// 이미지 선택 시작
async function onClickSelect() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id)
    await chrome.tabs.sendMessage(tab.id, { type: MSG.START_SELECTION });
  window.close();
}

// 최신 이미지 불러오기
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

// 이미지 분석
async function onClickAnalyze() {
  if (!latestImagePayload?.imageDataUrl) return;

  // UI: 준비
  analysisCard.classList.remove('hidden');
  analysisThumb.src = latestImagePayload.imageDataUrl;
  analysisContent.innerHTML = `<div class="result-line"><span class="ico">⏳</span><div>분석 중...</div></div>`;

  // 톤 프롬프트
  const tonePrompts = {
    simple: '간결하고 요점만 bullet로 요약해줘. (브랜드/텍스트/색상/맥락 중심)',
    detail:
      '텍스트, 로고, 색상, 브랜드, 구성요소, 의미를 항목별로 자세히 설명해줘.',
    fun: '결과를 재미있고 가볍게, 하지만 핵심은 빠짐없이 bullet로 적어줘.',
  };
  const prompt = `이 이미지를 분석해줘. ${tonePrompts[currentTone]}`;

  // (선택) 이미지 경량화 – 대략 1280px로 리사이즈, JPEG 0.8
  const slim = await compressDataUrlToJpeg(
    latestImagePayload.imageDataUrl,
    1280,
    0.8
  );

  // 분석 요청
  const resp = await chrome.runtime.sendMessage({
    type: MSG.ANALYZE_REQUEST,
    dataUrl: slim,
    prompt,
    // ✅ 캐시 키에 포함될 톤 전달
    tone: currentTone,
  });

  // 결과 처리
  if (resp?.ok) {
    const html = renderAnalysisResult(resp.result);
    analysisContent.innerHTML = html;

    // ✅ 캐시 적중이 아니면 히스토리에 저장 (톤 정보 포함)
    if (!resp.cached) {
      await saveHistoryItem(latestImagePayload.imageDataUrl, resp.result, {
        model: resp.model,
        tone: resp.tone || currentTone,
      });
      await renderHistory();
    }
  } else {
    analysisContent.innerHTML = `<div class="result-line"><span class="ico">⚠️</span><div>${escapeHtml(
      resp?.error || '분석 실패'
    )}</div></div>`;
  }
}

// 이미지 저장
async function onClickSave() {
  if (!latestImagePayload?.imageDataUrl) return;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  await chrome.downloads.download({
    url: latestImagePayload.imageDataUrl,
    filename: `WHIT/whit-${ts}.png`,
    saveAs: true,
  });
}

// 전체 히스토리 삭제
async function onClickClearHistory() {
  const yes = confirm('모든 기록을 삭제할까요? (되돌릴 수 없음)');
  if (!yes) return;
  const resp = await chrome.runtime.sendMessage({ type: MSG.CLEAR_HISTORY });
  if (resp?.ok) await renderHistory();
  else alert('삭제 실패');
}

// 히스토리 항목 저장
async function saveHistoryItem(dataUrl, resultText = '', meta = {}) {
  const item = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    thumb: dataUrl,
    result: resultText,
    meta, // { model, tone } 등 저장
  };
  await chrome.runtime.sendMessage({ type: MSG.SAVE_HISTORY_ITEM, item });
}

// 히스토리 항목 삭제
async function deleteHistoryItem(id) {
  const resp = await chrome.runtime.sendMessage({
    type: MSG.DELETE_HISTORY_ITEM,
    id,
  });
  if (resp?.ok) await renderHistory();
  else alert('항목 삭제 실패');
}

// 히스토리 렌더링
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
    <div>${formatDate(dt)}${
      it.meta?.tone ? ` · 톤:${escapeHtml(it.meta.tone)}` : ''
    }${it.meta?.model ? ` · 모델:${escapeHtml(it.meta.model)}` : ''}</div>
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

// 분석 결과 렌더링
function renderAnalysisResult(resultText = '') {
  // 간단한 아이콘 매핑
  const mapping = {
    브랜드: '🏷️',
    텍스트: '✍️',
    배경색: '🎨',
    색상: '🌈',
    로고: '🔖',
    맥락: '🧭',
  };

  // 줄별 파싱 (기존 bullet 결과 가정)
  const lines = resultText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  // 단일 문장인 경우 전체를 하나의 라인으로 처리
  if (lines.length === 0) {
    return `<div class="result-line"><span class="ico">💬</span><div>${escapeHtml(
      resultText
    )}</div></div>`;
  }

  // 라인별로 아이콘 매핑하여 HTML 생성
  const html = lines
    .map((line) => {
      const key = Object.keys(mapping).find((k) => line.includes(k));
      const ico = key ? mapping[key] : '💬';
      return `<div class="result-line"><span class="ico">${ico}</span><div>${escapeHtml(
        line
      )}</div></div>`;
    })
    .join('');

  return html;
}

// PNG → JPEG 리사이즈/압축
async function compressDataUrlToJpeg(dataUrl, maxSize = 1280, quality = 0.8) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
  let { width, height } = img;
  const scale =
    Math.max(width, height) > maxSize ? maxSize / Math.max(width, height) : 1;
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

// 날짜 포맷팅
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

// HTML 이스케이프
function escapeHtml(str = '') {
  return str.replace(
    /[&<>"']/g,
    (s) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[
        s
      ])
  );
}
