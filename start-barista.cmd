@echo off
rem ===== הפעלת יומן הבריסטה =====
rem מפעיל את השרת המקומי (אם אינו רץ כבר) ופותח את האפליקציה בדפדפן.
cd /d "C:\Naor\CoffeMaster\CoffeMaster"
start /min "Barista Journal Server" cmd /c "npm run preview"
timeout /t 3 /nobreak >nul
start "" "http://localhost:4173"
