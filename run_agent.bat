@echo off
echo =========================================
echo Setting up Beyond Dental Health Agent
echo =========================================
echo.
echo Installing required Python packages...
pip install -r requirements.txt
echo.
echo =========================================
echo Warning: If PyAudio fails to install, you may need to install it manually.
echo =========================================
echo.
echo Starting the Voice Agent...
python voice_agent.py
pause
