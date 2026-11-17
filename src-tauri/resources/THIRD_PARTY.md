# Bundled phone tools

The installers ship these unmodified third-party programs so no setup is needed on the computer:

- **Android platform-tools (adb)**, Google, Apache License 2.0 — `NOTICE.txt` inside each `platform-tools` folder.
- **libimobiledevice, libplist, libusbmuxd, libimobiledevice-glue** — LGPL-2.1 (libimobiledevice, libusbmuxd, libplist, glue). Source: https://github.com/libimobiledevice. Windows builds come from the MSYS2 `mingw-w64-x86_64-*` packages; macOS builds are the Homebrew binaries with library paths rewritten to be relative.
- **libmtp 1.1.23** (macOS, LGPL-2.1) and **libusb** (LGPL-2.1), Homebrew binaries with relative library paths, used to read phones that only offer file transfer. Windows uses the built-in Windows Portable Devices API instead.
- **OpenSSL 3** (Apache License 2.0), **libgcc / libwinpthread** (GCC runtime exception / MIT) — Windows only, licences in `windows/imobiledevice/licenses`.

iPhone detection on Windows also needs Apple's USB driver (Apple Mobile Device Support, installed by iTunes, Apple Devices or 3uTools). It cannot be redistributed here.
