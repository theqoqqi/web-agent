# [RFC] Собственный веб-интерфейс (web/) вместо patched acp-ui

## 1. Резюме решений

* **Проблема:** внешний клиент `formulahendry/acp-ui` требует хрупкого DOM-патчинга через `src/patch-acp-ui.ts` (перехват `file://`, полифил `crypto.randomUUID`, инъекция агента в `localStorage`), содержит ~2700 строк ненужных для веба настроек/диалогов, обрывает долгие запросы `session/prompt` жёстким таймаутом `60000` мс, теряет `modes`/`models` при `session/load`, имеет сырую тёмную тему, не скрывает длинную историю сообщений и агрессивно прокручивает экран вниз при стриминге ответа.
* **Границы задачи (Scope v1):**
  * Изолированный подпроект `web/` со своим `web/package.json` на стеке **React + TypeScript + Vite + Vitest**, собираемый в `web/dist/` и деплоящийся в `/opt/acp-web/dist-web` без изменения `root` в `deploy/nginx-acp-ui.conf`.
  * Перенос транспортного и протокольного ядра ACP over WebSocket (на базе MIT-реализации `formulahendry/acp-ui` с сохранением атрибуции лицензии).
  * Заимствование и адаптация UI-компонентов, стилей и утилит из `P:\WebStorm Projects\agent-cookie` (`packages/widget`: `Collapsible`, `AgentSteps`, `ToolCallLayout`, `ChatInputForm`, `ChatMessageItem`, `MarkdownContent.module.css`, `TypingIndicator`, `ErrorMessage`, `pluralize`).
  * Основной сценарий чата: стриминг текста (`agent_message_chunk`, `user_message_chunk`), `thought` (`agent_thought_chunk`), карточки `toolCalls` (`tool_call`, `tool_call_update`), пикеры модели и режима, автодополнение slash-команд (`/`), диалог подтверждения `session/request_permission` (`Allow` / `Deny`), список сессий в `localStorage` и восстановление через `session/load`.
  * Включённые UX-улучшения и исправления багов оригинала:
    * Дефолтный `cwd` = `/srv` (редактируется в UI и сохраняется в `localStorage`).
    * Автоматическая подгрузка старых сообщений при прокрутке вверх (`scrollTop <= threshold`) с сохранением позиции чтения (`scrollHeight` delta).
    * Умный автоскролл при стриминге (отключается при ручном скролле вверх, возвращается кнопкой «↓ Вниз» или при достижении низа).
    * Единая тёмная/светлая тема на CSS-переменных с ручным переключателем и сохранением выбора.
    * Подсветка кода (`highlight.js`) и кнопки «Копировать» на блоках кода и сообщениях с fallback на `document.execCommand("copy")` для HTTP без TLS.
    * Нативный рендер `file:///`-ссылок в Markdown (`marked`) и локаций `toolCalls` сразу в `/files?path=<encoded>` (`target="_blank" rel="noopener"`), без `MutationObserver`.
    * Понятное сообщение в чате при ошибке `-32000` (требуется авторизация агента на сервере).
    * Снятие 60-секундного таймаута с `session/prompt`, восстановление `modes`/`models` в `session/load`, UUID v4 fallback поверх `crypto.getRandomValues`, переподключение при `visibilitychange`/`pageshow`.
  * Удаление легаси после проверки нового `web/` на сервере: `src/patch-acp-ui.ts`, `scripts/build-acp-ui.sh`, `tests/patch-acp-ui.test.ts` и скрипт `patch:acp-ui` в корневом `package.json`.
* **Явно исключено (Non-goals v1):**
  * Изменения серверного моста `src/bridge.ts` (серверный `detached`-таймаут процесса `agy acp` и буферизация событий при кратковременном закрытии вкладки выносятся в отдельную следующую задачу).
  * Многоагентные настройки и отладочные экраны оригинала: `SettingsView`, `EnvVarEditor`, `AgentSelector`, `TrafficMonitor`, `StartupProgress`, `AuthMethodDialog`.
  * Изменение `deploy/acp-bridge.service` (остаётся `Environment=ACP_SANDBOX_DIR=/root/acp-sandbox` — учитывать при открытии файлов из `/srv` через `/files`, т.к. проверка корня вьювера задаётся там).

## 2. Контракты и схемы

### 2.1. Структура подпроекта `web/`

