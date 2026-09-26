# Project introduction page

The product page is a standalone static site in `docs/`. It requires no build,
package install, API, credentials, or application server. All preview transactions
are fictional. The site uses local CSS, JavaScript, and SVG assets, with system
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
| `docs/index.html` | Page sections, feature copy, sample UI, setup links, FAQ, metadata |
| `docs/assets/site.css` | Color tokens, typography, layout, mobile styles |
| `docs/assets/site.js` | Accessible preview tabs, including arrow-key navigation |
| `docs/assets/favicon.svg` | Existing application icon, with its license notice retained |
| `docs/assets/LICENSE-icons.txt` | Lucide / Feather license notices for adapted line icons |

The initial page is in English. Section anchors are `#features`, `#how-it-works`,
and `#get-started`. Add new content to these sections, or extend the navigation
when introducing a new section. Keep the preview clearly labeled as an illustration
and use only synthetic transactions or sanitized screenshots. Project links point
to `gtxistxgao/respect-money`; update the links, clone directory, README,
and expected Pages URL together if the repository is renamed or moved.

Current design: cool paper (`#f5f7fb`), navy text (`#202d46`), indigo actions
(`#5251ce`), and a dark ledger preview (`#111a2a`) with green income and amber
spending. Avenir/Segoe UI system typography gives the introduction a softer tone
than the dense application interface. The product preview is the visual centerpiece;
supporting features use open columns rather than repeated boxed cards.
