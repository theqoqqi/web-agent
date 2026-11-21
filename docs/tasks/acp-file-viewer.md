# [RFC] Веб-просмотрщик файлов сервера (/files) и автоперехват ссылок в acp-ui

## 1. Резюме решений

* **Проблема:** Веб-сборка `acp-ui` (на телефоне и ПК через `http://172.29.172.1:7682/`) не даёт открывать файлы на сервере по ссылкам `file:///...` и путям в карточках `ToolCallCard`, а подъем отдельного процесса-сервера расходует лишнюю память на VPS (889 МБ RAM) и требует новый порт.
* **Границы задачи (MVP):**
  * Встроенные HTTP-маршруты `GET /files` и `GET /files/assets/*` внутри существующего процесса [src/bridge.ts](../../src/bridge.ts) (порт `3001`, без отдельного демона) и прокси `location ^~ /files` в [deploy/nginx-acp-ui.conf](../../deploy/nginx-acp-ui.conf).
  * Серверный HTML-рендер (SSR) на базе локальных npm-пакетов `marked` и `highlight.js` с раздачей локальных CSS/JS ассетов (работает полностью автономно внутри VPN без CDN).
  * Функционал просмотра:
    * листинг директорий с хлебными крошками и переходом по папкам/файлам;
    * просмотр текстовых файлов с подсветкой синтаксиса, рендер Markdown, кликабельные номера строк с выделением и автоскроллом `#L10` / `#L10-L20`;
    * адаптивный тулбар для десктопа и телефона (`Wrap`, `Raw`, `Copy`, `Download`), на экранах `<= 640px` перенос длинных строк включён по умолчанию;
    * лимит `1 МБ` на рендер (`ACP_VIEWER_MAX_BYTES`): при превышении — предупреждение со ссылками на первые/последние `100 КБ` (`?head=1`, `?tail=1`) и потоковым скачиванием (`?download=1`); бинарные файлы предлагаются только к скачиванию (`?download=1`).
  * Доступ к любым читаемым путям на сервере (без белого/чёрного списка).
  * Автопреобразование в DOM `acp-ui` ([src/patch-acp-ui.ts](../../src/patch-acp-ui.ts)): ссылки `<a href="file://...">` и пути в `.tool-locations > .location` (`ToolCallCard`) превращаются в ссылки на `/files?path=...` с `target="_blank" rel="noopener"`.
* **Исключено из MVP:**
  * Редактирование, создание, удаление или загрузка файлов через браузер (только просмотр и скачивание).
  * Дерево файлов в левой боковой панели внутри самого `acp-ui`.

---

## 2. Контракты и схемы

### Расширение конфигурации (`src/config.ts`)

```typescript
export interface BridgeConfig {
    host: string;
    port: number;
    wsPath: string;
    command: string;
    args: string[];
    defaultCwd: string;
    shutdownGraceMs: number;
    maxLineBytes: number;
    heartbeatPingIntervalMs: number;
    maxFileBytes: number;
    viewerSnippetBytes: number;
}
```

* `ACP_VIEWER_MAX_BYTES`: дефолт `1048576` (`1 MiB`), целое положительное число.
* `ACP_VIEWER_SNIPPET_BYTES`: дефолт `102400` (`100 KiB`), целое положительное число.

### HTTP-маршруты (`/files` и `/files/assets/*`)

1. **`GET /files?path=<absPath>[&raw=1|download=1|head=1|tail=1]`**
   * Если `path` не передан — используется `config.defaultCwd`.
   * **Директория:** возвращает SSR-HTML со списком элементов (сначала папки, затем файлы, сортировка по имени), размерами, отметкой битых ссылок и хлебными крошками для каждого сегмента пути.
   * **Текстовый файл `<= maxFileBytes`:**
     * без флагов — SSR-HTML: для `.md`/`.markdown` рендер через `marked` (raw HTML экранируется), для остальных — подсветка через `highlight.js` и построчная нумерация (`id="L1"`, `data-line="1"`, ...) + тулбар;
     * `?raw=1` — `Content-Type: text/plain; charset=utf-8`, `X-Content-Type-Options: nosniff`;
     * `?download=1` — потоковая отдача через `fs.createReadStream` с `Content-Disposition: attachment; filename="..."`.
   * **Файл `> maxFileBytes`:**
     * без флагов и без `head`/`tail`/`download` — HTTP `200` (или `413`-информационная страница) с указанием размера и кнопками `Head 100 KB (?head=1)`, `Tail 100 KB (?tail=1)` и `Download (?download=1)`;
     * `?head=1` / `?tail=1` — читает ровно `viewerSnippetBytes` байт через `openSync`/`readSync` с обрезкой битых граничных байтов UTF-8 и рендерит с тем же UI и указанием смещения.
   * **Бинарный файл** (проверка первых 8 КБ на наличие `0x00` байта):
     * без `?download=1` — страница с информацией о типе/размере и кнопкой скачивания (`?download=1`);
     * `?download=1` — потоковое скачивание (`application/octet-stream`).
