# [RFC] Веб-интерфейс ACP (acp-ui + NDJSON-WS мост на Ubuntu)

## 1. Резюме решений

* **Проблема:** Нужна отдельная веб-страница для практического изучения протокола Agent Client Protocol (`agy acp`) на удалённом сервере Ubuntu (с доступом только через Amnezia VPN на `172.29.172.1`). Использование готового моста `@rebornix/stdio-to-ws@0.2.0` и немодифицированной сборки `formulahendry/acp-ui` напрямую на HTTP-IP создаёт три блокера: `stdio-to-ws` слушает `0.0.0.0`, отправляет сырые чанки `stdout` без построчной буферизации `\n` (ломает `JSON.parse` в `acp-ui` на крупных сообщениях), а в `acp-ui` вызовы `crypto.randomUUID()` падают в браузере по обычному `http://172.29.172.1:<port>/` (`isSecureContext === false`).
* **Границы задачи (MVP):**
  * Инициализация Node.js + TypeScript + Vitest каркаса в репозитории `web-agent`.
  * Собственный минимальный NDJSON-WebSocket мост (`127.0.0.1`), запускающий `agy acp` в выделенной песочнице без `--dangerously-skip-permissions` (интерактивные подтверждения `Allow`/`Deny` сохраняются).
  * Авторизация `agy acp` выполняется разово администратором на сервере через терминальный код (`agy acp --login`).
  * Скрипт/модуль сборки и патчинга веб-бандла `formulahendry/acp-ui` (`dist-web`): добавление полифила `crypto.randomUUID` (через `crypto.getRandomValues`) и начальное предзаполнение `localStorage['acp-ui:agents']` агентом `Antigravity` с динамическим URL `/ws`.
  * Конфигурация Nginx на `172.29.172.1:7682` (единая точка входа под Amnezia VPN: раздача `dist-web` и проксирование `/ws` на локальный порт моста) и `systemd`-юнит для моста.
* **Исключено из MVP (следующие срезы):**
  * Левая панель проводника файлов и центральный редактор кода / DiffEditor (полноценная 3-панельная веб-IDE).
  * Обёртка в `iframe` (используется самостоятельная веб-страница `acp-ui`).
  * Долгоживущий процесс `agy acp` с grace-period буфером при закрытии вкладки (вместо этого используется штатный `session/load` после реконнекта).
  * Программное ограничение `cwd` на стороне моста (передаётся прозрачно из UI) и дополнительная HTTP-авторизация поверх Amnezia VPN.

---

## 2. Контракты и схемы

### Конфигурация и типы моста (`src/config.ts`, `src/bridge.ts`)

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
}

export interface BridgeSpawnOptions {
    cwd: string;
    env: NodeJS.ProcessEnv;
}

export interface AcpPatchOptions {
    agentName: string;
    wsPath: string;
}
```

### Контракт NDJSON ↔ WebSocket

1. **WebSocket Handshake:**
   * Мост принимает апгрейд только по пути `config.wsPath` (по умолчанию `/ws`), остальные пути отклоняет с `404`.
   * Мост слушает исключительно `127.0.0.1` (по умолчанию порт `3001`, проксируется Nginx).
   * Согласование subprotocol: если браузер (`acp-ui`) передаёт `acp.v1`, сервер отвечает `acp.v1` через `handleProtocols`.
2. **Браузер → `agy acp` (`stdin`):**
   * Принимаются только текстовые WebSocket-фреймы (бинарные отклоняются закрытием с кодом `1003`).
   * Если входящий JSON-фрейм является JSON-RPC уведомлением без `id` с `method === "$/ping"`, мост **поглощает** его на своей стороне и не записывает в `child.stdin` (поддерживая активность соединения через трафик WS без лишнего шума в агенте).
   * Все прочие фреймы (включая `session/new` и `session/load` с `params.cwd` как есть) гарантированно завершаются `\n` перед записью в `child.stdin`.
3. **`agy acp` (`stdout`) → Браузер:**
   * Байты `child.stdout` декодируются инкрементально через `StringDecoder("utf8")` и накапливаются до разделителя `\n`.
   * Каждая завершённая непустая строка (без завершающих `\r`/`\n`) отправляется отдельным текстовым WebSocket-кадром (`1 WS frame = 1 JSON-RPC сообщение`).

### Патч веб-сборки `acp-ui` (`index.html` и `localStorage`)

1. **Полифил `crypto.randomUUID`:**
   * Внедряется в `<head>` файла `dist-web/index.html` до `<script type="module" ...>` только если `typeof crypto.randomUUID !== "function"`.
   * Генерирует UUID v4 на основе `crypto.getRandomValues(new Uint8Array(16))` (доступен в браузерах даже без Secure Context по `http://172.29.172.1:7682`).
