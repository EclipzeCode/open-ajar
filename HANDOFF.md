# OpenAjar: project handoff

Context for picking this project up in a new chat. The technical setup is in `README.md`; this file covers history, current state, the gotchas we hit and what's next.

## What it is

OpenAjar is a free site where high-school students find internships, programs, scholarships, competitions and teen jobs, then track their applications. Students can also apply to be placed as interns with partner businesses, and businesses can offer to host one.

- **Live site:** https://www.openajar.org (hosted on Render, deployed automatically from `main`, usually live about 90 seconds after a merge). `openajar.org` and the old `open-ajar.onrender.com` both redirect there.
- **Repo:** https://github.com/EclipzeCode/open-ajar (private)
- **Stack:** Flask 3.1 + SQLite (stdlib `sqlite3`) + Jinja templates + plain CSS/JS. No build step.
- **Email:** Resend, sent with stdlib `urllib`. Without a key, emails go to `/dev/inbox`.

## History (short)

1. The original site was on Fly (repo `jaybray27/Open-Ajar`). We added a Render blueprint, then moved to the new repo `EclipzeCode/open-ajar`.
2. The site was rebuilt from scratch with full feature parity, on Flask + vanilla JS.
3. It was first restyled after thealumhub.com (blue gradient, floating pill header, custom dropdowns, home-page door and cursor effects).
4. Deployed on Render. Listings were imported in the Render Shell and the owner (madishetty.vrishank2008@gmail.com) was made admin.
5. Polish pass and **research pass** on all 752 flagged listings (PR #3): about 600 rewritten from official pages, 146 unpublished with a reason. Fixes live in `data/corrections.json` (`flask --app app apply-corrections data/corrections.json`; confirmed applied on production).
6. **Metrics (PR #4):** Admin → Stats, an optional school field, the "Did you find this on OpenAjar?" tracker prompt, daily active tracking in `user_days`.
7. **Evergreen redesign (PR #6):**
   - Colors: deep green `#1F5C46` (hover `#174A38`), soft tint `#EEF5F1`, brass `#E8A33D`; warm stone grays instead of slate. White backgrounds kept. No gradients: headline text, buttons and panels are flat.
   - The account, apply, submit and tracker pages scroll normally with a sticky, transparent side panel (no inner scroll box). Apply and submit have a plain page header, a numbered stepper, interest chips and a submit bar. The help cards ("How it works", "What happens next", "Need a hand?", "Find more") are gone; Delete account sits with the other account links.
   - Sign-in, register, password, verify, confirmation and error pages use a centered "focus" layout with no footer, so they don't scroll unless they have to.
   - Every `<input type=date>` is a custom calendar popover (keyboard accessible); the real input stays hidden underneath.
8. **Home page motion (PR #7, #10; the features and ribbon were later reworked, see 17):** headline words rise in, interest tabs (All/STEM/Health/Business/Arts/Writing) swap the "Open right now" cards in place, a light ribbon grows out of the open door and sweeps off the left edge on scroll, testimonials get ‹ › arrows, FAQ answers slide open. Section labels were removed from the home page.
9. **Professional polish:** flat 8px buttons (no glow or lift), underline tabs, plain-text section labels instead of outlined pills.
10. **Job categories and card art (PR #8, #9, #16):** six broad job categories (Food & drink, Retail, Grocery, Entertainment, Recreation & outdoors, Community & public service) assigned from keywords in the employer name, then the title; /jobs has a Category filter. Every listing card shows four large icons in the top-right corner: by category for jobs (`static/img/jobs/`), by listing type for everything else (`static/img/types/`).
11. **Browse layout (PR #10, #13):** the sort dropdown sits in the filter row; a short last row of cards stays in its columns instead of centering.
12. **Custom domain:** `openajar.org`, bought through Shopify (DNS is managed in Shopify → Settings → Domains → openajar.org → DNS settings). Records: `@` A `216.24.57.1`, `www` CNAME `open-ajar.onrender.com`, plus Resend's `resend._domainkey` TXT and `send`/`rsend` CNAMEs. Shopify's `_dmarc` and `_provider` records were left as they are. Render's `APP_URL` is `https://www.openajar.org`. `EMAIL_FROM` was only added on Oct 12, 2026 (see Current state).
13. **Search engines (PR #11):** non-canonical hosts 301 to `APP_URL` (except `/healthz` and form posts), canonical + Open Graph tags on every page, WebSite/Organization structured data naming the site "OpenAjar", `/robots.txt` and `/sitemap.xml` (public pages plus every live listing).
14. **Partner with us (PR #12) and Contact (PR #16):** the Partner with us button opens `/partner`, a short form for businesses, saved to `partner_inquiries` and listed under Admin → Partner inquiries. The footer's Contact link opens `/contact` (name, email, topic, message), saved to `contact_messages` and listed under Admin → Messages. Both email the team with reply-to set to the sender, after saving.
15. **Testimonials (PR #12, #14):** photos for Vanessa Gunawan, Heewon Park, Arnav Dedhia, Samay Malde, Ciara DeCarlo and Chayan Malkari (96px JPEGs, about 4 KB each). Mark Rydberg and Bobby DeCarlo were removed; Nate John and Sam Lui are hidden for now (their quotes are in a comment in `home.html`). The FAQ slide was rebuilt with the Web Animations API so it works in every browser.
16. **Simpler nav (PR #17):** Opportunities · Apply · About · Admin (admins only) · Profile. Jobs is a tab on the Opportunities page (with a Submit a listing link), the tracker is a tab on Profile, and Team/Support are reached from About; the footer still lists every page. A test checks the nav for visitors, students and admins.
17. **Feature rows and ribbon (PR #17, #19):** the six home-page features are rows with text on alternating sides (left for odd, right for even) and a solid green icon (72-168px) on the opposite side, inset from the edge. Each slides in from its side as it scrolls into view and stays. The ribbon from the door starts thin and widens steadily; it flows past the mission heading, wraps around the outside of each icon (over the top, round the far side, out underneath, never crossing itself; a full loop always overlaps where it joins), then runs down into the full-width green "Intern with us" band (moved up to follow the features), shading from the door's pale green to the band's green after the last loop. It's drawn like a pencil: `app.js` builds the ribbon's outline once and on each scroll draws only up to the tip, with each wrap given its own stretch of scroll and a short pause after it (anchor points map scroll height to length). The tip follows a line 60% down the screen, so a row's text is well up before the ribbon reaches it. Once the door is fully open its section collapses to one screen (`.doorway.is-done`), so scrolling back up passes straight over it; the page is shifted by exactly the change, with scroll anchoring off for that one adjustment. Reduced motion shows everything in place.
18. **Performance (PR #18):** the ribbon's outline is sampled from its cubic Béziers with plain math (it used to call `getPointAtLength` ~1,700 times and took 4 s per layout) and is only re-laid out when the width changes or the door collapses. The hero glows have no blur filter. Static links carry `?v=<mtime>` and are cached for a year.
19. **About: Our partners (PR #20):** Moon Tea, Ryujin, One Dollar Zone of Cedar Knolls, Coders Over Borders, Creator Colosseum and Partner Portal, as monogram tiles (no logos yet). Each has an empty `quote`/`by`/`role` slot in the list at the top of the section in `templates/about.html`; a quote shows under the name once filled in. Moon Tea, Coders Over Borders, Creator Colosseum and Partner Portal will send testimonials. Never put placeholder text there; a test checks that only real quotes render.
20. **Partners redesign (PR #22–#25):** "Our partners" now sits on its own above the other About sections. Each partner is a full-width row (photo on alternating sides, name, testimonial) instead of a card, and fades in once as it scrolls into view. Photos are in `static/img/partners/`, set by each partner's `img`; `'wide': True` shows a non-portrait image uncropped instead of cropping it to the 4:5 frame. In `app.js`, a `.reveal` element drops its reveal classes once it has faded in, so it never animates again.
21. **Partner details (PR #27–#28, #30):** order is Moon Tea, Creator Colosseum, Partner Portal, Ryujin, One Dollar Zone, Coders Over Borders. All six testimonials are in (a test expects six). Each row's text slides in from the photo's side after the row fades up, and ends with the address (`address`) and a website link (`url`; `link` overrides the "Visit website" text, e.g. "View on Yelp"). `'big': True` gives a wide photo a 3:2 column instead of 400px (Partner Portal, Coders Over Borders).
22. **Discord and the home band (PR #29, #30):** the green band has a third column, "Join the community.", linking to the Discord (`https://discord.gg/n3WwuRcVWz`, set at the top of the column in `templates/home.html`; the column hides if it's empty). The three columns share rows through CSS subgrid, so headings, text and the three white buttons line up; they fade in one after another. (PR #33 moved this band below Community voices.)
23. **Saved filter (PR #30):** signed-in users get a "Saved" toggle at the start of the filter row on Opportunities and Teen jobs (`?saved=1`, filtered in `core._filters` via the `saved` table), shown as a removable chip.
24. **Team page removed (PR #32):** `/team` 301-redirects to About; the footer link, photos and styles are gone.
25. **Access Grants (PR #33):** students ask OpenAjar to cover a program fee at `/access-grants` (navbar link; "Need help with the fee?" on listings with a fee pre-fills the form). Up to `data.GRANT_CAP` ($250) per student per calendar year (`core.grant_room`), one open request at a time, a parent or guardian's email required and copied on every decision. Admins work them under Admin → Access Grants (`admin.grant_action`): approve an amount, ask for info, decline, then record the payment after paying the program directly; the student is never sent money. Nobody can act on their own request; otherwise every request, admin or not, follows the same rules. Stored in `access_grants`, kept if the account is deleted. Privacy and terms cover it. The About page has an Access Grants section under Why "ajar".
26. **Home order and the receipt (PR #33):** hero, door, ribbon and feature rows, Access Grants, Open right now, Community voices, the three-button green band, FAQ. The ribbon now runs into the Access Grants section (`data-band`) and fades into its deep green (#123829). Access Grants is a pinned, scroll-driven receipt like the door: a sample $250 fee prints, the grant line covers it, "You pay" counts down to $0 and a stamp lands; then the $250 / 100% / $0 stats, three steps and the button. The door and the receipt share `playOnScroll` in `app.js` (plays once, then the section collapses to one screen).
27. **Name (PR #33):** always written **OpenAjar**, no space, across the site, emails, docs and code. The domain stays `openajar.org`.
28. **Fixes and polish (PR #34):** privacy page no longer names team members; deleting an account removes its quote; listings past their deadline expire (imports too, and the 10-minute job backfills missing expiries via `data.expiry_for`); admin backup download (Admin → Stats); partner photos resized (about 2 MB to 750 KB) with sizes and lazy loading; friendly 500 page; every admin list pages through all rows (`admin.paged`) with search, and the three inboxes share `admin._inbox`; Save/Track pressed while signed out finishes after sign-in (`core.finish_pending`); tracker counts refresh after autosave; grants count toward the year they were approved (`approved_at`); dates use US Eastern (`data.today`); the `js` class is set by a CSP-hashed inline script in `<head>` (`app.JS_FLAG`) so animated sections don't jump; only private pages are `no-store` (`app.PRIVATE_PATHS`); navbar "Apply" is now "Intern with us"; share image `static/og.jpg`; a save star on every card (saves without reloading); "More like this" on listings; no-results suggests which filter to drop; phone menu closes on Escape or a tap; tracker deadlines download as a calendar (`/tracker.ics`); public grants-paid total once there is one; the home interest tabs swap cards in place again; fonts are served from the site (`static/fonts/`, two variable woff2 files, Latin characters), so the CSP no longer allows Google.
29. **Email link fix and show password (PR #36, #37):** pages only act on POST, so link scanners' HEAD requests no longer use up email confirmation links; password fields have a show/hide eye.
30. **Admin rework (PR #38):** the owner (`OWNER_EMAIL`, default madishetty.vrishank2008@gmail.com, `core.is_owner`) is an admin other admins can't demote or disable, and the only one who can add hand adjustments to Overview numbers (stored in `app_meta` as `stat_adj:<key>`, always shown beside the database count, logged in Activity). Admin → Overview (`admin.stats`, where the navbar's Admin link goes) has four headline numbers, six server-drawn SVG charts (`templates/admin/_charts.html`) and one table of every number (`STAT_LABELS`). Tabs show how many things are waiting (`admin.tab_badges`). Users: filters (name, role, status, joined dates), "Mark email confirmed", and a pop-up with a person's details and applications (`admin.user_detail`). Activity: search by who, action kind (`ACTION_NAMES`) and dates. "Download data (CSV)" (`admin.export`) is a zip of readable CSVs without password hashes; "Full backup file" (`admin.backup`) is the restorable database.

## Current state (Oct 2026)

- Live: about 460 opportunities and 380 jobs across 50 states (counts drift as deadlines pass). PRs #1–#38 are merged into `main`; nothing is open.
- **Email:** Resend's DNS records (DKIM, `send`/`rsend`, SPF, MX, DMARC) all resolve. Until Oct 12, 2026 Render had no `EMAIL_FROM`, so the site sent from Resend's test address `onboarding@resend.dev`, which only delivers to the Resend account owner: the earlier "it works" test only reached the owner, and other students likely got no emails before then. `EMAIL_FROM` is now `OpenAjar <hello@openajar.org>`. **Still to confirm:** a reset email reaching an address that isn't the Resend account owner's. Test at `/forgot` with a second address. If emails ever stop arriving, check Resend → Emails and search Render → Logs for `[email]` (a 403 means the domain isn't verified or `EMAIL_FROM` is wrong).
- **Not done yet:** Google Search Console (see to-dos).
- A local test account exists only in the local database; its login is in `var/LOCAL_TEST_LOGIN.txt` (gitignored).

## Starting a new chat

- Say: "read HANDOFF.md and README.md". Work happens in `site/` (the git repo); `main` is what's live.
- **On this computer:** the local site runs with the `open-ajar` preview config (`.claude/launch.json` in the parent folder) at http://localhost:5050. The local test account's login is in `var/LOCAL_TEST_LOGIN.txt` (student role, not committed).
- **On another computer:** use Claude Code on the web (claude.ai/code) or the desktop app, connected to the GitHub repo. A fresh copy has an empty database; follow "Run it locally" in `README.md` to import the listings. Secrets (Resend key, `SECRET_KEY`) live only in Render and aren't needed for code changes.
- Flow: branch → PR → the owner says "merge it" → merge → Render deploys in about 90 seconds → check the live site.

## How the code is organized

See the file table in `README.md`. Key pieces:

- **`core.py` `_filters(f, skip)`:** builds the search WHERE clause. `facets(f)` uses it to count each filter's options with every *other* filter applied.
- **`core.py` `JOB_CATEGORY_SQL`:** one `CASE` expression built from `data.JOB_CATEGORIES` (employer name first, then title). There's no stored column, so new jobs are categorized automatically; edit the keyword lists to fix a miscategorized employer.
- **`admin.py` `stats()`:** straight database counts, plus an 8-week trend that runs on UTC dates.
- **`app.py` `init_db`:** runs `schema.sql`, then adds any columns created after launch with `ALTER TABLE`. New tables only need `CREATE TABLE IF NOT EXISTS` in `schema.sql`; new columns go in both places.
- **`app.py` `apply_correction_file`:** applies listing fixes through the same validation as the admin editor.
- **`static/app.js`:** one file of small, independent blocks, each starting with a `// Home: ...` or similar comment: reveal on scroll, hero typer and counters, feature rows, door (`.doorway`, collapses once open), ribbon (`.trail`), testimonial arrows, hero cursor cells, account scrollspy, date picker, dropdowns, tracker autosave, FAQ slide, card save stars, home interest tabs, phone menu. Every page works without it.
- **`static/img/jobs/*.svg` and `static/img/types/*.svg`:** icon tiles for listing cards (by job category and by listing type). **`static/img/testimonials/`:** testimonial photos; resize new ones to 96×96 (macOS: `sips -z 96 96 -s format jpeg -s formatOptions 78 in.png --out out.jpg`).

## Gotchas we hit (don't repeat them)

- **CSP is strict:** no inline `<script>` (the one exception is `app.JS_FLAG`, allowed by its hash, which is computed from the text, so editing it is safe) and no `style="..."` attributes. Use classes and `static/app.js`; setting styles from JS (CSSOM, `element.animate`) is fine. `<script type="application/ld+json">` is data and is allowed.
- **Background thread:** the maintenance thread starts lazily on the first request. Starting it at app creation deadlocks gunicorn on Render, which preloads the app before forking.
- **Endpoint names:** `/opportunities` and `/jobs` must stay separate endpoints (`site.browse`, `site.jobs`).
- **CSRF:** an empty token must be rejected.
- **CSS order:** phone styles go at the end of `style.css`, or the base rules override them; a rule that must win on phones too needs higher specificity (e.g. `.section.mission`). For `.check`/`.switch` inside `.field`, use `.field .check`.
- **Card click area:** the title link's `::after` covers the whole card, measured from `.card`. Don't make anything between them `position: relative`; the job-card art uses a grid on `.card__head` for this reason.
- **Grid placement:** in `.card__head`, children are pinned to explicit rows; otherwise auto-placement pushes them below the art.
- **Popovers:** `.acct-card` must not use `overflow: hidden`, or dropdowns and the date picker get clipped.
- **Changing height above the viewport:** the browser's scroll anchoring may or may not compensate on its own. Set `overflow-anchor: none` on `<html>` for the change, shift by the measured difference, then restore it (see the door collapse in `app.js`).
- **Performance:** don't call `getPointAtLength`/`getTotalLength` in loops on long SVG paths (each call re-walks the path; the ribbon took 4 s that way). Sample Béziers with plain math. Avoid `filter: blur()` on animated elements. Don't redo layout on height-only resizes (phones fire them while scrolling).
- **Deleting CSS rules:** remove every line of a multi-line rule. A leftover `prop: value; }` silently swallows the next rule.
- **FAQ:** CSS `::details-content` only animates in Chrome and Edge, so the FAQ uses JS. Keep `fill: 'forwards'` on the height animation, or the box snaps back open for a frame before closing.
- **Tracker autosave JS:** use `form.getAttribute('action')`, because a button named `action` shadows `form.action`.
- **Tests:** the sign-in rate limiter is held in process memory; `setUp` clears `core._hits`. Production-mode tests must request with `base_url` set to `APP_URL`, or the host redirect returns a 301.
- **Dates:** `user_days` and `created_at` are UTC, so compare against UTC dates.
- **Screenshots in the preview pane:** a hidden pane freezes CSS transitions mid-way and ignores smooth scrolling. Use `scrollTo({behavior: 'instant'})` and `document.getAnimations()…finish()`; don't inject `<style>` tags (CSP blocks them and logs errors).

## Rules the owner set

- Never enter API keys, passwords or card details into websites for them. They do that.
- Confirm before anything that costs money or deploys a paid service.
- Placeholder testimonials must never reach production. A test enforces this.
- Don't invent facts in listings. If a listing can't be confirmed, unpublish it with a reason.
- Changes go on a branch with a PR; merge into `main` only when they say so ("merge it").
- Design: professional, not "AI slop". No gradients, glows, pill-shaped labels or bouncy effects; motion should do a job.

## Goal: a Common App activity line

A co-founder wants this to be true for their Common App:

> Co-founded web platform closing networking gaps: led 6-person team & 50+ interns; vetted 1k+ opportunities; launched with 160+ engaged members.

Every number must be real and checkable. The database counts on Admin → Overview are the source of truth; a hand adjustment (shown as "+N by hand") only counts if it stands for something real you can show, like an offline placement:

- **"Engaged members":** saved or tracked at least one listing.
- **"Vetted":** about 990 listings have been reviewed, and 752 were checked one by one in the research pass. Vet about 200 more new ones to say 1k+ honestly.
- **"50+ interns":** only count students marked "placed" under Admin → Intern applications. Applications don't count. Reword the line if the number isn't reached.
- **Strongest metric:** "students accepted to programs they found on OpenAjar", from the tracker prompt.

## Team plan (6 people, one metric each)

| Role | Owns | Weekly target |
|---|---|---|
| Lead / founder | Overall growth, partnerships | Weekly 20-min check-in; close 1 partnership a week |
| School outreach | Members, schools | Contact 10 counselors or clubs; add 2–3 schools a month |
| Social & content | Signups, active members | 3 posts a week linking to filtered pages |
| Listings research | Live listings, freshness | 30 new vetted listings a week; remove expired ones |
| Business partnerships | Interns placed, partner inquiries | Pitch 5 businesses; work Admin → Partner inquiries; mark placements in admin |
| Student success | Acceptances found here | Follow up with users; collect wins and quotes |

## Open to-dos

- [x] Confirm `apply-corrections` has run on production.
- [x] Testimonial photos. Nate John and Sam Lui are hidden until they have photos.
- [x] Custom domain and HTTPS (`www.openajar.org`).
- [ ] Check that Render disk snapshots are on, and download the full backup file from Admin → Overview now and then (keep it private: it has everyone's data).
- [ ] Confirm email reaches a non-owner address now that `EMAIL_FROM` is set (see Current state).
- [ ] Decide which account Access Grants are paid from before the first real grant.
- [ ] Google Search Console: add `openajar.org` as a Domain property, add Google's TXT record in Shopify DNS, then submit `https://www.openajar.org/sitemap.xml`. Then import into Bing Webmaster Tools.
- [ ] Link `www.openajar.org` from the team's social profiles and school pages (helps it rank for "OpenAjar").
- [ ] Admin accounts for teammates: `flask --app app create-admin their@email` in the Render Shell.
- [ ] Ideas not built yet:
  - A weekly "deadlines this month" email digest.
  - Privacy-friendly traffic analytics, such as Plausible.
  - A one-page flyer with a QR code for counselors.
  - A link-preview image (`og:image`) for shared links.
- [ ] Monthly listing refresh: add new listings and expire stale ones.
