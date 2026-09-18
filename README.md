<img width="1266" height="793" alt="image" src="https://github.com/user-attachments/assets/22acfaea-fc9c-443d-9130-fdb429458d70" />


# Lolzteam Launcher

[![Stars](https://img.shields.io/github/stars/iamextasy/Lolzteam-Launcher?style=flat&label=Stars&color=2BAD72&labelColor=1f1f1f)](https://github.com/iamextasy/Lolzteam-Launcher/stargazers)
[![Forks](https://img.shields.io/github/forks/iamextasy/Lolzteam-Launcher?style=flat&label=Forks&color=2BAD72&labelColor=1f1f1f)](https://github.com/iamextasy/Lolzteam-Launcher/network/members)
[![Release](https://img.shields.io/github/v/release/iamextasy/Lolzteam-Launcher?style=flat&label=Release&color=2BAD72&labelColor=1f1f1f)](https://github.com/iamextasy/Lolzteam-Launcher/releases)

Десктопный лаунчер для покупателей на [lzt.market](https://lzt.market) - вход в купленные аккаунты в один клик.

Поддерживает **Steam**, **Telegram**, **Instagram**, **Discord**, **ИИ-сервисы** (Claude, ChatGPT, Grok, Cursor) и **EA Desktop** (Windows).

> При входе в Steam лаунчер сначала пробует код Steam Guard через `guard-code` API маркета — это **не сбрасывает гарантию** товара.
> Скачивание maFile (например, для привязки SDA-аутентификатора) гарантию сбрасывает, поэтому лаунчер всегда спросит подтверждение перед этим.

## Установка

Сборки лежат на странице [Releases](https://github.com/iamextasy/Lolzteam-Launcher/releases).

**Windows** — скачайте установщик `.exe` и запустите.

> Windows SmartScreen может предупредить о неизвестном издателе (сборка не подписана цифровым сертификатом).
> Нажмите **Подробнее → Выполнить в любом случае**, чтобы продолжить.

**Linux** — `.AppImage` (любой дистрибутив) или `.deb` (Debian, Ubuntu и производные).

```bash
chmod +x Lolzteam-Launcher-*.AppImage && ./Lolzteam-Launcher-*.AppImage
# или
sudo apt install ./lolzteam-launcher_*_amd64.deb
```

> AppImage требует `libfuse2`. Если при запуске появляется «AppImages require FUSE to run», установите пакет
> (`sudo apt install libfuse2` / `sudo pacman -S fuse2`) или запустите с флагом `--appimage-extract-and-run`.

Вход в клиент Steam и Telegram Desktop на Linux работает так же, как на Windows: Steam находится в `~/.local/share/Steam`,
Telegram — установленный в системе `telegram-desktop` (путь можно переопределить в настройках). Клиент Telegram запускается
с отдельной папкой сессий, поэтому ваш обычный Telegram не затрагивается.

**macOS** — скачайте `.dmg` (Apple Silicon или Intel) и перетащите приложение в «Программы».

> Сборка не подписана сертификатом Apple Developer, поэтому при первом запуске Finder покажет предупреждение.
> Нажмите **Правой кнопкой → Открыть → Открыть** (или Системные настройки → Конфиденциальность и безопасность → «Открыть всё равно»).

Steam ищется в `/Applications/Steam.app` (данные — в `~/Library/Application Support/Steam`), Telegram Desktop — как
`Telegram Desktop.app`. Telegram из App Store (`Telegram.app`, Swift-версия) для нативного входа не подходит — хранит
сессии в собственном формате; используйте [Telegram Desktop](https://github.com/telegramdesktop/tdesktop/releases) или
вход через браузер. Токен lzt.market хранится в связке ключей (Keychain).

Токен lzt.market хранится через системное хранилище паролей (KWallet или GNOME Keyring / Secret Service). Если его нет,
лаунчер держит токен только в памяти и попросит войти заново при следующем запуске.

## Сборка из исходников

Требуется [Node.js](https://nodejs.org) ≥ 20.18 и [pnpm](https://pnpm.io) 10.

Если `pnpm` не установлено, установите его через npm:

```bash
npm install -g pnpm
```

или включите Corepack (если он доступен):

```bash
corepack enable pnpm
```

```bash
pnpm install
pnpm dev      # запуск в режиме разработки
pnpm dist     # сборка для текущей ОС: установщик Windows, AppImage + deb или dmg (папка release/)
```

## Стек

Electron 33 · React 19 · TypeScript · electron-vite · TanStack Query · Zustand · pnpm workspaces

## Безопасность

Лаунчер работает с конфиденциальными данными аккаунтов. Как они защищены — см. [SECURITY.md](SECURITY.md).

## Лицензия

[MIT](LICENSE)
