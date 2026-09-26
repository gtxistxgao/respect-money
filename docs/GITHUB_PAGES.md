# Project introduction page

The product page is a standalone static site in `docs/`. It requires no build,
package install, API, credentials, or application server. All preview transactions
are fictional. The site uses local CSS, JavaScript, SVG, and PNG assets, with system
fonts and no external analytics or CDN dependencies.

## Enable GitHub Pages manually

In the repository on GitHub:

1. Open **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Select **main** and **/docs**, then **Save**.
4. Wait for GitHub's Pages deployment to finish. Use the site URL shown in Settings.

For the planned public repository `gtxistxgao/respect-money`, the expected address is
`https://gtxistxgao.github.io/respect-money/`.
Create the new public repository and publish the reviewed source there first.
This is the expected address after activation, not confirmation of a live deployment.
The source follows GitHub's [publishing-source instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

`docs/.nojekyll` tells Pages to serve the static files without Jekyll processing.
The source is the entire `docs/` directory, so its technical Markdown documents
will also be publicly accessible when the site is public. Nothing reads or copies
the local `data/` directory. Repository visibility and Pages activation are managed
manually by the owner. Before publication, review [Security](../SECURITY.md) and
the dated [publication review](PUBLICATION_REVIEW.md). A license decision is
separate from Pages activation.

## Preview locally

From the repository root, with Python 3 installed:

```sh
python3 -m http.server 4178 --bind 127.0.0.1 --directory docs
```

Open `http://127.0.0.1:4178`. Stop the preview with `Ctrl+C`.
Opening `docs/index.html` directly also works. Relative asset paths support the
GitHub Pages project subdirectory without a separate base-path configuration.

## Extend the page

| File | Purpose |
| --- | --- |
| `docs/index.html` | Page sections, feature copy, screenshot gallery, setup links, FAQ, metadata |
| `docs/assets/site.css` | Color tokens, typography, layout, mobile styles |
| `docs/assets/site.js` | Accessible preview tabs, including arrow-key navigation |
| `docs/assets/favicon.svg` | Existing application icon, with its license notice retained |
| `docs/assets/screenshots/` | Manually reviewed desktop captures from the running demo |
| `scripts/demo-server.ts` | Fictional database and local demo server |
| `docs/assets/LICENSE-icons.txt` | Lucide / Feather license notices for adapted line icons |

The initial page is in English. Section anchors are `#features`, `#how-it-works`,
and `#get-started`. Add new content to these sections, or extend the navigation
when introducing a new section. Keep previews labeled as actual application
screenshots with fictional data. Never substitute hand-built mock interfaces or
capture the owner's ledger. Project links point
to `gtxistxgao/respect-money`; update the links, clone directory, README,
and expected Pages URL together if the repository is renamed or moved.

Keep marketing copy aligned with the README: the application is free to run,
its ledger is stored locally, and AI classification/reclassification uses the
user's Codex model service. Explain Plaid's free Trial limit as 10 Items rather
than 10 unique institutions, with eligibility and slot-reuse limits linked to
Plaid's documentation. The page includes a six-step onboarding flow, production
startup commands, optional tmux instructions, and the future local-model roadmap.
Do not describe current AI processing as fully offline or planned model support
as already available.

Current design: cool paper (`#f5f7fb`), navy text (`#202d46`), indigo actions
(`#5251ce`), and screenshots of the application's own dark interface.
Avenir/Segoe UI system typography gives the introduction a softer tone
than the dense application interface. The product preview is the visual centerpiece;
supporting features use open columns rather than repeated boxed cards.

## Run the demo and take screenshots

Run these commands from the public repository checkout:

```sh
npm ci
npm run demo
```

Open `http://127.0.0.1:4191/settings#language` and choose English. The command
builds the application and creates a fresh fictional database in an ignored
`data/demo-*/` directory. The terminal prints the exact database path. The
server uses test doubles for Plaid and AI and disables Codex execution. It never
opens your regular ledger or reads saved credentials. Keep port 4191 available.
Press Ctrl+C to stop the server; the demo database remains for local inspection.
Only the seed script is committed, never the generated SQLite files.

Use the running app in a desktop browser to open and visually check each view:

| Screenshot | Demo route |
| --- | --- |
| Monthly overview | `/overview?month=2026-08&period=all` |
| Transaction ledger | `/?month=2026-08` |
| Wealth | `/wealth` |
| Reclassification | `/settings#reclassification` |

Capture each screen after its data and fonts finish loading. The current images
use a 1440-pixel-wide desktop browser at 2× pixel density. Overview, Accounting,
and Wealth are full-page captures. Reclassification is a viewport capture after
scrolling to that section, retaining the real Settings navigation.

Save the reviewed PNGs as `docs/assets/screenshots/demo-{overview,ledger,wealth,rules}.png`
and update their intrinsic `width` and `height` in `docs/index.html`. Do not
redraw the application UI or alter its layout for screenshots.

The gallery uses these same complete desktop screenshots at every screen size.
There is no separate mobile screenshot or responsive recreation of the app.
Images scale proportionally without cropping; tapping the image or its full-size
link opens the original for zooming. Check the page in narrow portrait and
landscape layouts, including a WebKit browser, before publishing. The four tabs
retain keyboard navigation. The static page does not call the demo server.
