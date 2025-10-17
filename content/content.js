// content/content.js
(() => {
  // 싱글톤 가드: 중복 주입 방지 (Identifier '...' 에러 예방)
  if (window.__WHIT_CONTENT_LOADED__) return;
  window.__WHIT_CONTENT_LOADED__ = true;

  // 메시지 타입
  const MSG = {
    START_SELECTION: 'WHIT_START_SELECTION',
    CANCEL_SELECTION: 'WHIT_CANCEL_SELECTION',
    FINISH_SELECTION: 'WHIT_FINISH_SELECTION',
    CAPTURE_REQUEST: 'WHIT_CAPTURE_REQUEST',
    SET_LATEST_IMAGE: 'WHIT_SET_LATEST_IMAGE',
  };

  // ---- 영역 선택 UI 및 로직 ----
  let overlay,
    selectionBox,
    selecting = false;
  let startX = 0,
    startY = 0,
    currentX = 0,
    currentY = 0;

  // 오버레이 및 선택 박스 생성
  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'whit-overlay';
    selectionBox = document.createElement('div');
    selectionBox.className = 'whit-selection';
    overlay.appendChild(selectionBox);
    document.documentElement.appendChild(overlay);

    overlay.addEventListener('mousedown', onMouseDown, { passive: false });
    overlay.addEventListener('mousemove', onMouseMove, { passive: false });
    overlay.addEventListener('mouseup', onMouseUp, { passive: false });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') stopSelection(true);
    });
  }

  // 영역 선택 시작
  function startSelection() {
    ensureOverlay();
    overlay.style.display = 'block';
    selectionBox.style.display = 'none';
    selecting = false;
    overlay.tabIndex = -1; // ESC 가능
    overlay.focus({ preventScroll: true });
    document.body.style.cursor = 'crosshair';
  }

  // 영역 선택 종료
  function stopSelection(cancelled = false) {
    if (!overlay) return;
    overlay.style.display = 'none';
    selectionBox.style.display = 'none';
    document.body.style.cursor = '';
    selecting = false;
    if (cancelled) chrome.runtime.sendMessage({ type: MSG.CANCEL_SELECTION });
  }

  // 마우스 이벤트 핸들러
  function onMouseDown(e) {
    e.preventDefault();
    selecting = true;
    startX = e.clientX;
    startY = e.clientY;
    currentX = startX;
    currentY = startY;
    selectionBox.style.display = 'block';
    updateSelectionBox();
  }

  // 마우스 이동 처리
  function onMouseMove(e) {
    if (!selecting) return;
    currentX = e.clientX;
    currentY = e.clientY;
    updateSelectionBox();
  }

  // 마우스 업 처리
  function onMouseUp() {
    if (!selecting) return;
    selecting = false;
    const rect = getRect();

    // 사용자가 보는 선택 박스 즉시 숨김 (UX)
    if (selectionBox) selectionBox.style.display = 'none';

    // 너무 작은 영역은 취소 처리
    if (rect.width < 5 || rect.height < 5) {
      stopSelection(true);
      return;
    }

    // ① 오버레이 완전 제거 → ② 캡쳐 요청 → ③ 복원 → ④ 크롭/저장
    (async () => {
      const restore = await hideOverlayForCapture();
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: MSG.CAPTURE_REQUEST }, resolve);
      });
      if (restore) restore();

      if (!resp?.ok) {
        console.error('capture failed:', resp?.error);
        stopSelection(true);
        return;
      }
      try {
        const cropped = await cropDataUrl(resp.dataUrl, rect);
        await chrome.runtime.sendMessage({
          type: MSG.SET_LATEST_IMAGE,
          payload: { createdAt: Date.now(), rect, imageDataUrl: cropped },
        });
        chrome.runtime.sendMessage({ type: 'WHIT_FINISH_SELECTION' });
      } catch (err) {
        console.error(err);
      } finally {
        stopSelection(false);
      }
    })();
  }

  // 선택 영역 정보 계산
  function getRect() {
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const w = Math.abs(startX - currentX);
    const h = Math.abs(startY - currentY);
    return {
      x,
      y,
      width: w,
      height: h,
      viewportX: x,
      viewportY: y,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      dpr: window.devicePixelRatio || 1,
    };
  }

  // 선택 박스 스타일 업데이트
  function updateSelectionBox() {
    const rect = getRect();
    selectionBox.style.left = rect.x + 'px';
    selectionBox.style.top = rect.y + 'px';
    selectionBox.style.width = rect.width + 'px';
    selectionBox.style.height = rect.height + 'px';
  }

  // 데이터 URL 크롭
  async function cropDataUrl(fullDataUrl, rect) {
    // captureVisibleTab 은 DPR 적용된 "보이는 영역" 픽셀을 반환
    const img = await loadImage(fullDataUrl);
    const scale = rect.dpr;
    const sx = Math.round(rect.viewportX * scale);
    const sy = Math.round(rect.viewportY * scale);
    const sw = Math.round(rect.width * scale);
    const sh = Math.round(rect.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL('image/png');
  }

  // 데이터 URL → 이미지 객체 로드
  function loadImage(dataUrl) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = dataUrl;
    });
  }

  // ---- capture helpers ----
  function waitNextFrame() {
    return new Promise((r) => requestAnimationFrame(() => r()));
  }

  // 캡쳐 직전 오버레이를 DOM에서 분리했다가 복원 (페인트에서 100% 제외)
  async function hideOverlayForCapture() {
    if (!overlay) return () => {};
    const parent = overlay.parentNode;
    const next = overlay.nextSibling;
    const prevVisibility = overlay.style.visibility;
    const prevPointer = overlay.style.pointerEvents;
    const prevDisplay = overlay.style.display;

    // 즉시 화면에서 사라지게
    overlay.style.visibility = 'hidden';
    overlay.style.pointerEvents = 'none';
    overlay.style.display = 'none';

    // DOM 분리
    if (parent) parent.removeChild(overlay);

    // 페인트가 확실히 끝나도록 2~3프레임 대기
    await waitNextFrame();
    await waitNextFrame();
    await waitNextFrame();

    return () => {
      if (parent) {
        if (next) parent.insertBefore(overlay, next);
        else parent.appendChild(overlay);
      }
      overlay.style.visibility = prevVisibility || '';
      overlay.style.pointerEvents = prevPointer || '';
      overlay.style.display = prevDisplay || '';
    };
  }

  // 팝업에서 오는 “영역 선택” 신호 수신
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'WHIT_START_SELECTION') {
      startSelection();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
})();
