import { useEffect, useState } from 'react';
import { Bell, BellOff, Check } from 'lucide-react';
import { getSocket } from '../api/socket';
import { notifyDesktop, requestNotificationPermission } from '../utils/notification';

export function NotificationManager() {
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    const socket = getSocket();

    const handleAiConfirmed = (data: { candidateName?: string; action?: string; newStatus?: string }) => {
      if (data?.action === 'CONFIRMED_ACCEPT') {
        notifyDesktop(
          `🎉 Ứng viên ${data.candidateName || 'UV'} đã XÁC NHẬN!`,
          `Ứng viên vừa bấm xác nhận phỏng vấn qua Zalo. Trạng thái: Sắp bắt đầu training.`,
          '/training'
        );
      } else if (data?.action === 'CONFIRMED_REJECT') {
        notifyDesktop(
          `❌ Ứng viên ${data.candidateName || 'UV'} từ chối phỏng vấn`,
          `Ứng viên đã báo bận / từ chối phỏng vấn trên Zalo.`,
          '/training'
        );
      }
    };

    const handleInterviewRemind = (data: { candidateName?: string; timeStr?: string; ggMeetLink?: string }) => {
      notifyDesktop(
        `⏰ NHẮC LỊCH PHỎNG VẤN TRONG 15 PHÚT!`,
        `Sếp ${data.candidateName || 'UV'} - Thời gian: ${data.timeStr || ''}. Chuẩn bị vào Google Meet!`,
        '/training'
      );
    };

    socket.on('zalo:ai_confirmed', handleAiConfirmed);
    socket.on('interview:remind_hr', handleInterviewRemind);

    return () => {
      socket.off('zalo:ai_confirmed', handleAiConfirmed);
      socket.off('interview:remind_hr', handleInterviewRemind);
    };
  }, []);

  const handleEnableNotifications = async () => {
    const res = await requestNotificationPermission();
    setPermission(res);
    if (res === 'granted') {
      notifyDesktop('🎉 Đã bật thông báo Desktop thành công!', 'Bạn sẽ nhận được thông báo ngay khi ứng viên xác nhận PV hoặc có nhắc lịch hẹn.');
    }
  };

  if (permission === 'granted') {
    return (
      <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200/80" title="Thông báo Desktop máy tính đang hoạt động">
        <Bell size={13} className="animate-pulse" />
        <span>Desktop Notify Active</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleEnableNotifications}
      className="flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 px-3 py-1 rounded-full border border-amber-200 transition-all shadow-2xs"
      title="Bấm để cho phép trình duyệt gửi thông báo đẩy Desktop khi có ứng viên xác nhận PV"
    >
      <BellOff size={14} />
      <span>Bật thông báo Desktop</span>
    </button>
  );
}
