import { useEffect, useRef, useState } from 'react';
import { HomeScreen } from './ui/HomeScreen';
import { NewShotScreen } from './ui/NewShotScreen';
import { ShotsScreen } from './ui/ShotsScreen';
import { BeansScreen } from './ui/BeansScreen';
import { DashboardScreen } from './ui/DashboardScreen';
import { AnalyticsScreen } from './ui/AnalyticsScreen';
import { SettingsScreen } from './ui/SettingsScreen';
import { BeansBackground } from './ui/BeansBackground';
import {
  BeanIcon, ChartIcon, CupIcon, HomeIcon, JournalIcon, MoonIcon, SettingsIcon, SunIcon,
} from './ui/icons';
import type { ReactNode } from 'react';

export type Screen = 'home' | 'new-shot' | 'shots' | 'beans' | 'dashboard' | 'settings';

// "שוט חדש" הוא הכפתור המרכזי המורם (FAB); השאר אייקוני קו משני צדדיו.
// הגדרות — בכפתור העליון ליד מתג יום/לילה; הניתוח מוזג לעמוד הנתונים.
const NAV: { screen: Screen; icon: ReactNode; label: string; fab?: boolean }[] = [
  { screen: 'home', icon: <HomeIcon />, label: 'בית' },
  { screen: 'shots', icon: <JournalIcon />, label: 'יומן' },
  { screen: 'new-shot', icon: <CupIcon />, label: 'שוט חדש', fab: true },
  { screen: 'beans', icon: <BeanIcon />, label: 'פולים' },
  { screen: 'dashboard', icon: <ChartIcon />, label: 'נתונים' },
];

export default function App() {
  const [screen, setScreenState] = useState<Screen>('home');
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('theme') as 'dark' | 'light') ?? 'dark',
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
    // צבע שורת הסטטוס (PWA/דפדפן) עוקב אחרי המצב הנוכחי
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#2b1d16' : '#f2e8d9');
  }, [theme]);

  // אינטגרציית כפתור Back: כל מסך נרשם ב-history של הדפדפן,
  // כך ש-Back (בדפדפן/אנדרואיד) חוזר מסך אחורה במקום לצאת מהאפליקציה.
  useEffect(() => {
    history.replaceState({ screen: 'home' }, '');
    const onPop = (e: PopStateEvent) => {
      const s = (e.state as { screen?: Screen } | null)?.screen;
      setScreenState(s ?? 'home');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ניווט קדימה — דוחף רשומת היסטוריה (לחיצה חוזרת על אותו מסך לא נרשמת)
  const setScreen = (s: Screen) => {
    if (s !== screen) history.pushState({ screen: s }, '');
    setScreenState(s);
  };

  // "זכוכית מתעוררת": הכותרת שקופה בראש העמוד ומקבלת רקע זכוכית בגלילה
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ביצת פסחא: 5 לחיצות רצופות על הלוגו מגבירות את גשם הפולים לרגע
  const logoClicks = useRef({ n: 0, t: 0 });
  const onLogoClick = () => {
    const now = Date.now();
    const c = logoClicks.current;
    if (now - c.t > 800) c.n = 0; // איפוס אם עברה יותר משנייה בין לחיצות
    c.t = now;
    c.n += 1;
    if (c.n >= 5) {
      c.n = 0;
      window.dispatchEvent(new Event('beans-burst'));
    }
  };

  return (
    <>
    <BeansBackground />
    <div className="app">
      <header className={`topbar ${scrolled ? 'scrolled' : ''}`}>
        <h1 onClick={onLogoClick}><CupIcon size={22} /> יומן בריסטה חכם</h1>
        <div className="topbar-actions">
          <button
            className={`theme-toggle ${screen === 'settings' ? 'active' : ''}`}
            onClick={() => setScreen('settings')}
            aria-label="הגדרות"
            aria-current={screen === 'settings' ? 'page' : undefined}
          >
            <SettingsIcon size={19} />
          </button>
          <button
            className="theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="החלפת מצב תצוגה"
          >
            {theme === 'dark' ? <SunIcon size={19} /> : <MoonIcon size={19} />}
          </button>
        </div>
      </header>

      {/* key על העטיפה מפעיל את אנימציית הכניסה בכל החלפת מסך */}
      <main key={screen} className="screen">
        {screen === 'home' && <HomeScreen navigate={setScreen} />}
        {screen === 'new-shot' && <NewShotScreen navigate={setScreen} />}
        {screen === 'shots' && <ShotsScreen />}
        {screen === 'beans' && <BeansScreen />}
        {screen === 'dashboard' && (
          <>
            <DashboardScreen />
            {/* הניתוח ממשיך את עמוד הנתונים — נתונים קודם, ניתוח אחריהם */}
            <AnalyticsScreen />
          </>
        )}
        {screen === 'settings' && <SettingsScreen />}
      </main>

      <nav className="bottom-nav">
        {NAV.map((item) =>
          item.fab ? (
            <button
              key={item.screen}
              className={`nav-fab ${screen === item.screen ? 'active' : ''}`}
              onClick={() => setScreen(item.screen)}
              aria-label={item.label}
              aria-current={screen === item.screen ? 'page' : undefined}
            >
              {item.icon}
            </button>
          ) : (
            <button
              key={item.screen}
              className={screen === item.screen ? 'active' : ''}
              onClick={() => setScreen(item.screen)}
              aria-current={screen === item.screen ? 'page' : undefined}
            >
              <span className="icon">{item.icon}</span>
              {item.label}
            </button>
          ),
        )}
      </nav>
    </div>
    </>
  );
}
