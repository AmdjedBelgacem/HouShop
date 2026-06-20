# HouShop

My brother's starting his own electronics shop and I wanted to build him something solid to run it with, not another subscription SaaS he'd have to pay for every month. So I made this.

It's a desktop point of sale and inventory management app built with Tauri, so it runs natively on his machine and works completely offline. No cloud, no accounts, no monthly fees. Just install it and go.

## What it does

The main stuff you'd expect from a shop management tool:

- **Dashboard** — quick overview of sales, stock levels, top products, all that
- **Products** — add/edit products with images, variants (like different conditions or colors), barcodes, categories
- **Checkout** — the actual POS screen where you ring up sales, pick payment method (cash/card), optionally link a customer, set warranty periods, and print invoices
- **Customers** — keep track of regulars with their purchase history
- **Sales history** — every transaction logged with the ability to reprint invoices or dig into line-item details
- **Reservations** — customers can reserve items with a deposit and pick them up later
- **Inventory logs** — full trail of stock movements
- **Settings** — dark/light mode, language switcher (English, Arabic, French)

The invoice thing was important to me, it generates a clean printable invoice with the shop logo, itemized list, warranty info, and a signature line. All in whatever language the app is set to.

## Tech stack

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS
- **Backend**: Rust via Tauri (the app is a native desktop binary, not an Electron wrapper)
- **Database**: SQLite, everything lives in a local file on the machine, i might add support for external cloud solution later on.
- **i18n**: English, Arabic (RTL), and French

## Running it locally

You'll need Node.js and Rust installed.

```bash
# install frontend deps
npm install

# run in dev mode (hot reload)
npm run tauri dev

# build for production
npm run tauri build
```

The built app ends up in `src-tauri/target/release/` as a standalone executable.

## Project structure

```
src/                  → React frontend (pages, components, i18n, theme)
src-tauri/            → Rust backend (commands, database, models)
src-tauri/migrations  → SQLite schema migrations
```

That's pretty much it. It's a monolith, everything in one repo, one binary, one database file. Simple to back up, simple to move to another machine.

## Releasing updates

When you want to ship a new version:

1. Bump the version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and `src/hooks/useUpdateCheck.ts`
2. Tag it: `git tag v1.1.0 && git push --tags`
3. GitHub Actions builds the Windows installer and creates a Release automatically
4. Existing installs detect the new version on next launch and show an update banner
