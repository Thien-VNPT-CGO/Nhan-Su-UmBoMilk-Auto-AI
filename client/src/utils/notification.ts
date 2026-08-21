/**
/** Dịch vụ Quản lý Thông báo Desktop HTML5, Sound Bell & Nhấp nháy Tab cho HR */

let titleFlashTimer: NodeJS.Timeout | null = null;
const originalTitle = typeof document !== 'undefined' ? document.title : 'UMBO MILK Recruitment';

/** Phát âm thanh chuông thông báo giòn giã (Web Audio API Synthesizer) */
export function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, now + 0.15);
    osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.35); // D6

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now + 0.15);
    osc1.stop(now + 0.45);
    osc2.stop(now + 0.45);
  } catch {
    /* ignore audio autoplay restrictions */
  }
}

/** Xin quyền thông báo Desktop từ trình duyệt */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  if (Notification.permission === 'default') {
    return await Notification.requestPermission();
  }
  return Notification.permission;
}

/** Bắn thông báo Desktop Web Push góc màn hình */
export function notifyDesktop(title: string, body: string, onClickUrl?: string) {
  playNotificationSound();
  flashTabTitle(title);

  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(title, {
        body,
        icon: '/favicon.ico',
        tag: 'umbo-recruitment-notification',
      });

      n.onclick = () => {
        window.focus();
        if (onClickUrl) {
          window.location.href = onClickUrl;
        }
        n.close();
      };
    } catch {
      /* ignore desktop notification errors */
    }
  }
}

/** Nhấp nháy tiêu đề Tab trình duyệt khi ở tab khác */
export function flashTabTitle(message: string) {
  if (typeof document === 'undefined') return;

  if (titleFlashTimer) {
    clearInterval(titleFlashTimer);
  }

  let state = false;
  titleFlashTimer = setInterval(() => {
    document.title = state ? `🔔 (1) ${message}` : originalTitle;
    state = !state;
  }, 1000);

  const stopFlash = () => {
    if (titleFlashTimer) {
      clearInterval(titleFlashTimer);
      titleFlashTimer = null;
    }
    document.title = originalTitle;
    window.removeEventListener('focus', stopFlash);
  };

  window.addEventListener('focus', stopFlash);
}
