import { useEffect, useState } from 'react';
import { HomeScreen } from './ui/HomeScreen';
import { NewShotScreen } from './ui/NewShotScreen';
import { ShotsScreen } from './ui/ShotsScreen';
import { BeansScreen } from './ui/BeansScreen';
import { DashboardScreen } from './ui/DashboardScreen';
import { AnalyticsScreen } from './ui/AnalyticsScreen';
import { SettingsScreen } from './ui/SettingsScreen';
import { BeansBackground } from './ui/BeansBackground';

export type Screen = 'home' | 'new-shot' | 'shots' | 'beans' | 'dashboard' | 'analytics' | 'settings';

const NAV: { screen: Screen; icon: string; label: string }[] = [
  { screen: 'home', icon: '🏠', label: 'בית' },
  { screen: 'new-shot', icon: '☕', label: 'שוט חדש' },
  { screen: 'shots', icon: '📖', label: 'יומן' },
  { screen: 'beans', icon: '🫘', label: 'פולים' },
  { screen: 'dashboard', icon: '📊', label: 'נתונים' },
  { screen: 'analytics', icon: '📈', label: 'ניתוח' },
  { screen: 'settings', icon: '⚙️', label: 'הגדרות' },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('theme') as 'dark' | 'light') ?? 'dark',
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  return (
    <>
    <BeansBackground />
    <div className="app">
      <header className="topbar">
        <h1>☕ יומן בריסטה חכם</h1>
        <button
          className="theme-toggle"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="החלפת מצב תצוגה"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </header>

      {/* key על העטיפה מפעיל את אנימציית הכניסה בכל החלפת מסך */}
      <main key={screen} className="screen">
        {screen === 'home' && <HomeScreen navigate={setScreen} />}
        {screen === 'new-shot' && <NewShotScreen navigate={setScreen} />}
        {screen === 'shots' && <ShotsScreen />}
        {screen === 'beans' && <BeansScreen />}
        {screen === 'dashboard' && <DashboardScreen />}
        {screen === 'analytics' && <AnalyticsScreen />}
        {screen === 'settings' && <SettingsScreen />}
      </main>

      <nav className="bottom-nav">
        {NAV.map((item) => (
          <button
            key={item.screen}
            className={screen === item.screen ? 'active' : ''}
            onClick={() => setScreen(item.screen)}
          >
            <span className="icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </div>
    </>
  );
}
