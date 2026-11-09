# How chce.to worked — Wayback Machine research

## TL;DR

- chce.to (2008 – ~2014) was a Polish wishlist site. Each user had one public "chcelista" (wish list) at `<login>.chce.to`, split into tabs, with manually ordered items.
- An item was: title, photo, description, link to the shop, tags. **No price was shown** on any archived page we read.
- The **ChceBaton** bookmarklet did not make the server download the shop page. It POSTed the URL, the page title and the **whole `document.body.innerHTML`** of the page you were looking at into a 565×530 popup, where you logged in and saved the item.
- Visitors could reserve a gift ("rezerwuj ten prezent"), copy an item to their own list, and comment. Users had friends, followers, private messages, e-mail notifications and occasion dates.
- Revenue: shop ads targeted by wished-for products (CPC), affiliate links, a "Chce.to" button for shops, contests.

## Glossary

- **Chcelista**: the site's word for a wish list ("chcę" = "I want").
- **ChceBaton**: the site's bookmarklet. A bookmarklet is a browser bookmark whose URL is JavaScript; clicking it runs that script on the current page.
- **Wayback Machine**: web.archive.org, the Internet Archive's page history. A snapshot URL looks like `https://web.archive.org/web/<timestamp>/<original-url>`.
- **CPC**: cost per click, an ad billing model.

## Sources fetched

All via `https://web.archive.org/web/<timestamp>id_/<url>` (the `id_` suffix returns the original HTML without the archive toolbar).

| Page | Snapshot |
|---|---|
| A user's list | 2013-03 snapshot of `http://chce.to/list.asp?u=<login>` (login omitted) |
| Home 2008 / 2009 / 2010 / 2012 | `2008…`, `2009…`, `2010…`, `2012…` `http://chce.to/` |
| Bookmarklet page | `2013…` `http://chce.to/bookmarklet.asp` |
| Bookmarklet popup | `20130429054505` `http://chce.to/bookmarklet/a.asp?u=…&t=…` |
| Registration | `2013…` `http://chce.to/register.asp` |
| Terms of service | `2012…` `http://chce.to/regulamin.asp` |
| Most popular | `2012…` `http://chce.to/all_popular.asp` |
| Press releases | `2012…` `http://chce.to/aspx/press.aspx?id=2,3,4,10,11` |
| URL index (CDX) | `https://web.archive.org/cdx/search/cdx?url=chce.to/*` (5000 HTML URLs, status 200) |

