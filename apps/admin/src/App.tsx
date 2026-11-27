import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { BrandLabel, Icon } from './components/icons';
import type { IconName } from './components/icons';
import { ErrorText, ToastProvider } from './components/ui';
import { adminApi } from './lib/api';
import { useMutation } from './lib/hooks';
import { CharactersPage } from './pages/CharactersPage';
import { DashboardPage } from './pages/DashboardPage';
import { EventsPage } from './pages/EventsPage';
import { LoginPage } from './pages/LoginPage';
import { LogsPage } from './pages/LogsPage';
import { RequestsPage } from './pages/RequestsPage';
import { SubmissionsPage } from './pages/SubmissionsPage';
import { TopicsPage } from './pages/TopicsPage';
import { VideosPage } from './pages/VideosPage';
import { WorksPage } from './pages/WorksPage';

const modules = [
  { path: '/', label: '总览', icon: 'dashboard', Page: DashboardPage },
  { path: '/submissions', label: '投稿审核', icon: 'submissions', Page: SubmissionsPage },
  { path: '/works', label: '作品库', icon: 'works', Page: WorksPage },
  { path: '/characters', label: '角色与分类', icon: 'characters', Page: CharactersPage },
  { path: '/topics', label: '专题与连载', icon: 'topics', Page: TopicsPage },
  { path: '/videos', label: 'B 站作者与视频', icon: 'videos', Page: VideosPage },
  { path: '/events', label: '站内活动', icon: 'events', Page: EventsPage },
  { path: '/requests', label: '下架与更正', icon: 'requests', Page: RequestsPage },
  { path: '/logs', label: '机器人与日志', icon: 'logs', Page: LogsPage },
] as const satisfies readonly { path: string; label: string; icon: IconName; Page: () => React.JSX.Element }[];

function ThemeButton() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('dafeiyu-admin-theme');
    return stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);
  const label = dark ? '切换浅色' : '切换暗色';
  return <button type="button" className="icon-button" aria-label={label} title={label} onClick={() => {
    localStorage.setItem('dafeiyu-admin-theme', dark ? 'light' : 'dark');
    setDark(!dark);
  }}><Icon name={dark ? 'sun' : 'moon'} /></button>;
}

function ModuleLinks({ onNavigate }: { onNavigate?: () => void }) {
  return <nav className="module-nav" aria-label="管理模块">
    {modules.map(({ path, label, icon }) => <NavLink key={path} to={path} end onClick={onNavigate}>
      <Icon name={icon} /><span>{label}</span>
    </NavLink>)}
  </nav>;
}

function Workspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const mutation = useMutation();
  const drawer = useRef<HTMLDialogElement>(null);
  const drawerClose = useRef<HTMLButtonElement>(null);
  const drawerId = useId();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const label = modules.find(module => module.path === location.pathname.replace(/\/$/, '') || (module.path === '/' && location.pathname === '/'))?.label ?? '页面未找到';

  useEffect(() => {
    document.title = `${label} · 蓝色大肥鱼管理台`;
  }, [label]);

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 760px)');
    const closeOnDesktop = () => { if (!mobile.matches) drawer.current?.close(); };
    mobile.addEventListener('change', closeOnDesktop);
    return () => mobile.removeEventListener('change', closeOnDesktop);
  }, []);

  useEffect(() => {
    function searchShortcut(event: KeyboardEvent) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest('input,textarea,select,button'))) return;
      if (document.querySelector('dialog[open]')) return;
      const focusedPanel = event.target instanceof HTMLElement ? event.target.closest('.panel') : null;
      const field = focusedPanel?.querySelector<HTMLInputElement>('[data-search-target]') ?? document.querySelector<HTMLInputElement>('[data-search-target]');
      if (!field) return;
      event.preventDefault();
      field.focus();
    }
    window.addEventListener('keydown', searchShortcut);
    return () => window.removeEventListener('keydown', searchShortcut);
  }, []);

  return <div className="workspace">
    <a href="#page-heading" className="skip-link">跳到内容</a>
    <aside className="sidebar">
      <div className="sidebar-heading"><Link to="/" className="brand"><BrandLabel /></Link></div>
      <ModuleLinks />
    </aside>
    <dialog className="nav-drawer" id={drawerId} ref={drawer} aria-label="管理导航" onClose={() => setDrawerOpen(false)} onClick={event => {
      if (event.target === event.currentTarget) event.currentTarget.close();
    }}>
      <div className="sidebar-heading">
        <Link to="/" className="brand" onClick={() => drawer.current?.close()}><BrandLabel /></Link>
        <button ref={drawerClose} type="button" className="icon-button" aria-label="关闭导航" onClick={() => drawer.current?.close()}><Icon name="close" /></button>
      </div>
      <ModuleLinks onNavigate={() => drawer.current?.close()} />
    </dialog>
    <div className="desk">
      <header className="topbar">
        <div className="topbar-context">
          <button type="button" className="icon-button drawer-trigger" aria-label="打开导航" aria-controls={drawerId} aria-expanded={drawerOpen} onClick={() => {
            drawer.current?.showModal();
            drawerClose.current?.focus({ preventScroll: true });
            setDrawerOpen(true);
          }}><Icon name="menu" /></button>
          <span className="breadcrumb"><span>工作台</span><Icon name="chevron" /><strong>{label}</strong></span>
        </div>
        <div className="topbar-actions">
          <a href="/" target="_blank" rel="noreferrer" className="public-link">访问前台<Icon name="arrow" /></a>
          <ThemeButton />
          <button type="button" disabled={mutation.busy} onClick={() => void mutation.run(() => adminApi('/logout', { method: 'POST' }), () => navigate('/login', { replace: true }))}>退出</button>
        </div>
      </header>
      <main className="page"><h1 id="page-heading" tabIndex={-1}>{label}</h1><ErrorText message={mutation.error} /><Outlet /></main>
    </div>
  </div>;
}

export function App() {
  return <ToastProvider><Routes>
    <Route path="/login" element={<LoginPage theme={<ThemeButton />} />} />
    <Route element={<Workspace />}>
      {modules.map(({ path, Page }) => <Route key={path} path={path} element={<Page />} />)}
      <Route path="*" element={<Link to="/">回到总览</Link>} />
    </Route>
  </Routes></ToastProvider>;
}
