@echo off
REM Downloads the models Sunprint uses (skips files already present). All Apache-2.0, no login.
REM Models go into the ComfyUI folder next to this file; set SUNPRINT_COMFYUI to use another one.
if defined SUNPRINT_COMFYUI (set "M=%SUNPRINT_COMFYUI%\models") else (set "M=%~dp0ComfyUI\models")
REM Mode 1 (text to image): Z-Image-Turbo
call :dl "https://huggingface.co/unsloth/Z-Image-Turbo-GGUF/resolve/main/z-image-turbo-Q4_K_S.gguf" "%M%\unet\z-image-turbo-Q4_K_S.gguf"
call :dl "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors" "%M%\vae\z_image_ae.safetensors"
REM Modes 2-5 (img2img, edit, continue, inpaint): FLUX.2 Klein 4B. Text encoder is shared by both.
call :dl "https://huggingface.co/unsloth/FLUX.2-klein-4B-GGUF/resolve/main/flux-2-klein-4b-Q5_K_M.gguf" "%M%\unet\flux-2-klein-4b-Q5_K_M.gguf"
call :dl "https://huggingface.co/worstplayer/Z-Image_Qwen_3_4b_text_encoder_GGUF/resolve/main/Qwen_3_4b-imatrix-IQ4_XS.gguf" "%M%\text_encoders\Qwen_3_4b-imatrix-IQ4_XS.gguf"
call :dl "https://huggingface.co/black-forest-labs/FLUX.2-small-decoder/resolve/main/full_encoder_small_decoder.safetensors" "%M%\vae\flux2_small_decoder.safetensors"
REM Modes 6-7 (video): Wan 2.2 TI2V 5B Turbo
call :dl "https://huggingface.co/hum-ma/Wan2.2-TI2V-5B-Turbo-GGUF/resolve/main/Wan2_2-TI2V-5B-Turbo-Q5_K_M.gguf" "%M%\unet\Wan2_2-TI2V-5B-Turbo-Q5_K_M.gguf"
call :dl "https://huggingface.co/city96/umt5-xxl-encoder-gguf/resolve/main/umt5-xxl-encoder-Q5_K_M.gguf" "%M%\text_encoders\umt5-xxl-encoder-Q5_K_M.gguf"
call :dl "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors" "%M%\vae\wan2.2_vae.safetensors"
echo All models ready.
pause
exit /b

:dl
if exist %2 (echo SKIP %~nx2 & exit /b)
echo Downloading %~nx2 ...
curl -L --fail --retry 10 --retry-all-errors -C - -o "%~2.part" %1 && move /y "%~2.part" %2 >nul
exit /b
