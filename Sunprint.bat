@echo off
REM One click: starts ComfyUI and the Sunprint studio, opens the browser when both are ready,
REM and stops both when this window is closed (or Q is pressed).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sunprint-launcher.ps1"