2. **`GET /files/assets/<name>`**
   * `viewer.css` — адаптивные стили (мобильные и десктопные медиа-запросы, `overflow-x: auto` внутри блока кода, `white-space: pre-wrap` в режиме wrap, крупные touch-кнопки `>= 40px`, sticky-шапка, подсветка выделенных строк).
   * `highlight.css` — CSS-тема из установленного пакета `highlight.js`.
   * `viewer.js` — переключение класса `is-wrapped` (кнопка `Wrap`, автоинициализация при `window.innerWidth <= 640`), кликабельная подсветка строк `#L10` / `#L10-L20` (`Shift+click` или последовательный клик диапазона на тач-экранах) с `scrollIntoView`, кнопка `Copy` (с fallback через `document.execCommand("copy")` для HTTP).

### Контракт Nginx (`deploy/nginx-acp-ui.conf`)

```nginx
location ^~ /files {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

### Контракт перехвата ссылок в `acp-ui` (`src/patch-acp-ui.ts`)

* Расширяет bootstrap-скрипт под тем же маркером `data-acp-web-bootstrap`:
  1. Находит `<a href^="file://">` внутри DOM (при старте и через `MutationObserver`) и переписывает в `<a href="/files?path=<encodedPath><hash>" target="_blank" rel="noopener" data-acp-file-linked="1">` (для Windows-форм вида `file:///C:/...` или Linux `file:///root/...` корректно извлекает pathname и сохраняет `#L...`).
  2. Находит `.tool-locations > .location:not([data-acp-file-linked])` (`ToolCallCard.vue`), извлекает путь после иконки `📁`, при необходимости достраивает относительный путь от текущего `cwd` (читаемого из `input.cwd-input` или сохранённого состояния) и превращает в кликабельную `<a href="/files?path=..." target="_blank" rel="noopener">`.
  3. Перехватывает `click` по необработанным `a[href^="file://"]` на уровне `document` (`capture: true`), на случай если ссылка нажата до тика `MutationObserver`.

---

## 3. Обработка краевых случаев и отказов

* **XSS в просматриваемых `.md`, `.html` и `.svg` файлах:**
  * При серверном рендере Markdown все raw HTML-теги внутри `.md` экранируются (`escapeHtml`), а ссылки со схемами `javascript:` / `vbscript:` / `data:text/html` нейтрализуются.
  * Каждая HTML-страница `/files` отдаётся с заголовком `Content-Security-Policy: default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self';` (без `'unsafe-inline'`).
  * Режим `?raw=1` всегда отдаёт `Content-Type: text/plain; charset=utf-8` и `X-Content-Type-Options: nosniff`.
* **Копирование `Copy` в insecure HTTP-контексте (`http://172.29.172.1:7682/`):**
  * На обычном HTTP без HTTPS `navigator.clipboard` в браузерах может быть `undefined`. Клиентский `viewer.js` проверяет `navigator.clipboard?.writeText`, а при отсутствии или ошибке использует скрытый `<textarea>` и `document.execCommand("copy")`.
* **Память VPS (889 МБ RAM) на больших файлах:**
  * Запрещено читать файл целиком до проверки `stats.size <= maxFileBytes`.
  * Фрагменты `?head=1` и `?tail=1` читают строго `viewerSnippetBytes` байт по файловому дескриптору; скачивание `?download=1` работает через поток (`createReadStream`).
* **Недоступные / битые файлы и симлинки:**
  * Отсутствующий путь -> `404`, недостаточно прав -> `403`, некорректный/пустой `path` без `defaultCwd` -> `400`.
  * Внутри директории ошибки `stat` на отдельных элементах (например, битый symlink) не роняют листинг — запись показывается с пометкой недоступности и без падения с `500`.
* **Зацикливание `MutationObserver` и обрыв чата на телефоне:**
  * Обработанные DOM-элементы помечаются `data-acp-file-linked="1"`, чтобы не вызывать повторную мутацию.
  * Все сгенерированные ссылки на `/files` имеют `target="_blank" rel="noopener"`, чтобы вкладка с активной WebSocket-сессией `acp-ui` не закрывалась при открытии файла.
* **Разрыв многобайтового UTF-8 в `?head=1` / `?tail=1`:**
  * При чтении среза с произвольного смещения отбрасываются неполные ведущие/хвостовые UTF-8 байты (`\uFFFD` на границах среза) и обрезается неполная крайняя строка для `?tail=1` / `?head=1`.

---

## 4. Пошаговый план реализации (TDD Flow)

