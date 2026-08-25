import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './stores/auth';
import AppLayout from './layouts/AppLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Candidates from './pages/Candidates';
import Scoring from './pages/Scoring';
import Training from './pages/Training';
import { OfficialEmployees } from './pages/OfficialEmployees';
import Shifts from './pages/Shifts';
import Approvals from './pages/Approvals';
import Attendance from './pages/Attendance';
import Zalo from './pages/Zalo';
import Reports from './pages/Reports';
import ELearning from './pages/ELearning';
import SyncCenter from './pages/SyncCenter';
import AuditLog from './pages/AuditLog';
import Settings from './pages/Settings';
import ConfirmInterview from './pages/ConfirmInterview';
import PublicAttendance from './pages/PublicAttendance';
import EmployeePortal from './pages/EmployeePortal';
import { Spinner } from './components/ui';

function SmartRootRedirect() {
  const { user, loading } = useAuth();
  const empSession = localStorage.getItem('umbomilk_emp_session');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="text-brand-500" size={28} />
      </div>
    );
  }

  // 1. Nếu đã kích hoạt / có phiên làm việc Nhân viên -> mở Web App Nhân viên
  if (empSession) {
    return <Navigate to="/portal" replace />;
  }

  // 2. Nếu đã đăng nhập tài khoản HR/Admin -> chuyển sang Dashboard
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  // 3. Nếu truy cập trên di động -> mặc định mở Web App Nhân viên
  const isMobile = window.innerWidth <= 768 || /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (isMobile) {
    return <Navigate to="/portal" replace />;
  }

  // 4. Mặc định trên PC -> mở Đăng nhập HR
  return <Navigate to="/login" replace />;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="text-brand-500" size={28} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/portal" element={<EmployeePortal />} />
        <Route path="/employee-portal" element={<EmployeePortal />} />
        <Route path="/confirm-pv/*" element={<ConfirmInterview />} />
        <Route path="/diemdanh/*" element={<PublicAttendance />} />
        <Route path="/public/attendance/*" element={<PublicAttendance />} />
        <Route path="/dang-ky" element={<Navigate to="/" replace />} />
        <Route path="/" element={<SmartRootRedirect />} />
        <Route
          element={
            <Protected>
              <AppLayout />
            </Protected>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="candidates" element={<Candidates />} />
          <Route path="scoring" element={<Scoring />} />
          <Route path="training" element={<Training />} />
          <Route path="official-employees" element={<OfficialEmployees />} />
          <Route path="shifts" element={<Shifts />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="zalo" element={<Zalo />} />
          <Route path="reports" element={<Reports />} />
          <Route path="elearning" element={<ELearning />} />
          <Route path="sync" element={<SyncCenter />} />
          <Route path="audit" element={<AuditLog />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}