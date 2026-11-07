const TOUR_STORAGE_PREFIX = 'freetime_cloud_tour_v1_';
const ONBOARD_TIP_PREFIX = 'freetime_onboard_cloud_v1_';

let activeSteps = [];
let activeIndex = 0;
let activeUserId = '';
let isTourOpen = false;
let boundOnce = false;

export function hasSeenCloudTour(userId) {
  if (!userId) return false;
  return localStorage.getItem(`${TOUR_STORAGE_PREFIX}${userId}`) === '1';
}

export function markCloudTourSeen(userId) {
  if (!userId) return;
  localStorage.setItem(`${TOUR_STORAGE_PREFIX}${userId}`, '1');
}

export function syncOnboardingCloudTip(userId) {
  const tipEl = document.getElementById('onboardingCloudTip');
  if (!tipEl) return;
  const dismissed = userId && localStorage.getItem(`${ONBOARD_TIP_PREFIX}${userId}`) === '1';
  tipEl.classList.toggle('hidden', Boolean(dismissed));
}

export function dismissOnboardingCloudTip(userId) {
  const tipEl = document.getElementById('onboardingCloudTip');
  if (tipEl) tipEl.classList.add('hidden');
  if (userId) {
    localStorage.setItem(`${ONBOARD_TIP_PREFIX}${userId}`, '1');
  }
}

