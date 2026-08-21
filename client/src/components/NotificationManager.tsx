import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, CheckCircle2, Sparkles, X, Clock, CalendarCheck } from 'lucide-react';
import { getSocket } from '../api/socket';
import { notifyDesktop, requestNotificationPermission } from '../utils/notification';

interface ToastItem {
  id: string;
  title: string;
  candidateName: string;
  message: string;
  type: 'ACCEPT' | 'REJECT' | 'REMIND';
  url: string;
}

export function NotificationManager() {
  const navigate = useNavigate();
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [activeToast, setActiveToast] = useState<ToastItem | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    if (!activeToast) return;
    // Tự động đóng Toast sau đúng 8 giây (8000ms)
    const timer = setTimeout(() => {
      setActiveToast(null);
    }, 8000);
    return () => clearTimeout(timer);
  }, [activeToast]);

  useEffect(() => {
    const socket = getSocket();

    const handleAiConfirmed = (data: { candidateName?: string; action?: string; newStatus?: string }) => {
      const candidateName = data?.candidateName || 'Ứng viên';

      if (data?.action === 'CONFIRMED_ACCEPT') {
        const item: ToastItem = {
          id: String(Date.now()),
          title: '🎉 AI VỪA TỰ ĐỘNG XÁC NHẬN ỨNG VIÊN!',
          candidateName,
          message: 'Đồng ý phỏng vấn từ Zalo cá nhân! Đã cập nhật trạng thái Sắp bắt đầu training.',
          type: 'ACCEPT',
          url: '/training',
        };
        setActiveToast(item);
        notifyDesktop(`🎉 Ứng viên ${candidateName} đã XÁC NHẬN!`, item.message, '/training');
      } else if (data?.action === 'CONFIRMED_REJECT') {
        const item: ToastItem = {
          id: String(Date.now()),
          title: '❌ ỨNG VIÊN PHẢN HỒI TỪ CHỐI',
          candidateName,
          message: 'Ứng viên vừa báo bận hoặc từ chối lịch hẹn phỏng vấn trên Zalo.',
          type: 'REJECT',
          url: '/training',
        };
        setActiveToast(item);
        notifyDesktop(`❌ Ứng viên ${candidateName} từ chối phỏng vấn`, item.message, '/training');
      }
    };

    const handleInterviewRemind = (data: { candidateName?: string; timeStr?: string; ggMeetLink?: string }) => {
      const candidateName = data?.candidateName || 'Ứng viên';
      const item: ToastItem = {
        id: String(Date.now()),
        title: '⏰ NHẮC LỊCH PHỎNG VẤN TRONG 15 PHÚT!',
        candidateName,
        message: `Lịch hẹn phỏng vấn vào ${data?.timeStr || ''}. Vui lòng chuẩn bị phòng Google Meet!`,
        type: 'REMIND',
        url: '/training',
      };
      setActiveToast(item);
      notifyDesktop(`⏰ Nhắc lịch phỏng vấn với Sếp ${candidateName}!`, item.message, '/training');
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
      notifyDesktop('🎉 Đã bật thông báo Desktop thành công!', 'Bạn sẽ nhận được thông báo ngay khi ứng viên xác nhận PV.');
    }
  };

  const handleToastClick = () => {
    if (activeToast?.url) {
      navigate(activeToast.url);
    }
    setActiveToast(null);
  };

  return (
    <>
      {/* Nút Trạng Thái Thông Báo Trên Header */}
      {permission === 'granted' ? (
        <div className="flex items-center gap-1 text-[11px] font-semibold text-pink-600 bg-pink-50 px-2.5 py-1 rounded-full border border-pink-200/80" title="Thông báo Desktop máy tính đang hoạt động">
          <Bell size={13} className="animate-pulse" />
          <span>Desktop Notify Active</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleEnableNotifications}
          className="flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 px-3 py-1 rounded-full border border-amber-200 transition-all shadow-2xs"
          title="Bấm để cho phép trình duyệt gửi thông báo đẩy Desktop khi có ứng viên xác nhận PV"
        >
          <BellOff size={14} />
          <span>Bật thông báo Desktop</span>
        </button>
      )}

      {/* Cửa sổ Floating Toast To Rõ Hiện Đại Tông Màu Hồng Góc Màn Hình (Thời gian chờ 8s) */}
      {activeToast && typeof document !== 'undefined' && createPortal(
        <div
          style={{ position: 'fixed', bottom: '32px', right: '32px', zIndex: 99999999, margin: 0, padding: 0 }}
          className="max-w-md w-[calc(100vw-64px)] sm:w-[420px] animate-slide-up pointer-events-auto shadow-2xl"
        >
          <div
            onClick={handleToastClick}
            className="relative overflow-hidden bg-slate-950/95 backdrop-blur-2xl border-2 border-pink-500 rounded-3xl p-5 shadow-2xl shadow-pink-500/50 cursor-pointer hover:border-pink-400 transition-all group"
          >
            {/* Thanh đếm ngược thời gian 8 giây (8s Progress Bar Pink) */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-slate-800 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-pink-500 via-rose-400 to-pink-300 animate-shrink-8s" />
            </div>

            <div className="flex items-start gap-4 pt-1">
              {/* Icon Badge Màu Hồng To Rõ */}
              <div className="w-13 h-13 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 text-white flex items-center justify-center shrink-0 shadow-lg shadow-pink-500/40 group-hover:scale-105 transition-transform">
                {activeToast.type === 'ACCEPT' ? (
                  <CheckCircle2 size={28} className="text-white stroke-[2.5]" />
                ) : activeToast.type === 'REMIND' ? (
                  <Clock size={28} className="text-white stroke-[2.5]" />
                ) : (
                  <CalendarCheck size={28} className="text-white stroke-[2.5]" />
                )}
              </div>

              {/* Nội dung thông báo Tông Hồng To Rõ Hiện Đại */}
              <div className="flex-1 min-w-0 pr-6">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-pink-500/20 text-pink-300 border border-pink-500/40 mb-1">
                  <Sparkles size={11} /> {activeToast.title}
                </div>
                <h4 className="text-base font-black text-white truncate group-hover:text-pink-300 transition-colors">
                  Sếp {activeToast.candidateName}
                </h4>
                <p className="text-xs text-slate-300 font-medium leading-relaxed mt-1">
                  {activeToast.message}
                </p>
                <div className="text-[10px] text-pink-400 font-semibold mt-2 flex items-center gap-1">
                  <span>👉 Bấm vào đây để tới danh sách phỏng vấn (Tự đóng sau 8s)</span>
                </div>
              </div>

              {/* Nút Đóng Toast */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveToast(null);
                }}
                className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
                title="Đóng thông báo"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
