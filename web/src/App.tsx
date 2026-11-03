import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { RegisterPage } from './auth/RegisterPage';
import { RequireAuth } from './ui/RequireAuth';
import { PlansPage } from './plans/PlansPage';
import { CreatePlanPage } from './plans/CreatePlanPage';
import { PlanViewPage } from './plans/PlanViewPage';
import { PlanEditorPage } from './plans/PlanEditorPage';
import { SessionPage } from './session/SessionPage';
import { ProgressPage } from './progress/ProgressPage';
import { HistoryPage } from './history/HistoryPage';
import { SessionDetailPage } from './history/SessionDetailPage';

const qc = new QueryClient();
export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/" element={<RequireAuth><PlansPage /></RequireAuth>} />
            <Route path="/plans/new" element={<RequireAuth><CreatePlanPage /></RequireAuth>} />
            <Route path="/plan/:planId" element={<RequireAuth><PlanViewPage /></RequireAuth>} />
            <Route path="/plan/:planId/edit" element={<RequireAuth><PlanEditorPage /></RequireAuth>} />
            <Route path="/session/:dayId" element={<RequireAuth><SessionPage /></RequireAuth>} />
            <Route path="/progress/:exId" element={<RequireAuth><ProgressPage /></RequireAuth>} />
            <Route path="/history" element={<RequireAuth><HistoryPage /></RequireAuth>} />
            <Route path="/history/:id" element={<RequireAuth><SessionDetailPage /></RequireAuth>} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