2. **Начальное заполнение агента:**
   * Записывается в `localStorage` по ключу `acp-ui:agents` **только если ключ отсутствует** (пользовательские правки не перезаписываются):

```json
{
    "agents": {
        "Antigravity": {
            "transport": "websocket",
            "url": "ws://172.29.172.1:7682/ws"
        }
    }
}
```

* В рантайме браузера URL формируется динамически из `window.location`: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`.

### Контракт Nginx на Ubuntu (`172.29.172.1:7682`)

* `listen 172.29.172.1:7682;` (доступно исключительно через Amnezia VPN).
* `location /`: раздача `dist-web/` (`try_files $uri $uri/ /index.html;`).
* `location = /ws`:
  * `proxy_pass http://127.0.0.1:3001;`
  * `proxy_http_version 1.1;`
  * `proxy_set_header Upgrade $http_upgrade;`
  * `proxy_set_header Connection "upgrade";`
  * `proxy_read_timeout 3600s;`
  * `proxy_send_timeout 3600s;`
  * `proxy_buffering off;`

---

## 3. Обработка краевых случаев и отказов

* **Разрыв крупного JSON между `stdout`-чанками:** `NdjsonLineDecoder` использует `StringDecoder("utf8")` и буферизует данные до `\n`. Многобайтовые UTF-8 символы на границе чанков и ответы больше размера буфера ОС (>64 КБ) собираются в цельную строку до отправки в WebSocket.
* **Защита от переполнения памяти строкой без `\n`:** если длина буфера превышает `maxLineBytes` (по умолчанию 16 MiB), мост очищает буфер, логирует ошибку и закрывает клиентское соединение (`1009` / `1011`) с завершением дочернего процесса.
* **Закрытие вкладки / F5 / обрыв Amnezia VPN:** при событии `ws.on("close")` мост закрывает `child.stdin` и отправляет `SIGTERM` процессу `agy acp`. Если процесс не завершился за `shutdownGraceMs` (по умолчанию 3000 мс), отправляется `SIGKILL`. Повторное подключение к диалогу после восстановления VPN/перезагрузки выполняется пользователем в `acp-ui` через `session/load`.
* **Ошибка запуска или падение `agy acp` (`ENOENT`, неожиданный exit):**
  * Строки `child.stderr` транслируются в лог сервера (с указанием идентификатора подключения).
  * При ошибке `spawn` или неожиданном завершении дочернего процесса WebSocket закрывается с кодом `1011` и причиной выхода.
* **Отсутствие кешированной авторизации (`-32000`):** ошибка `Authentication required` от `agy acp` пробрасывается как штатный JSON-RPC ответ; `acp-ui` перехватывает код `-32000`, но основным путём на Ubuntu является разовый вход `agy acp --login` по SSH перед запуском сервиса.
* **Heartbeat `$/ping` и таймаут прокси:** `acp-ui` шлёт `$/ping` каждые 25 секунд; перехват в мосте предотвращает ненужные записи в `stdin` агента, а прохождение кадра до моста + `proxy_read_timeout 3600s` в Nginx не дают оборваться долгой генерации или паузе на `Allow`/`Deny`.
* **Идемпотентность патча `acp-ui`:** `patchAcpUiHtml` проверяет наличие маркера-атрибута `data-acp-web-bootstrap` перед вставкой в `<head>` и при повторном запуске не дублирует `<script>`.
* **Штатная остановка сервера моста (`SIGINT`/`SIGTERM`):** закрывает WebSocket-сервер и дожидается завершения всех активных дочерних процессов `agy acp`.

---

## 4. Пошаговый план реализации (TDD Flow)

1. [x] **Шаг 0: Инициализация Node.js + TypeScript + Vitest каркаса**
   * Создать `package.json` (зависимости: `ws`, dev-зависимости: `typescript`, `vitest`, `tsx`, `@types/node`, `@types/ws`), `tsconfig.json`, `vitest.config.ts`.
   * Проверка готовности раннера: `npx vitest run` (и `npx tsc --noEmit`).
