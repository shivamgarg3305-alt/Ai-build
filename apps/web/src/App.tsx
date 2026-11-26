import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AuthGate } from './components/AuthGate';
import { ConversationPage } from './pages/ConversationPage';
import { MemoryPage } from './pages/MemoryPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SettingsPage } from './pages/SettingsPage';
import { TasksPage } from './pages/TasksPage';

export function App() {
  return (
    <AuthGate>
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<ConversationPage />} />
        <Route path="memory" element={<MemoryPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    </AuthGate>
  );
}