```text
web/
  package.json          # React 19/18, react-dom, marked, highlight.js, vite, vitest, @testing-library/react, jsdom
  tsconfig.json
  vite.config.ts        # dev-прокси /ws и /files на 127.0.0.1:3001, build -> dist/
  index.html
  src/
    main.tsx
    styles/
      tokens.css        # CSS-переменные light/dark тем
      global.css
    lib/
      uuid.ts           # crypto.randomUUID() с fallback на crypto.getRandomValues
      clipboard.ts      # navigator.clipboard.writeText с fallback на document.execCommand("copy")
      file-links.ts     # парсинг file:/// и локаций -> /files?path=...
      markdown.ts       # marked renderer + подсветка highlight.js + защита от опасных схем/HTML
      storage.ts        # чтение/запись localStorage (тема, последний cwd, сохранённые сессии)
      pluralize.ts      # русское склонение числительных (из agent-cookie/packages/widget)
    acp/
      types.ts          # JSON-RPC 2.0 и ACP типы контракта
      ws-transport.ts   # WebSocket (acp.v1, NDJSON \n-разделение, $/ping 25s, connect timeout)
      rpc-client.ts     # sendRequest/sendNotification, обработка incoming requests, без 60s timeout для session/prompt
      session-reducer.ts # чистый редьюсер состояния чата, стриминга, toolCalls, permissions, пагинации
    components/
      AppShell.tsx      # шапка (статус WS, тема, боковая панель сессий)
      SessionSidebar.tsx # список сохранённых сессий, создание новой с вводом cwd (по умолчанию /srv)
      ChatViewport.tsx  # контейнер сообщений, автоподгрузка вверх, умный автоскролл, кнопка «↓ Вниз»
      MessageItem.tsx   # рендер user/assistant (база ChatMessageItem из agent-cookie), thought, кнопка копирования
      Collapsible.tsx   # переиспользуемый аккордеон card/flat (из agent-cookie)
      AgentSteps.tsx    # группировка toolCalls с live-бейдем и сводкой «Выполнил N действий» (из agent-cookie)
      ToolCallItem.tsx  # карточка вызова инструмента на базе ToolCallLayout из agent-cookie + ссылки /files
      PromptComposer.tsx # textarea (field-sizing: content, Enter/Shift+Enter, Stop из ChatInputForm), slash-команды, пикеры model/mode
      TypingIndicator.tsx # индикатор ожидания начала ответа (из agent-cookie)
      ErrorMessage.tsx  # баннер ошибки, в т.ч. -32000 (из agent-cookie)
      PermissionModal.tsx # карточка/баннер подтверждения session/request_permission
  tests/
    uuid.test.ts
    clipboard.test.ts
    pluralize.test.ts
    file-links.test.ts
    markdown.test.ts
    ws-transport.test.ts
    rpc-client.test.ts
    session-reducer.test.ts
    chat-viewport.test.tsx
```

### 2.2. Протокольный контракт WebSocket + ACP JSON-RPC

Транспорт подключается к относительному пути `ws(s)://<host>/ws` с subprotocol `"acp.v1"`. Каждое исходящее сообщение завершается `"\n"`, входящие текстовые фреймы разделяются по `"\n"`. Каждые `25000` мс отправляется heartbeat `{"jsonrpc":"2.0","method":"$/ping"}\n` (поглощается в `src/message-filter.ts`).

