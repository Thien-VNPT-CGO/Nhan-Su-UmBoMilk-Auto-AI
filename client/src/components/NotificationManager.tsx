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

    const handleNotificationNew = (data: { title?: string; body?: string; url?: string }) => {
      if (!data?.title) return;
      const item: ToastItem = {
        id: String(Date.now()),
        title: data.title,
        candidateName: 'Hệ thống',
        message: data.body || '',
        type: 'ACCEPT',
        url: data.url || '/candidates',
      };
      setActiveToast(item);
      notifyDesktop(data.title, data.body || '', data.url);
    };

    socket.on('zalo:ai_confirmed', handleAiConfirmed);
    socket.on('interview:remind_hr', handleInterviewRemind);
    socket.on('notification:new', handleNotificationNew);

    return () => {
      socket.off('zalo:ai_confirmed', handleAiConfirmed);
      socket.off('interview:remind_hr', handleInterviewRemind);
      socket.off('notification:new', handleNotificationNew);
    };
  }, []);

  const handleTestNotification = async () => {
    const res = await requestNotificationPermission();
    setPermission(res);
    const testItem: ToastItem = {
      id: String(Date.now()),
      title: '🔔 THỬ NGHIỆM THÔNG BÁO THÀNH CÔNG!',
      candidateName: 'Hệ Thống HR',
      message: 'Âm thanh chuông & thông báo Desktop máy tính hoạt động hoàn hảo!',
      type: 'ACCEPT',
      url: '/training',
    };
    setActiveToast(testItem);
    notifyDesktop('🔔 Thử thông báo Hệ thống HR', 'Âm thanh chuông & thông báo Desktop máy tính đang hoạt động rất tốt!', '/training');
  };

  const handleToastClick = () => {
    if (activeToast?.url) {
      navigate(activeToast.url);
    }
    setActiveToast(null);
  };

  return (
    <>
      {/* Nút Trạng Thái Thông Báo Trên Header (Bấm để thử nghiệm) */}
      {permission === 'granted' ? (
        <button
          type="button"
          onClick={handleTestNotification}
          className="flex items-center gap-1.5 text-[11px] font-bold text-pink-700 bg-pink-50 hover:bg-pink-100 px-3 py-1 rounded-full border border-pink-200 transition-all shadow-2xs cursor-pointer"
          title="Bấm vào đây để thử nghiệm âm thanh chuông & thông báo Desktop máy tính"
        >
          <Bell size={13} className="animate-pulse text-pink-600" />
          <span>Desktop Notify Active (Bấm thử)</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleTestNotification}
          className="flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 px-3 py-1 rounded-full border border-amber-200 transition-all shadow-2xs cursor-pointer"
          title="Bấm để cho phép trình duyệt gửi thông báo đẩy Desktop khi có ứng viên xác nhận PV"
        >
          <BellOff size={14} />
          <span>Bật thông báo Desktop</span>
        </button>
      )}

      {/* Cửa sổ Floating Toast Nền Hồng Chữ Trắng Góc Màn Hình (Thời gian chờ 8s) */}
      {activeToast && typeof document !== 'undefined' && createPortal(
        <div
          style={{ position: 'fixed', bottom: '32px', right: '32px', zIndex: 99999999, margin: 0, padding: 0 }}
          className="max-w-md w-[calc(100vw-64px)] sm:w-[420px] animate-slide-up pointer-events-auto shadow-2xl"
        >
          <div
            onClick={handleToastClick}
            className="relative overflow-hidden bg-gradient-to-r from-pink-600 via-rose-600 to-pink-500 text-white rounded-3xl p-5 shadow-2xl shadow-pink-500/50 border-2 border-pink-300/80 cursor-pointer hover:scale-[1.01] transition-all group"
          >
            {/* Thanh đếm ngược thời gian 8 giây (8s Progress Bar Màu Trắng) */}
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-black/20 overflow-hidden">
              <div className="h-full bg-white animate-shrink-8s" />
            </div>

            <div className="flex items-start gap-4 pt-1">
              {/* Icon Badge Nền Trắng Icon Hồng */}
              <div className="w-13 h-13 rounded-2xl bg-white text-pink-600 flex items-center justify-center shrink-0 shadow-lg shadow-black/20 group-hover:scale-105 transition-transform">
                {activeToast.type === 'ACCEPT' ? (
                  <CheckCircle2 size={30} className="text-pink-600 stroke-[2.5]" />
                ) : activeToast.type === 'REMIND' ? (
                  <Clock size={30} className="text-pink-600 stroke-[2.5]" />
                ) : (
                  <CalendarCheck size={30} className="text-pink-600 stroke-[2.5]" />
                )}
              </div>

              {/* Nội dung thông báo Nền Hồng Chữ Trắng To Rõ */}
              <div className="flex-1 min-w-0 pr-6">
                <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-white/25 text-white border border-white/40 mb-1 shadow-xs">
                  <Sparkles size={12} /> {activeToast.title}
                </div>
                <h4 className="text-lg font-black text-white truncate tracking-tight drop-shadow-xs">
                  Sếp {activeToast.candidateName}
                </h4>
                <p className="text-xs text-pink-50 font-semibold leading-relaxed mt-1">
                  {activeToast.message}
                </p>
                <div className="text-[11px] text-white font-bold mt-2.5 inline-flex items-center gap-1 bg-black/20 px-2.5 py-1 rounded-xl border border-white/20">
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
                className="absolute top-4 right-4 text-white/80 hover:text-white p-1.5 rounded-xl hover:bg-white/20 transition-colors"
                title="Đóng thông báo"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