function buildSteps() {
  return [
    {
      getTarget: () => document.getElementById('calendarTableWrapper'),
      maxSpotHeight: 175,
      title: 'Chấm chọn giờ bận',
      text: 'Bấm vào từng ô giờ bạn BẬN. Ô màu xanh lá là lúc cả nhóm cùng rảnh!'
    },
    {
      getTarget: () => document.querySelector('.register-toolbar .segmented'),
      maxSpotHeight: 64,
      title: 'Đổi thao tác nhanh',
      text: 'Chọn "Xóa" để hủy giờ bận, hoặc "Chi tiết" để xem ai đang rảnh.'
    },
    {
      getTarget: () => document.getElementById('btnCopyRoomLink'),
      maxSpotHeight: 56,
      title: 'Mời bạn bè vào nhóm',
      text: 'Bấm vào đây để lấy Mã nhóm hoặc gửi link mời qua Zalo, Messenger.'
    },
    {
      getTarget: () =>
        window.innerWidth <= 960
          ? document.getElementById('btnTabChat')
          : document.getElementById('chatSectionCard'),
      maxSpotHeight: 210,
      title: 'Nhắn tin & chốt lịch',
      text: 'Trò chuyện chung với cả nhóm và bình chọn giờ hẹn ngay tại đây!'
    }
  ];
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function renderActiveStep() {
  if (!isTourOpen) return;
  const layer = document.getElementById('cloudTourLayer');
  const spotlight = document.getElementById('cloudTourSpotlight');
  const bubble = document.getElementById('cloudTourBubble');
  const stepLabel = document.getElementById('cloudTourStepLabel');
  const titleEl = document.getElementById('cloudTourTitle');
  const textEl = document.getElementById('cloudTourText');
  const dotsEl = document.getElementById('cloudTourDots');
  const nextBtn = document.getElementById('btnCloudTourNext');

  if (!layer || !spotlight || !bubble) return;

  const step = activeSteps[activeIndex];
  if (!step) {
    stopCloudTour({ markSeen: true });
    return;
  }

  stepLabel.textContent = `Bước ${activeIndex + 1}/${activeSteps.length}`;
  titleEl.textContent = step.title;
  textEl.textContent = step.text;
  nextBtn.textContent =
    activeIndex === activeSteps.length - 1 ? 'Xong rồi! ✨' : 'Tiếp theo →';

  dotsEl.innerHTML = activeSteps
    .map((_, idx) => `<span class="cloud-dot ${idx === activeIndex ? 'active' : ''}"></span>`)
    .join('');

  layer.classList.remove('hidden');

  const target = step.getTarget ? step.getTarget() : null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (!target) {
    spotlight.style.left = `${vw / 2}px`;
    spotlight.style.top = `${vh / 2}px`;
    spotlight.style.width = '0px';
    spotlight.style.height = '0px';
    bubble.dataset.arrow = 'none';
    const bw = bubble.offsetWidth || 300;
    const bh = bubble.offsetHeight || 160;
    bubble.style.left = `${Math.round((vw - bw) / 2)}px`;
    bubble.style.top = `${Math.round((vh - bh) / 2)}px`;
    return;
  }

  const rect = target.getBoundingClientRect();
  const pad = 6;
  const spotLeft = clamp(rect.left - pad, 6, vw - 12);
  const spotTop = clamp(rect.top - pad, 6, vh - 12);
  const spotWidth = clamp(rect.width + pad * 2, 24, vw - spotLeft - 6);
  const maxH = step.maxSpotHeight || rect.height;
  const spotHeight = clamp(Math.min(rect.height, maxH) + pad * 2, 24, vh - spotTop - 6);

  spotlight.style.left = `${Math.round(spotLeft)}px`;
  spotlight.style.top = `${Math.round(spotTop)}px`;
  spotlight.style.width = `${Math.round(spotWidth)}px`;
  spotlight.style.height = `${Math.round(spotHeight)}px`;

  const bw = bubble.offsetWidth || Math.min(306, vw - 24);
  const bh = bubble.offsetHeight || 165;
  const spotCenterX = spotLeft + spotWidth / 2;
  const spotBottom = spotTop + spotHeight;

  const bubbleLeft = clamp(Math.round(spotCenterX - bw / 2), 12, Math.max(12, vw - bw - 12));
  const arrowX = clamp(Math.round(spotCenterX - bubbleLeft), 26, bw - 26);
  bubble.style.setProperty('--arrow-x', `${arrowX}px`);

  const gap = 14;
  let bubbleTop;
  if (vh - spotBottom >= bh + gap + 12) {
    bubbleTop = spotBottom + gap;
    bubble.dataset.arrow = 'top';
  } else if (spotTop >= bh + gap + 12) {
    bubbleTop = spotTop - bh - gap;
    bubble.dataset.arrow = 'bottom';
  } else {
    bubbleTop = clamp(vh - bh - 16, 12, vh - bh - 12);
    bubble.dataset.arrow = 'none';
  }

  bubble.style.left = `${bubbleLeft}px`;
  bubble.style.top = `${Math.round(bubbleTop)}px`;
}

export function stopCloudTour({ markSeen = true } = {}) {
  isTourOpen = false;
  const layer = document.getElementById('cloudTourLayer');
  if (layer) layer.classList.add('hidden');
  if (markSeen && activeUserId) {
    markCloudTourSeen(activeUserId);
  }
}

export function startCloudTour({ userId = '', force = false, onBeforeStart } = {}) {
  if (document.body.dataset.appStage !== 'workspace') return false;
  if (!force && userId && hasSeenCloudTour(userId)) return false;

  if (onBeforeStart) onBeforeStart();

  activeUserId = userId;
  activeSteps = buildSteps();
  activeIndex = 0;
  isTourOpen = true;
  renderActiveStep();
  return true;
}

export function initCloudTourEvents() {
  if (boundOnce) return;
  boundOnce = true;

  const nextBtn = document.getElementById('btnCloudTourNext');
  const skipBtn = document.getElementById('btnCloudTourSkip');
  const backdrop = document.getElementById('cloudTourBackdrop');

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (!isTourOpen) return;
      if (activeIndex < activeSteps.length - 1) {
        activeIndex += 1;
        renderActiveStep();
      } else {
        stopCloudTour({ markSeen: true });
      }
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener('click', () => stopCloudTour({ markSeen: true }));
  }

  if (backdrop) {
    backdrop.addEventListener('click', () => stopCloudTour({ markSeen: true }));
  }

  window.addEventListener('resize', () => {
    if (isTourOpen) {
      requestAnimationFrame(renderActiveStep);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (!isTourOpen) return;
    if (e.key === 'Escape') {
      stopCloudTour({ markSeen: true });
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      if (activeIndex < activeSteps.length - 1) {
        activeIndex += 1;
        renderActiveStep();
      } else {
        stopCloudTour({ markSeen: true });
      }
    }
  });
}
