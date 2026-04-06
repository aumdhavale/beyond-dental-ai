@echo off
echo =========================================
echo  Beyond Dental Health — Starting Server
echo =========================================
echo.
echo  Opening at: http://localhost:3456
echo  (Chrome needs localhost for microphone)
echo.
start "" "http://localhost:3456/index.html"
python -m http.server 3456
pause