```typescript
export type JsonRpcId = number | string;

export interface AcpClientCapabilities {
    fs: {
        readTextFile: false;
        writeTextFile: false;
    };
}

export interface AcpModelOption {
    modelId: string;
    name: string;
    description?: string;
}

export interface AcpModeOption {
    id: string;
    name: string;
    description?: string;
}

export interface AcpAvailableCommand {
    name: string;
    description: string;
    input?: {
        hint: string;
    };
}

export interface AcpToolCall {
    toolCallId: string;
    title?: string;
    kind?: string;
    status?: "pending" | "in_progress" | "completed" | "failed";
    content?: unknown[];
    locations?: Array<{
        path: string;
        line?: number;
    }>;
    rawInput?: unknown;
    rawOutput?: unknown;
}

export interface AcpPermissionOption {
    optionId: string;
    name: string;
    kind?: string;
}

export interface AcpPermissionRequestParams {
    sessionId: string;
    toolCall: AcpToolCall;
    options: AcpPermissionOption[];
}

export interface AcpPermissionResponse {
    outcome:
        | {
            outcome: "selected";
            optionId: string;
        }
        | {
            outcome: "cancelled";
        };
}

export type AcpSessionUpdatePayload =
    | {
        sessionUpdate: "user_message_chunk";
        content: {
            type: "text";
            text: string;
        };
    }
    | {
        sessionUpdate: "agent_message_chunk";
        content: {
            type: "text";
            text: string;
        };
    }
    | {
        sessionUpdate: "agent_thought_chunk";
        content: {
            type: "text";
            text: string;
        };
    }
    | {
        sessionUpdate: "tool_call";
        toolCallId: string;
        title?: string;
        kind?: string;
        status?: "pending" | "in_progress" | "completed" | "failed";
        locations?: Array<{
            path: string;
            line?: number;
        }>;
    }
    | {
        sessionUpdate: "tool_call_update";
        toolCallId: string;
        title?: string;
        status?: "pending" | "in_progress" | "completed" | "failed";
        content?: unknown[];
        locations?: Array<{
            path: string;
            line?: number;
        }>;
    }
    | {
        sessionUpdate: "current_mode_update";
        currentModeId: string;
    }
    | {
        sessionUpdate: "available_commands_update";
        availableCommands: AcpAvailableCommand[];
    };
```

### 2.3. Хранение состояния и конфигурация в `localStorage`

* Ключи:
  * `web-agent:theme`: `"dark" | "light"` (по умолчанию системная или `"dark"`).
  * `web-agent:last-cwd`: строка пути (дефолт при отсутствии: `"/srv"`).
  * `web-agent:sessions`: массив метаданных `{ sessionId: string; cwd: string; title: string; updatedAt: number }` (без хранения мегабайтов полного текста в `localStorage`; сообщения загружаются агентом через `session/load`).
* Правила переходов состояния (`session-reducer.ts`):
  * Дефолтное видимое окно сообщений: `visibleCount = 20`, шаг подгрузки `LOAD_MORE_STEP = 20`.
  * При отправке нового пользовательского сообщения или переключении сессии окно сбрасывается к последним `20` сообщениям (если сообщений меньше `20`, показываются все).
  * При ответе `session/new` и `session/load` одинаково обновляются `modes` и `models` (исправление бага оригинала, где `session/load` их не считывал).
  * На запросы `fs/read_text_file` и `fs/write_text_file` от агента клиент отвечает JSON-RPC ошибкой `-32601` (`Method not found`).

### 2.4. Деплой и Nginx

* `deploy/nginx-acp-ui.conf` сохраняет без изменений `root /opt/acp-web/dist-web;`, `location = /index.html` с `Cache-Control: no-store, no-cache, must-revalidate` и `location /ws`.
* Сборка `web/` (`npm --prefix web run build`) генерирует статику в `web/dist/`, откуда артефакты копируются в `/opt/acp-web/dist-web/` скриптом деплоя (или командой сборки на сервере).

### 2.5. Заимствования из `P:\WebStorm Projects\agent-cookie`

* **Что переносим (с адаптацией под React и ACP):**
  * `packages/widget/src/components/Collapsible.tsx` + `.module.css`: аккордеон (`card` и `flat`) с шевроном.
  * `packages/widget/src/components/AgentSteps.tsx` + `.module.css`: группировка вызовов инструментов со статусом работы, счётчиком `pluralize`, состоянием `manualOpen ?? autoOpen` и сворачиванием при появлении текста ответа (`autoOpen = isGenerating && !hasText`).
  * `packages/widget/src/components/tools/ToolCallLayout.tsx` + `.module.css`: раскладка элемента вызова инструмента (иконка статуса, заголовок, мета-строка, сводка справа, раскрываемое тело/ошибка), дополненная рендером `toolCall.locations` как ссылок на `/files?path=...`.
  * `packages/widget/src/components/ChatInputForm.tsx` + `.module.css`: база для `PromptComposer.tsx` (поле ввода с `field-sizing: content` и `max-height`, `Enter` / `Shift+Enter`, кнопка Send/Stop, `onMouseDown` без потери фокуса).
  * `packages/widget/src/components/ChatMessageItem.tsx` + `.module.css`, `MarkdownContent.module.css`, `TypingIndicator.tsx`, `ErrorMessage.tsx`: визуальная структура пузырей сообщений, типографика Markdown (заголовки, цитаты, таблицы со скроллом, инлайн-код, блоки `pre`), индикатор ожидания и баннер ошибок.
  * `packages/widget/src/utils/pluralize.ts` и подход из `packages/widget/src/storage/thread-storage.ts` (`try/catch` вокруг `localStorage`).
