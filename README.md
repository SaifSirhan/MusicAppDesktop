<div align="center">

# MusicApp Desktop

A clean **Docker-blue** desktop client for YouTube Music — a fork of [Pear Desktop](https://github.com/pear-devs/pear-desktop) (MIT).

[![Latest build](https://img.shields.io/badge/download-desktop--latest-1d63ed.svg?style=for-the-badge)](https://github.com/SaifSirhan/MusicAppDesktop/releases/tag/desktop-latest)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=for-the-badge)](./license)

</div>

> [!IMPORTANT]
> ⚠️ Disclaimer
>
> **No Affiliation**
>
> This project, and its contributors, are not affiliated with, authorized by, endorsed by, or in any way officially connected with Google LLC, YouTube, Spotify, or any of their subsidiaries or affiliates. **This is an independent, non-profit, and unofficial client developed to provide a desktop listening experience.**
>
> **Trademarks**
>
> The names "Google", "YouTube Music" and "Spotify", as well as related names, marks, emblems, and images, are registered trademarks of their respective owners. Any use of these trademarks is for identification and reference purposes only and does not imply any association with the trademark holder.
>
> **Limitation of Liability**
>
> This application is provided "AS IS", and you use it at your own risk. In no event shall the developers or contributors be liable for any claim, damages, or other liability, including any legal consequences, arising from, out of, or in connection with the software or the use or other dealings in the software. The responsibility for any and all outcomes of using this software rests entirely with the user.

## Features

- **Docker Blue** default accent (`#1D63ED`), plus **Phosphor** (green terminal) and the native look — switch under **Appearance**.
- **Spotify playlist import** — paste a public Spotify playlist link and its tracks are queued on YouTube Music (no Spotify login or developer API).
- Curated plugins out of the box: ad-blocking, precise volume, playback speed, shortcuts, taskbar media controls, notifications, plus a built-in performance plugin.
- Streams from `music.youtube.com` — instant playback, online only.

## Download

Windows x64 installer: **[MusicApp-Desktop.exe](https://github.com/SaifSirhan/MusicAppDesktop/releases/download/desktop-latest/MusicApp-Desktop.exe)**.

- The build is **unsigned**, so Windows SmartScreen may warn on first run — click **More info → Run anyway**.
- Reinstalling performs a clean install (the previous version's files are removed; your login/settings are kept).
- The app checks the `desktop-latest` release on launch and notifies you when a newer version is published.

## Develop

```bash
git clone https://github.com/SaifSirhan/MusicAppDesktop
cd MusicAppDesktop
pnpm install --frozen-lockfile
pnpm dev        # run in development
pnpm check      # lint + typecheck
pnpm test       # end-to-end (Playwright)
```

## Build & publish

```bash
pnpm dist:win         # Windows NSIS installer -> pack/MusicApp-Desktop.exe
pnpm release:desktop  # upload to the desktop-latest GitHub prerelease + verify the feed
```

## Plugin development

MusicApp Desktop keeps Pear Desktop's plugin system. For the plugin API, see the
[upstream documentation](https://github.com/pear-devs/pear-desktop#build-your-own-plugins).

## Credits & License

- Fork of **[Pear Desktop](https://github.com/pear-devs/pear-desktop)** by th-ch and contributors — MIT. See [license](./license) and [NOTICE](./NOTICE).
- MusicApp-specific changes © Saif Sirhan.
- Not affiliated with Google LLC, YouTube, or Spotify.