2. [x] **Шаг 1: Построчный NDJSON-декодер (`NdjsonLineDecoder`)**
   * **RED:** Написать тест в `tests/ndjson-framer.test.ts` на склейку разорванных JSON-строк, разделение нескольких строк в одном чанке, разрыв многобайтового UTF-8 символа на границе `Buffer`, пропуск пустых строк/CR и ошибку при превышении `maxLineBytes`. Проверяет поломку: выдача неполного JSON, битый UTF-8 символ `\uFFFD` или отсутствие лимита буфера. Запуск: `npx vitest run tests/ndjson-framer.test.ts` (ожидается FAIL).
   * **GREEN:** Реализовать `NdjsonLineDecoder` в `src/ndjson-framer.ts`. Запуск: `npx vitest run tests/ndjson-framer.test.ts` (ожидается PASS).
   * **REFACTOR:** Вынести обработку лимита и сброс состояния при сохранении зелёных тестов.
3. [x] **Шаг 2: Фильтр и нормализация входящих WS-сообщений (`normalizeClientFrame`)**
   * **RED:** Написать table-driven тест в `tests/message-filter.test.ts`: пустые строки и уведомление `{"jsonrpc":"2.0","method":"$/ping"}` (без `id`) отбрасываются (`null`), JSON-RPC запрос с `id` (даже если `method: "$/ping"`) и обычный запрос `session/prompt` сохраняются с завершающим `\n`, невалидный JSON отклоняется исключением. Проверяет поломку: пропуск `$/ping` в `stdin`, потеря `$/ping` с `id` или отправка кадра без `\n`. Запуск: `npx vitest run tests/message-filter.test.ts` (ожидается FAIL).
   * **GREEN:** Реализовать `normalizeClientFrame` в `src/message-filter.ts`. Запуск: `npx vitest run tests/message-filter.test.ts` (ожидается PASS).
   * **REFACTOR:** Упростить разбор и проверки типов JSON-RPC кадра.
4. [x] **Шаг 3: Валидация конфигурации моста (`resolveBridgeConfig`)**
   * **RED:** Написать тест в `tests/config.test.ts` на дефолты (`host === "127.0.0.1"`, `wsPath === "/ws"`), отклонение не-loopback хоста или невалидного порта (`0`, `>65535`, `NaN`), отклонение пустой команды или отсутствующей `defaultCwd` через `throw new Error(...)`. Проверяет поломку: случайный бинд на `0.0.0.0` или пропуск битого порта/директории. Запуск: `npx vitest run tests/config.test.ts` (ожидается FAIL).
   * **GREEN:** Реализовать `resolveBridgeConfig` в `src/config.ts`. Запуск: `npx vitest run tests/config.test.ts` (ожидается PASS).
   * **REFACTOR:** Выделить общую валидацию строковых и числовых параметров.
5. [x] **Шаг 4: Интеграционный NDJSON-WS мост (`createAcpWsBridge`)**
   * **RED:** Написать интеграционные тесты в `tests/bridge.test.ts` с реальным локальным `WebSocketServer` (`port: 0`), реальным `WebSocket`-клиентом (subprotocol `["acp.v1"]`) и реальными дочерними `node -e` скриптами:
     * двусторонний обмен и склейка крупного ответа (>128 КБ) без потери/разрыва JSON;
     * поглощение `$/ping` (дочерний процесс его не получает);
     * прозрачный проброс `params.cwd` и передача `defaultCwd` процессу при старте;
     * закрытие соединения с `1011` при падении/незапуске дочернего процесса;
     * `SIGTERM` -> `SIGKILL` при закрытии WebSocket клиентом, в том числе на процессе, игнорирующем `SIGTERM`;
     * отказ 404 на пути, отличном от `/ws`, и отказ на бинарном WS-кадре (`1003`).
     Проверяет поломку: несогласование `acp.v1`, обрыв крупных чанков, утечка зомби-процессов при закрытии вкладки. Запуск: `npx vitest run tests/bridge.test.ts` (ожидается FAIL).
   * **GREEN:** Реализовать `createAcpWsBridge` в `src/bridge.ts`. Запуск: `npx vitest run tests/bridge.test.ts` (ожидается PASS).
   * **REFACTOR:** Разделить управление дочерним процессом и маршрутизацию WS-событий, обеспечить чистый `close()` сервера.