* **Что изменяем при переносе / НЕ берём:**
  * Заменяем импорты `preact` / `preact/hooks` / `lucide-preact` на `react` (и SVG / `lucide-react`).
  * Переносим захардкоженные светлые hex-цвета (`#f1f5f9`, `#e2e8f0`, `#f8fafc`, `#eff6ff`) из CSS-модулей `agent-cookie` в CSS-переменные `tokens.css` с поддержкой светлой и тёмной тем; селектор `:host` меняем на `:root` / `[data-theme="dark"]`.
  * Не берём `ChatMessageList.tsx` (наивный `scrollIntoView` на каждое сообщение), SSE-клиент `packages/shared/src/client/chat-stream.ts` и `MarkdownContent.tsx` на `react-markdown` (вместо него `marked` + `highlight.js` + `/files?path=...`).

## 3. Обработка краевых случаев и отказов

* **Долгая генерация и `60000` мс таймаут:**
  * Проблема оригинала: `sendRequest()` ставил общий таймаут `60000` мс на любой JSON-RPC вызов, обрывая длинный `session/prompt`.
  * Решение: `rpc-client.ts` принимает `timeoutMs?: number` (например, `15000` мс для `initialize`, `30000` мс для `session/new`/`session/load`, и `null` / без таймаута для `session/prompt` — пока WebSocket открыт, запрос ждёт `PromptResponse` или явный `session/cancel`).
* **Обрыв сети / выгрузка вкладки браузером (`visibilitychange`, `pageshow`):**
  * При потере соединения все pending-запросы отклоняются с понятной ошибкой соединения, статус в шапке меняется на `disconnected`.
  * При возврате на вкладку (`document.visibilityState === "visible"` или `pageshow`), если сокет не в `OPEN`/`CONNECTING`, клиент инициирует переподключение, выполняет `initialize` и при наличии `activeSessionId` и `agentCapabilities.loadSession` вызывает `session/load`.
  * Серверный `detached`-таймаут на стороне `src/bridge.ts` остаётся в рамках следующей задачи; клиент обрабатывает штатный сценарий доступными средствами протокола.
* **Ошибка `-32000` (требуется авторизация агента):**
  * При получении JSON-RPC ошибки с кодом `-32000` от `initialize` / `session/new` / `session/load` UI не пытается бесконечно переподключаться в цикле, а выводит баннер/сообщение об ошибке с текстом сервера и подсказкой проверить авторизацию `agy` на VPS.
* **Insecure HTTP (`http://172.29.172.1:7682`, `isSecureContext === false`):**
  * Генератор UUID (`lib/uuid.ts`): использует `crypto.randomUUID()`, при отсутствии — `crypto.getRandomValues(new Uint8Array(16))` для формирования RFC 4122 UUID v4 (и финальный fallback только если Web Crypto полностью недоступен).
  * Буфер обмена (`lib/clipboard.ts`): сначала пробует `navigator.clipboard?.writeText`, при отказе или отсутствии — создаёт временный `textarea` с `readonly`, `select()`, `document.execCommand("copy")` и удаляет его.
* **Безопасность Markdown и `file://` ссылок (`lib/file-links.ts`, `lib/markdown.ts`):**
  * HTML из сообщений агента в `marked` экранируется/не исполняется напрямую как сырой `<script>` / `on*` атрибуты; разрешены безопасные схемы (`http:`, `https:`, `mailto:`, относительные `/files?...`). Схемы `javascript:` / `data:` блокируются.
  * Все ссылки `file:///...` и пути в `toolCall.locations` преобразуются в `/files?path=<encodeURIComponent(path)>` (при наличии `#L<line>` / `line` сохраняется якорь `#L<line>`) с атрибутами `target="_blank" rel="noopener noreferrer"`.
* **Автоподгрузка старых сообщений при скролле вверх и умный автоскролл (`ChatViewport.tsx`):**
  * Автоскролл вниз активен только пока пользователь находится у нижней границы (`scrollHeight - scrollTop - clientHeight <= 48` px) или только что сам отправил запрос. Как только пользователь прокрутил вверх, флаг `autoScroll` выключается и появляется плавающая кнопка «↓ Вниз».
  * Автоподгрузка вверх срабатывает при `scrollTop <= 64` px и `hiddenCount > 0` с защитой от повторного срабатывания до завершения рендера: перед увеличением `visibleCount` запоминается `prevScrollHeight`, после перерисовки `useLayoutEffect` корректирует `scrollTop += newScrollHeight - prevScrollHeight`, чтобы текст перед глазами не прыгал.
