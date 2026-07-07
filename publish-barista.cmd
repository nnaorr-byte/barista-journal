@echo off
rem ===== פרסום עדכון לאינטרנט (GitHub Pages) =====
rem בונה את האפליקציה ומעלה את הגרסה החדשה לכתובת הקבועה.
cd /d "C:\Naor\CoffeMaster\CoffeMaster"
set GITHUB_PAGES=true
call npm run build
if errorlevel 1 (
  echo Build failed!
  pause
  exit /b 1
)
type nul > dist\.nojekyll
cd dist
git init -b gh-pages
git config user.name "Naor"
git config user.email "naor@adhestick.com"
git add -A
git commit -m "Deploy site update"
git push -f https://github.com/nnaorr-byte/barista-journal.git gh-pages
cd ..
rmdir /s /q dist\.git
echo.
echo Done! https://nnaorr-byte.github.io/barista-journal/
pause
