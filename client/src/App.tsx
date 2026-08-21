import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './stores/auth';
import AppLayout from './layouts/AppLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Candidates from './pages/Candidates';
import Scoring from './pages/Scoring';
import Training from './pages/Training';
import Shifts from './pages/Shifts';
import Attendance from './pages/Attendance';
import Zalo from './pages/Zalo';
import Reports from './pages/Reports';
import ELearning from './pages/ELearning';
import SyncCenter from './pages/SyncCenter';
import AuditLog from './pages/AuditLog';
import Settings from './pages/Settings';
import ConfirmInterview from './pages/ConfirmInterview';
import PublicAttendance from './pages/PublicAttendance';
import { Spinner } from './components/ui';

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
        <Route path="/confirm-pv/:id" element={<ConfirmInterview />} />
        <Route path="/diemdanh/:id" element={<PublicAttendance />} />
        <Route path="/dang-ky" element={<Navigate to="/" replace />} />
        <Route
          path="/"
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
          <Route path="shifts" element={<Shifts />} />
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