* **Пустой ввод / некорректный JSON / невалидный `localStorage`:**
  * Битый JSON в `localStorage` безопасно сбрасывается к дефолтам (`cwd = "/srv"`, пустой список сессий) без падения React-дерева.
  * Непарсимые строки из WebSocket логируются в консоль и пропускаются без падения цикла чтения соседних `\n`-строк.

## 4. Пошаговый план реализации (TDD Flow)

> Коммиты выполняются только после явного подтверждения пользователя на указанных контрольных точках.

1. [x] **Шаг 1: Инициализация подпроекта `web/` и утилит среды (`uuid`, `clipboard`, `storage`, `pluralize`)**
    * *Инфраструктура:* создать `web/package.json` (без trailing-запятых), `web/tsconfig.json`, `web/vite.config.ts` (прокси `/ws`, `/files`), `web/index.html`.
    * **RED:** падающие тесты в `web/tests/uuid.test.ts` (формат v4 при отсутствии `crypto.randomUUID`), `web/tests/clipboard.test.ts` (fallback на `execCommand` когда `navigator.clipboard` недоступен/отклоняет промис), `web/tests/storage.test.ts` (дефолт `/srv` и восстановление при битом JSON в `localStorage`) и `web/tests/pluralize.test.ts` (склонение 1/2/5/11-19). Запуск: `npm --prefix web test` (ожидается FAIL).
    * **GREEN:** минимальная реализация `web/src/lib/uuid.ts`, `web/src/lib/clipboard.ts`, `web/src/lib/storage.ts`, перенос `web/src/lib/pluralize.ts` из `agent-cookie`. Запуск: `npm --prefix web test` (ожидается PASS).
    * **REFACTOR:** приведение хелперов к единому стилю (отступы 4 пробела, Stepdown Rule, без лишних комментариев).
2. [x] **Шаг 2: Ссылки `/files` и безопасный рендер Markdown с подсветкой кода**
    * **RED:** падающие тесты в `web/tests/file-links.test.ts` (конвертация `file:///srv/a.ts#L12`, Windows/POSIX путей и `toolCall.locations` в `/files?path=...#L12`, сохранение обычных `https://` и запрет `javascript:`) и `web/tests/markdown.test.ts` (подсветка кода `highlight.js`, кнопка копирования или разметка блока кода, нейтрализация `<script>`/`onerror=`). Запуск: `npm --prefix web test` (ожидается FAIL).
    * **GREEN:** минимальная реализация `web/src/lib/file-links.ts` и `web/src/lib/markdown.ts`. Запуск: `npm --prefix web test` (ожидается PASS).
    * **REFACTOR:** вынесение общих правил нормализации URL, проверка Stepdown Rule.
    * *Контрольная точка 1 (для возможного коммита по запросу пользователя): каркас `web/` и базовые утилиты.*
3. [x] **Шаг 3: WebSocket-транспорт (`ws-transport.ts`) и JSON-RPC клиент (`rpc-client.ts`)**
    * **RED:** падающие тесты в `web/tests/ws-transport.test.ts` (подключение с subprotocol `"acp.v1"`, склейка/сплит `\n`-фреймов, heartbeat `$/ping` каждые 25s, коннект-таймаут) и `web/tests/rpc-client.test.ts` (корреляция id, отсутствие 60s таймаута для `session/prompt` при 60s таймауте/отсечке обычных запросов, ответ `-32601` на `fs/read_text_file`, обработка `-32000`, передача входящих `session/request_permission` и `session/update`). Запуск: `npm --prefix web test` (ожидается FAIL).
    * **GREEN:** минимальная реализация `web/src/acp/types.ts`, `web/src/acp/ws-transport.ts`, `web/src/acp/rpc-client.ts`. Запуск: `npm --prefix web test` (ожидается PASS).
    * **REFACTOR:** унификация обработки таймаутов и reject при закрытии сокета.