Personal details from the archived list (items, profile data, friends' logins) are deliberately left out of this repo.

## 1. Lists and items

- **One list per user, at its own address.** Press release, 2008-11-12: "Aby zobaczyć spis rzeczy jakie chce otrzymać użytkownik 'adek' wystarczy w przeglądarce internetowej wpisać adres 'adek.chce.to'." Registration page: "Nazwa użytkownika będzie stanowiła także adres Twojej listy." The same list was also served at `list.asp?u=<login>`.
- **Tabs.** A list is split into named tabs with item counts, e.g. "Książki (n)" (books), plus a synthetic "Ostatnio dodane (n)" (recently added). Tab URLs use `list.asp?u=<login>&tabid=<n>`. Each tab can have its own short description.
- **"Już mam" tab.** Users kept a tab for wishes already fulfilled. Press release 2008: "Gdy już dostanie swój wymarzony prezent, ma opcję poinformowania wszystkich znajomych od kogo go otrzymał."
- **Manual order.** Footer copy on every page: "Dodawaj produkty, ustalaj kolejność, zmieniaj opisy".
- **Item fields** (list page markup: `produkt_foto`, `produkt_opis_tyt`, `produkt_opis_opis`, `produkt_opis_tagi`, `produkt_opis_znajdz`):
  - photo
  - title
  - optional description
  - tags, each linking to `/temat/<tag>`
  - "Znajdź w:" — the source shop's domain, plus fixed search links to the price-comparison sites skąpiec.pl and nokaut.pl
- **Press release 2008:** "umieszcza oprócz nazwy produktu […] także jego zdjęcie, opis oraz odnośnik do strony internetowej, gdzie można go kupić." No price is listed among the fields.
- **Price: not found.** No archived list, home or popular page shows a price. INFERRED: price was not a stored field; the comparison-site links stood in for it.
- **Edit history of descriptions.** `aspx/product_desc.aspx` was titled "Historia zmian opisu" (description change history).
- **"Jest na N listach" / "chce N osób".** Items with the same identity were counted across all lists ("chcą 1292 osoby" for "iphone 3G" on `all_popular.asp`). INFERRED: items were deduplicated into a shared product catalogue (`/p<id>_` URLs), and each list entry pointed to a catalogue product.

## 2. ChceBaton (bookmarklet)

- **Pitch** (`bookmarklet.asp`): "Nie musisz już ręcznie wpisywać linku do strony, nazwy produktu ani wgrywać zdjęć. ChceBaton robi to za Ciebie."
- **Install:** drag the "Chce.to!" button to the bookmarks bar (instructions for Firefox 3 and Opera 9).
- **Use:** open any page describing a thing (a shop, Allegro, a blog), click the bookmark, log in, add.
- **Source, verbatim** (URL-decoded from the button's `href`):

```js
javascript:var d=document,w=window,f='http://chce.to/bookmarklet/a.asp',l=d.location,e=encodeURIComponent,p='?u='+e(l.href)+'&t='+e(d.title),bd=d.getElementsByTagName('body')[0];var a = function(){e1=d.createElement('form');e1.setAttribute('charset','UTF-8');e1.setAttribute('action',f+p);e1.setAttribute('method','post');e1.setAttribute('target','t');e2=d.createElement('input');e2.setAttribute('name','bd');e2.value=bd.innerHTML;e1.appendChild(e2);bd.appendChild(e1);w.open(f+p,'t','toolbar=0,resizable=0,status=1,width=565,height=530');e1.submit();};setTimeout(a,100);void(0)
```

- **What it does:**
  1. Builds `bookmarklet/a.asp?u=<page URL>&t=<page title>`.
  2. Opens a 565×530 popup window named `t`.
  3. Injects a hidden form that POSTs the page's **entire body HTML** (field `bd`) into that popup.
- **Popup** (`bookmarklet/a.asp`, 2013 snapshot): when logged out it shows only a login form ("Zaloguj się, aby dodać wpis", login, password, "Zapamiętaj mnie"). The logged-in add form was not archived.
- INFERRED: the server parsed images and the title out of the posted HTML, and the user picked one image in the popup. This avoided the server fetching the shop page itself.
- **Implication for the rebuild:** a bookmarklet runs inside the shop's page, so it can read `og:image`, `og:title`, the `<img>` list and a price directly from the DOM. No server-side scraping and no CORS problem.

## 3. Gifting

- **Reserve.** Each item shown to a visitor had "rezerwuj ten prezent" (reserve this gift); logged-out visitors were sent to `login.asp`, so reserving needed an account. INFERRED: hidden from the list owner so the gift stays a surprise — not confirmed in any archived page.
- **Copy.** "dodaj do Twojej chcelisty" put the same item on the visitor's own list.
- **Comments** under each item ("dodaj komentarz", "pokaż wszystkie").
- **Who gave it.** On receiving a gift the owner could tell friends who it came from (press release 2008, quoted above).

## 4. Accounts and social

- **Registration:** login (letters, digits, dot, hyphen; becomes the list address), e-mail (not published), password (min. 6 characters). Free service (terms §2: "Usługi Serwisu są bezpłatne").
- **Profile sidebar:** gender, age, "send a message", occasion dates (birthday, name day, plus fixed holidays like Mikołajki and Christmas Eve).
- **Friends and followed lists** (`znajomi_lista_box`, `obserwowane_lista_box`).
- **E-mail notifications** for every new item on a followed list ("Otrzymuj powiadomienia o nowych wpisach").
- **Private messages**, **profile comments**, user groups (terms §3).
- **Sharing:** "Wyślij im email, wstaw link na blogu, ustaw status na Gadu-Gadu."
- **Privacy:** every archived list was publicly readable; no evidence of private lists. Editing required login as the owner ("Aby edytować chcelistę musisz się zalogować i być jej właścicielem").

## 5. Discovery and monetisation

- Home page: search by login, e-mail or product name; tag cloud; "most wanted" ranking ("chce N osób"); later editorial "Inspiracje" gift guides by category (Moda i Styl, Uroda, Dom i wnętrza, Gadżety, Technologia, Kultura, Lifestyle) and themed galleries (`g45_blysnij-pamiecia`).
- Shop partners: an Apple reseller link shown next to Apple items (press release 2008-12-18), CPC ads targeted by wished-for products via `sklepy.chce.to` (2009-11-16), affiliate redirects (`affiliate/clickin.asp`), a "Chce.to" button for shops ("Wstaw odnośnik Chce.to, aby internauci mogli jednym kliknięciem dodawać Twoje produkty").
- Contests (`aspx/konkurs_*.aspx`), widgets, press reports on gift trends.
- Scale: launched as a beta in September 2008; 80,918 lists and 1,562,733 entries on the 2013-03-26 list page header.

## Not found / open

- The logged-in bookmarklet add form (how the image was picked).
- Whether a reservation was hidden from the owner.
- Any price field.
