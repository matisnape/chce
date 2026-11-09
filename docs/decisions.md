# chce — MVP decisions

Decided 2026-11-09 in a grilling session. Background on the original site: [research/chce-to-wayback.md](research/chce-to-wayback.md).

## TL;DR

- A rebuild of the core of chce.to (a 2008–2014 Polish wishlist site) as a **single private-ish wishlist** at `anks.pl/chce`.
- **Static site on GitHub Pages**, plain JavaScript with no build step. List data lives in **Firestore**, never in this public repo.
- Guests open the list with **one shared password**; the owner edits after **Google sign-in**.
- Items come in through a **bookmarklet** on desktop and a **Cloudflare Worker** that fetches a pasted link on the phone.
- Everything social from the original (reservations, comments, friends, notifications) is cut.

## Glossary

- **Bookmarklet**: a browser bookmark whose URL is JavaScript. Clicking it runs the script on the page you are viewing, so it can read that page's title, images and price.
- **Firestore**: Google's hosted document database, part of Firebase. The free tier is called the **Spark plan**.
- **Security rules**: Firestore's server-side access rules. They are the only real protection here, because the site's code is public.
- **Cloudflare Worker**: a small function running on Cloudflare's servers. Free plan: 100,000 requests a day.
- **og:image / og:title**: Open Graph `<meta>` tags shops add for link previews.
- **JSON-LD**: structured data (`<script type="application/ld+json">`) shops add for search engines; often carries `offers.price`.
- **CORS**: the browser rule that stops one site's script from reading another site's pages. It is why a static page cannot fetch a shop page by itself.
- **noindex**: a `<meta name="robots" content="noindex">` tag asking search engines not to list the page.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Address | `anks.pl/chce`, served by GitHub Pages from repo `matisnape/chce` | `anks.pl` already serves from `matisnape.github.io`, so a project repo named `chce` appears at `/chce` for free |
| 2 | Repo visibility | Public | Pages on a private repo needs GitHub Pro. Nothing sensitive lives in the repo |
| 3 | Where data lives | Firestore, Spark plan | Free (50k reads, 20k writes a day, 1 GiB), no inactivity pause, auth and rules included |
| 4 | Sensitive notes | Owner's private `anks_docs` repo, never this repo | This repo is public |
| 5 | Who sees the list | Anyone with the link **and** the shared guest password; page carries `noindex` | A gift list is for people you send it to, not for search engines |
| 6 | Guest password | A single shared Firebase Auth guest account; typing the password signs it in, and Firebase keeps the session in the browser | Real enforcement in security rules, password typed once per browser |
| 7 | Owner sign-in | Google sign-in; rules allow writes only for the owner's account | No extra password to remember |
| 8 | Users | One list, one owner | MVP scope. Keep the data model able to hold more lists later without a rewrite |
| 9 | Structure | Named tabs, each with an optional description; no tags | Matches the original's model |
| 10 | Order | Manual, drag and drop, inside each tab | The owner ranks what she wants most |
| 11 | Already-have | An ordinary tab called "Już mam", visible to guests | Same as the original; no special status needed |
| 12 | Item fields | Photo, title, description, price, shop link, price-comparison links | Comparison links as in the original ("Znajdź w:") |
| 13 | Price | Filled by the bookmarklet or Worker when found (`og:price:amount`, `product:price:amount`, JSON-LD `offers.price`), editable by hand, saved once, never refreshed | The cheapest useful hint for a gift buyer |
| 14 | Photo | Bookmarklet offers up to 8 of the page's largest images, `og:image` first; the owner picks one | `og:image` is often a banner or logo |
| 15 | Image storage | Store the shop's image URL only | Cloud Storage for Firebase needs the paid Blaze plan. Known risk: CDN links expire or vanish, so the owner can replace the URL by hand |
| 16 | Desktop add | Bookmarklet opens a popup on `anks.pl/chce`, passes page data in the popup URL hash (not `postMessage`), owner picks tab and image, saves | A static page cannot receive the POST the original used. The hash survives COOP (which severs `window.opener` and breaks `postMessage`), never reaches a server, and the popup opens with `noopener`. `readHash()` in `js/add.js` is the only guard on that input: length caps and `safeUrl` |
| 17 | Phone add | Paste a link into a form; a Cloudflare Worker fetches the page and returns title, images and price; manual form stays as fallback | Bookmarklets work poorly on phones, and CORS blocks fetching from the page |
| 18 | Worker access | The Worker accepts only requests carrying the owner's Firebase ID token | Otherwise it is an open proxy for anyone |
| 19 | Frontend | Plain HTML + JavaScript, Firebase SDK from a CDN, native HTML5 drag and drop, no build step | Least to maintain |
| 20 | Old 2013 list | Not imported | Items and shop links are 13 years stale |

## Later iterations

- **Per-shop price rules**: a stored mapping from shop to price selector, improved with each use, similar to adblocker filter lists. Needs research on options.
- **Browser extension** replacing the bookmarklet; the natural home for the price rules.
- **Image storage research**: where to keep copies so expired shop links do not break the list. Consider the owner's existing Google Drive, iCloud or GitHub.

## Cut from the original

- Gift reservations (no guest writes at all)
- Comments, friends, followers, private messages, e-mail notifications
- "Add to my list" copy, "N people want this" counts, popularity rankings
- Tags, tag cloud, search, editorial gift guides, ads, affiliate links
- Profiles and occasion dates