4. [x] **Шаг 4: Чистый редьюсер состояния чата и сессий (`session-reducer.ts`)**
    * **RED:** падающие тесты в `web/tests/session-reducer.test.ts`: склейка стриминговых чанков (`agent_message_chunk`, `agent_thought_chunk`), обновление `tool_call` -> `tool_call_update` по `toolCallId`, извлечение `modes`/`models` как из `session/new`, так и из `session/load`, обновление `availableCommands`, очередь `pendingPermissions`, расчёт окна `visibleMessages` / `hiddenCount` и инкремент подгрузки `LOAD_MORE_HISTORY`. Запуск: `npm --prefix web test` (ожидается FAIL).
    * **GREEN:** минимальная реализация `web/src/acp/session-reducer.ts`. Запуск: `npm --prefix web test` (ожидается PASS).
    * **REFACTOR:** выделение чистых селекторов и обработчиков `session/update` по вариантам.
    * *Контрольная точка 2 (для возможного коммита по запросу пользователя): транспорт и state-ядро ACP.*
5. [x] **Шаг 5: UI-компоненты, темы, автоподгрузка скролла и интеграция приложения**
    * **RED:** падающие компонентные тесты в `web/tests/chat-viewport.test.tsx` (рендер последних 20 сообщений, автоподгрузка при `scrollTop <= threshold` с сохранением позиции скролла, отключение автоскролла при прокрутке вверх и возврат кнопкой «↓ Вниз», клик по локации `toolCall` ведёт на `/files?path=...`, ручное раскрытие `AgentSteps` не сбрасывается стримом). Запуск: `npm --prefix web test` (ожидается FAIL).
    * **GREEN:** реализация CSS-токенов тем (`tokens.css`, `global.css`, типографика из `MarkdownContent.module.css` без хардкодных hex), перенос/адаптация компонентов из `agent-cookie` (`Collapsible.tsx`, `AgentSteps.tsx`, `ToolCallItem.tsx`, `MessageItem.tsx`, `TypingIndicator.tsx`, `ErrorMessage.tsx`, база ввода в `PromptComposer.tsx`) и сборка остальных компонентов (`AppShell.tsx`, `SessionSidebar.tsx`, `ChatViewport.tsx`, `PermissionModal.tsx`, `main.tsx`) с `visibilitychange`/`pageshow` реконнектом и обработкой `-32000`. Запуск: `npm --prefix web test` и `npm --prefix web run build` (ожидается PASS).
    * **REFACTOR:** декомпозиция крупных JSX-блоков, проверка отсутствия дублирования.
    * *Контрольная точка 3 (для возможного коммита по запросу пользователя): готовый UI в `web/`.*
6. [x] **Шаг 6: Обновление деплоя, проверка на сервере и удаление легаси-патчера**
    * Замена `scripts/build-acp-ui.sh` или добавление шага сборки/деплоя `web/dist` -> `/opt/acp-web/dist-web` (с сохранением `deploy/nginx-acp-ui.conf` без изменения `root`).
    * Проверка сборки и работы нового UI на сервере (чат, стриминг, темы, автоподгрузка вверх, умный автоскролл, `/files` ссылки, копирование по HTTP, `session/load`).
    * После успешной проверки на проде: удаление `src/patch-acp-ui.ts`, `scripts/build-acp-ui.sh`, `tests/patch-acp-ui.test.ts` и скрипта `patch:acp-ui` из корневого `package.json`.
    * *Контрольная точка 4 (для возможного коммита по запросу пользователя): интеграция деплоя и удаление легаси.*

## 5. Стратегия верификации и качество тестов

* **Стандарты тестов (`writing-good-tests`):**
  * *Name the Break:* каждый тест привязан к конкретной поломке (например, обрыв долгого `session/prompt` на 60s, потеря `modes` после `session/load`, прыжок `scrollTop` при подгрузке вверх, запуск `javascript:` в Markdown, падение `randomUUID` без HTTPS).
  * *Exercise the Real Thing:* проверяется реальный редьюсер, реальный парсер `marked` + `highlight.js` и реальный DOM в `jsdom`/`@testing-library/react`; мокаются только внешние границы браузера (`WebSocket`, `navigator.clipboard`, `crypto.randomUUID` в тестах fallback-ветки).
  * *Mutation Check:* изменение константы таймаута, удаление `scrollHeight` компенсации, откат `file://` трансформации или удаление санитизации сразу валят соответствующий тест.
* **Команды верификации:**
  * Тесты клиента `web/`: `npm --prefix web test`
  * Проверка типов и сборка клиента: `npm --prefix web run typecheck && npm --prefix web run build`
  * Тесты и типы серверного моста (регрессия корня): `npm run typecheck && npm test`