1. [x] **Шаг 0: Подключение `marked` и `highlight.js`, расширение `BridgeConfig`**
   * Установить `marked` и `highlight.js` в `package.json`, проверить совместимость с `npm run typecheck`.
   * Добавить поля `maxFileBytes` и `viewerSnippetBytes` в `src/config.ts` и обновить `tests/config.test.ts` + базовый фикстурный конфиг в `tests/bridge.test.ts` по циклу RED -> GREEN.
2. [x] **Шаг 1: Разбор URL, диапазонов строк `#L...` и URL-конструктор (`src/file-viewer/path-utils.ts`)**
   * **RED:** Написать тест в `tests/file-viewer-path.test.ts` на парсинг query `/files` (`path`, `raw`, `download`, `head`, `tail`), преобразование `file:///...#L10-L20` в `/files?path=...#L10-L20`, разрешение относительных путей от `cwd` и экранирование имён в `Content-Disposition`. Проверяет поломку: потеря `#L10-L20`, двойное кодирование `%2F` или битая обработка пробелов/кириллицы в именах файлов. Запуск: `npx vitest run tests/file-viewer-path.test.ts` (ожидается FAIL).
   * **GREEN:** Реализовать `src/file-viewer/path-utils.ts`. Запуск: `npx vitest run tests/file-viewer-path.test.ts` (ожидается PASS).
   * **REFACTOR:** Вынести нормализацию query-флагов и проверку границ.
3. [x] **Шаг 2: Безопасное чтение ФС, детект бинарников, срез фрагментов и листинг директорий (`src/file-viewer/file-reader.ts`)**
   * **RED:** Написать интеграционные тесты в `tests/file-reader.test.ts` на реальных временных файлах и папках в `tmpdir()`:
     * чтение текстового файла в пределах лимита;
     * возврат `too_large` для файла больше `maxFileBytes` (без загрузки всего файла в память) и чтение `?head=1` / `?tail=1` с корректной обрезкой неполного UTF-8/строки;
     * детект бинарника по NUL-байту (`0x00`);
     * листинг директории (сортировка: папки выше файлов, хлебные крошки, обработка недоступного/битого элемента без 500 ошибки);
     * ошибки `ENOENT` (404) и симлинк на файл/директорию.
     Проверяет поломку: падение листинга на битом файле, попытка отрисовать бинарник как текст, игнорирование `maxFileBytes`. Запуск: `npx vitest run tests/file-reader.test.ts` (ожидается FAIL).
   * **GREEN:** Реализовать `src/file-viewer/file-reader.ts`. Запуск: `npx vitest run tests/file-reader.test.ts` (ожидается PASS).
   * **REFACTOR:** Разделить чтение директории и чтение текстовых/фрагментных файлов.
4. [x] **Шаг 3: SSR-рендер HTML, подсветка кода, Markdown с защитой от XSS и адаптивный UI (`src/file-viewer/render-html.ts`)**
   * **RED:** Написать тесты в `tests/file-viewer-render.test.ts`:
     * подсветка кода генерирует кликабельные номера строк (`id="L1"`, `id="L2"`...) и HTML-экранирует `<script>` внутри исходного кода;
     * рендер Markdown через `marked` экранирует raw `<script>` / `onerror=` и нейтрализует `javascript:` ссылки;
     * рендер листинга директории строит навигационные ссылки на `/files?path=...` и хлебные крошки;
     * рендер экрана слишком большого / бинарного файла содержит ссылки на `?head=1`/`?tail=1`/`?download=1`;
     * присутствует адаптивный `viewport`, кнопки `Wrap`, `Raw`, `Copy`, `Download` без inline JS.
     Проверяет поломку: XSS через `.md` или `.ts` файл, отсутствие номеров строк, поломка навигации в папках. Запуск: `npx vitest run tests/file-viewer-render.test.ts` (ожидается FAIL).
   * **GREEN:** Реализовать `src/file-viewer/render-html.ts` и статические ассеты (`viewer.css`, `viewer.js`, чтение CSS темы из `highlight.js`). Запуск: `npx vitest run tests/file-viewer-render.test.ts` (ожидается PASS).
   * **REFACTOR:** Унифицировать общий HTML-каркас (шапка, хлебные крошки, тулбар).
