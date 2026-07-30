import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { seedIfEmpty } from './db/database';
import { autoSnapshot } from './services/snapshots';
import './styles.css';

// בקשת אחסון קבוע: מונע מהדפדפן לפנות את נתוני היומן בלחץ מקום
navigator.storage?.persist?.().catch(() => {});

seedIfEmpty().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // תמונת מצב אוטומטית — אחרי הרינדור בכוונה, כדי שלא תעכב את הפתיחה
  void autoSnapshot();
});