6. [x] **Шаг 5: Идемпотентный патчер `acp-ui` (`patchAcpUiHtml`)**
   * **RED:** Написать тесты в `tests/patch-acp-ui.test.ts` (с выполнением внедрённого `<script>` в реальном `node:vm` контексте):
     * инъекция в `<head>` перед первым `<script>`, ошибка `throw new Error(...)` при отсутствии `<head>`;
     * полифил `crypto.randomUUID()` создаёт валидный UUID v4 в insecure HTTP без нативного `randomUUID` и не затирает существующий нативный метод;
     * предзаполнение `localStorage['acp-ui:agents']` динамическим URL `ws://172.29.172.1:7682/ws` только когда ключ отсутствует;
     * идемпотентность: повторный вызов `patchAcpUiHtml` возвращает исходно пропатченный HTML без дублей.
     Проверяет поломку: падение `acp-ui` по HTTP, перезапись пользовательских агентов в `localStorage`, дублирование скрипта при пересборке. Запуск: `npx vitest run tests/patch-acp-ui.test.ts` (ожидается FAIL).
   * **GREEN:** Реализовать `patchAcpUiHtml` и CLI-обёртку в `src/patch-acp-ui.ts`. Запуск: `npx vitest run tests/patch-acp-ui.test.ts` (ожидается PASS).
   * **REFACTOR:** Вынести шаблон bootstrap-скрипта и проверку маркера.
7. [x] **Шаг 6: CLI точка входа, Ubuntu-деплой (Nginx, systemd, скрипт сборки `acp-ui`) и итоговая проверка**
   * Добавить точку входа `src/index.ts` (чтение env/флагов, обработка `SIGINT`/`SIGTERM`).
   * Создать артефакты развёртывания для Ubuntu: `scripts/build-acp-ui.sh` (клонирование/сборка `formulahendry/acp-ui` `npm run build:web` + применение патча), `deploy/nginx-acp-ui.conf` (`172.29.172.1:7682`) и `deploy/acp-bridge.service` (`systemd`, песочница, `agy acp`).
   * Финальный прогон: `npx tsc --noEmit && npx vitest run`.

---

## 5. Стратегия верификации и качество тестов

* **Стандарты тестов (`writing-good-tests`):**
  * *Name the Break:* каждый тест проверяет конкретную поломку контракта (разрыв JSON-чанка, нехватка `\n` в `stdin`, падение `randomUUID` по HTTP, зависший после закрытия сокета процесс), без зеркальных ожиданий и change-detector ассертов на текст конфигов.
  * *Exercise the Real Thing:* интеграционный тест моста использует настоящие локальные сокеты `ws`, настоящие pipe-потоки и настоящие дочерние `node`-процессы; патчер проверяется реальным выполнением вставленного JS в `node:vm`.
  * *Mutation Check:* гарантируется падение тестов при мутациях: отказ от `StringDecoder`, удаление `\n` на входе в `stdin`, проброс `$/ping` агенту, удаление `SIGKILL`-таймера, разрешение бинда `0.0.0.0`, перезапись непустого `localStorage['acp-ui:agents']`, удаление проверки `data-acp-web-bootstrap`.
* **Локальные команды верификации:**
  * Таргетный запуск: `npx vitest run tests/<file>.test.ts`
  * Полный регрессионный сьют: `npx vitest run`
  * Проверка типов: `npx tsc --noEmit`
* **Ручная сквозная проверка на сервере Ubuntu (после деплоя):**
  1. Установить `agy` на Ubuntu, выполнить разово `agy acp --login`, создать папку-песочницу `~/acp-sandbox`.
  2. Собрать фронтенд через `scripts/build-acp-ui.sh`, применить `deploy/nginx-acp-ui.conf` (`sudo nginx -t && sudo systemctl reload nginx`) и запустить мост через `deploy/acp-bridge.service`.
  3. Открыть `http://172.29.172.1:7682/` с подключённым Amnezia VPN: убедиться, что агент `Antigravity` предзагружен, `session/new` открывается, потоковый ответ и карточка `Allow`/`Deny` работают, а после `F5` процесс не остаётся в `ps` и диалог восстанавливается через `session/load`.