5. [x] **Шаг 4: HTTP-обработчик `/files` и подключение в `createAcpWsBridge` (`src/file-viewer/handler.ts`, `src/bridge.ts`)**
   * **RED:** Написать HTTP-интеграционные тесты в `tests/file-viewer-http.test.ts` поверх реального `createAcpWsBridge`:
     * `GET /files?path=<file>` отдаёт HTML `200`, `Content-Security-Policy` без `unsafe-inline`;
     * `GET /files?path=<file>&raw=1` отдаёт `text/plain; charset=utf-8` и `X-Content-Type-Options: nosniff`;
     * `GET /files?path=<file>&download=1` отдаёт поток с `Content-Disposition: attachment`;
     * `GET /files/assets/viewer.css`, `highlight.css`, `viewer.js` отдаются со статусом `200` и правильным `Content-Type`;
     * `GET /files?path=<missing>` отдаёт `404`; `GET /unknown` по-прежнему отдаёт `404`;
     * `/ws` upgrade продолжает работать без изменений.
     Проверяет поломку: отдача 404 на `/files`, утечка `unsafe-inline` в CSP, поломка WebSocket `/ws`. Запуск: `npx vitest run tests/file-viewer-http.test.ts` (ожидается FAIL).
   * **GREEN:** Реализовать `src/file-viewer/handler.ts` и подключить к `createServer` в `src/bridge.ts`. Запуск: `npx vitest run tests/file-viewer-http.test.ts` (ожидается PASS).
   * **REFACTOR:** Выделить маршрутизацию статических ассетов и маппинг кодов ошибок ФС.
6. [x] **Шаг 5: Расширение `patchAcpUiHtml` перехватом `file://` и `.tool-locations > .location` (`src/patch-acp-ui.ts`)**
   * **RED:** Дополнить `tests/patch-acp-ui.test.ts` тестами (исполнение сгенерированного скрипта в `node:vm` с минимальным DOM/mock элементов или `jsdom`-подобным деревом):
     * переписывание `<a href="file:///root/app.ts#L10-L20">` на `/files?path=%2Froot%2Fapp.ts#L10-L20` с `target="_blank"`, `rel="noopener"` и `data-acp-file-linked="1"`;
     * превращение `.tool-locations > .location` (`📁 /root/app.ts` и относительного `📁 src/app.ts` при наличии `cwd`) в кликабельную ссылку `/files?path=...`;
     * сохранение идемпотентности при повторных проходах.
     Проверяет поломку: игнорирование `#L10-L20`, потеря `target="_blank"`, отсутствие ссылки в `ToolCallCard`. Запуск: `npx vitest run tests/patch-acp-ui.test.ts` (ожидается FAIL).
   * **GREEN:** Обновить `src/patch-acp-ui.ts`. Запуск: `npx vitest run tests/patch-acp-ui.test.ts` (ожидается PASS).
   * **REFACTOR:** Вынести построение пути для браузерного bootstrap-скрипта.
7. [x] **Шаг 6: Конфиг Nginx и обновление инструкций `/root/.gemini/AGENTS.md` на Ubuntu**
   * Обновить `deploy/nginx-acp-ui.conf` (добавить `location ^~ /files`).
   * Подготовить дополнение для `/root/.gemini/AGENTS.md` (всегда указывать кликабельные ссылки `file:///абсолютный/путь` на изменённые/созданные файлы).
   * Финальный прогон: `npm run typecheck && npm run build && npm test`.

---

## 5. Стратегия верификации и качество тестов

* **Стандарты тестов (`writing-good-tests`):**
  * *Name the Break:* каждый тест ловит конкретную поломку контракта (XSS-тег в `.md`/коде, потеря `#L10-L20`, попытка чтения >1 МБ целиком, битый элемент директории, отсутствие `nosniff` в `?raw=1`, непереписанная ссылка `file://`).
  * *Exercise the Real Thing:* тесты читают настоящие файлы и директории в `tmpdir()`, поднимают настоящий локальный HTTP+WS сервер `createAcpWsBridge`, и прогоняют настоящий bootstrap-JS в `node:vm`.
  * *Mutation Check:* гарантируется падение тестов при мутациях: отключение экранирования HTML в `marked`, удаление `CSP` заголовка, удаление `target="_blank"`, потеря `#L...`, чтение файла без проверки `maxFileBytes`, удаление `0x00`-проверки бинарников.
* **Команды верификации:**
  * Таргетный прогон: `npx vitest run tests/<file>.test.ts`
  * Полный сьют, сборка и типы: `npm run typecheck && npm run build && npm test`
* **Ручная сквозная проверка на Ubuntu (десктоп + телефон под Amnezia VPN):**
  1. Деплой обновлённого `/opt/web-agent`, повторный прогон `/opt/web-agent/scripts/build-acp-ui.sh`, обновление `/etc/nginx/sites-available/acp-ui` (`nginx -t && systemctl reload nginx`) и `systemctl restart acp-bridge`.
  2. Проверка на телефоне и ПК: клик по `file:///...#L...` в ответе чата и по пути в `ToolCallCard` открывает новую вкладку `/files?path=...`, подсветка кода/Markdown работает без внешнего интернета, кнопка `Wrap` переключает перенос строк, `Copy` копирует текст по HTTP, листинг директории позволяет перейти к соседнему файлу.
