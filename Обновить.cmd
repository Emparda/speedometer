@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
if errorlevel 1 goto folder_error

echo Подготовка QR-кода для установки Спидометра.
echo Используются исходники из этой папки:
echo %CD%
echo.
echo Этот файл не скачивает изменения с GitHub.
echo Перед запуском замените исходники актуальной версией проекта.
echo.
if not exist "package.json" goto project_error
if not exist "package-lock.json" goto project_error
where node.exe >nul 2>nul
if errorlevel 1 goto node_error
where npm.cmd >nul 2>nul
if errorlevel 1 goto node_error

if not exist "node_modules\.bin\zeus.cmd" goto install
if not exist "node_modules\.speedometer-lock.json" goto install
fc /b "package-lock.json" "node_modules\.speedometer-lock.json" >nul 2>nul
if errorlevel 1 goto install
goto preview

:install
echo Установка зависимостей. Дождитесь завершения...
call npm.cmd ci
if errorlevel 1 goto install_error
copy /y "package-lock.json" "node_modules\.speedometer-lock.json" >nul

:preview
echo.
echo Создание QR-кода. При запросе войдите в Zepp и выберите T-Rex 3.
call npm.cmd run preview
if errorlevel 1 goto preview_error
echo.
echo Отсканируйте полученный QR-код в режиме разработчика Zepp.
goto finish

:project_error
echo ОШИБКА: рядом с этим файлом нет package.json или package-lock.json.
echo Поместите Обновить.cmd в корень распакованного проекта.
goto finish

:node_error
echo ОШИБКА: не найден Node.js или npm.
echo Установите Node.js, затем заново откройте этот файл.
goto finish

:install_error
echo.
echo Не удалось установить зависимости. QR-код не создан.
echo Сохраните текст ошибки выше или сделайте скриншот.
goto finish

:preview_error
echo.
echo Подготовка QR-кода завершилась с ошибкой.
echo Сохраните текст ошибки выше или сделайте скриншот.
goto finish

:folder_error
echo Не удалось открыть папку проекта.
pause
exit /b 1

:finish
echo.
pause
popd
endlocal
