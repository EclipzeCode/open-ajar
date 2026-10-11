# Open Ajar: project handoff

Context for picking this project up in a new chat. The technical setup is in `README.md`; this file covers history, current state, the gotchas we hit and what's next.

## What it is

Open Ajar is a free site where high-school students find internships, programs, scholarships, competitions and teen jobs, then track their applications. Students can also apply to be placed as interns with partner businesses, and businesses can offer to host one.

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
6. **Metrics (PR #4):** Admin → Stats, an optional school field, the "Did you find this on Open Ajar?" tracker prompt, daily active tracking in `user_days`.
7. **Evergreen redesign (PR #6):**
   - Colors: deep green `#1F5C46` (hover `#174A38`), soft tint `#EEF5F1`, brass `#E8A33D`; warm stone grays instead of slate. White backgrounds kept. No gradients: headline text, buttons and panels are flat.
   - The account, apply, submit and tracker pages scroll normally with a sticky, transparent side panel (no inner scroll box). Apply and submit have a plain page header, a numbered stepper, interest chips and a submit bar. The help cards ("How it works", "What happens next", "Need a hand?", "Find more") are gone; Delete account sits with the other account links.
   - Sign-in, register, password, verify, confirmation and error pages use a centered "focus" layout with no footer, so they don't scroll unless they have to.
   - Every `<input type=date>` is a custom calendar popover (keyboard accessible); the real input stays hidden underneath.
8. **Home page motion (PR #7, #10):** headline words rise in, feature icons draw in, interest tabs (All/STEM/Health/Business/Arts/Writing) swap the "Open right now" cards in place, a light ribbon grows out of the open door and sweeps off the left edge on scroll, testimonials get ‹ › arrows, FAQ answers slide open. Section labels were removed from the home page.
9. **Professional polish:** flat 8px buttons (no glow or lift), underline tabs, plain-text section labels instead of outlined pills.
10. **Job categories and card art (PR #8, #9, #16):** six broad job categories (Food & drink, Retail, Grocery, Entertainment, Recreation & outdoors, Community & public service) assigned from keywords in the employer name, then the title; /jobs has a Category filter. Every listing card shows four large icons in the top-right corner: by category for jobs (`static/img/jobs/`), by listing type for everything else (`static/img/types/`).
11. **Browse layout (PR #10, #13):** the sort dropdown sits in the filter row; a short last row of cards stays in its columns instead of centering.
12. **Custom domain:** `openajar.org`, bought through Shopify (DNS is managed in Shopify → Settings → Domains → openajar.org → DNS settings). Records: `@` A `216.24.57.1`, `www` CNAME `open-ajar.onrender.com`, plus Resend's `resend._domainkey` TXT and `send`/`rsend` CNAMEs. Shopify's `_dmarc` and `_provider` records were left as they are. Render's `APP_URL` is `https://www.openajar.org`; `EMAIL_FROM` is `Open Ajar <hello@openajar.org>`.
13. **Search engines (PR #11):** non-canonical hosts 301 to `APP_URL` (except `/healthz` and form posts), canonical + Open Graph tags on every page, WebSite/Organization structured data naming the site "Open Ajar", `/robots.txt` and `/sitemap.xml` (public pages plus every live listing).
14. **Partner with us (PR #12) and Contact (PR #16):** the Partner with us button opens `/partner`, a short form for businesses, saved to `partner_inquiries` and listed under Admin → Partner inquiries. The footer's Contact link opens `/contact` (name, email, topic, message), saved to `contact_messages` and listed under Admin → Messages. Both email the team with reply-to set to the sender, after saving.
17. **Feature rows and ribbon (PR #17):** the six home-page features are rows with text on alternating sides (left for odd, right for even) and a solid green icon (72-168px) on the opposite side, inset from the edge. Each slides in from its side as it scrolls into view and stays. The ribbon from the door starts thin and widens steadily; it flows past the mission heading and loops once around each icon before curving across to the next. Once the door is fully open its section collapses to one screen (`.doorway.is-done`), so scrolling back up passes straight over it; the page is shifted by exactly the change, with the browser's scroll anchoring switched off for that one adjustment. Reduced motion shows everything in place.
16. **Simpler nav (PR #17):** Opportunities · Apply · About · Admin (admins only) · Profile. Jobs is a tab on the Opportunities page (with a Submit a listing link), the tracker is a tab on Profile, and Team/Support are reached from About; the footer still lists every page. A test checks the nav for visitors, students and admins.
15. **Testimonials (PR #12, #14):** photos for Vanessa Gunawan, Heewon Park, Arnav Dedhia, Samay Malde, Ciara DeCarlo and Chayan Malkari (96px JPEGs, about 4 KB each). Mark Rydberg and Bobby DeCarlo were removed; Nate John and Sam Lui are hidden for now (their quotes are in a comment in `home.html`). The FAQ slide was rebuilt with the Web Animations API so it works in every browser.

## Current state (Oct 2026)

- Live: 462 opportunities, 379 jobs, 50 states. PRs #1–#14 are merged into `main`.
- **Not confirmed yet:** that emails actually arrive from `hello@openajar.org`. Test by signing up on the live site with a second address. If nothing arrives, check Resend → Emails and search Render → Logs for `[email]` (a 403 means the domain isn't verified or `EMAIL_FROM` is wrong).
- **Not done yet:** Google Search Console (see to-dos).
- A local test account exists only in the local database; its login is in `var/LOCAL_TEST_LOGIN.txt` (gitignored).

## How the code is organized

See the file table in `README.md`. Key pieces:

- **`core.py` `_filters(f, skip)`:** builds the search WHERE clause. `facets(f)` uses it to count each filter's options with every *other* filter applied.
- **`core.py` `JOB_CATEGORY_SQL`:** one `CASE` expression built from `data.JOB_CATEGORIES` (employer name first, then title). There's no stored column, so new jobs are categorized automatically; edit the keyword lists to fix a miscategorized employer.
- **`admin.py` `stats()`:** straight database counts, plus an 8-week trend that runs on UTC dates.
- **`app.py` `init_db`:** runs `schema.sql`, then adds any columns created after launch with `ALTER TABLE`. New tables only need `CREATE TABLE IF NOT EXISTS` in `schema.sql`; new columns go in both places.
- **`app.py` `apply_correction_file`:** applies listing fixes through the same validation as the admin editor.
- **`static/img/jobs/*.svg`:** one icon tile per job category. **`static/img/testimonials/`:** testimonial photos; resize new ones to 96×96 (macOS: `sips -z 96 96 -s format jpeg -s formatOptions 78 in.png --out out.jpg`).

## Gotchas we hit (don't repeat them)

- **CSP is strict:** no inline `<script>` and no `style="..."` attributes. Use classes and `static/app.js`; setting styles from JS (CSSOM, `element.animate`) is fine. `<script type="application/ld+json">` is data and is allowed.
- **Background thread:** the maintenance thread starts lazily on the first request. Starting it at app creation deadlocks gunicorn on Render, which preloads the app before forking.
- **Endpoint names:** `/opportunities` and `/jobs` must stay separate endpoints (`site.browse`, `site.jobs`).
- **CSRF:** an empty token must be rejected.
- **CSS order:** phone styles go at the end of `style.css`, or the base rules override them; a rule that must win on phones too needs higher specificity (e.g. `.section.mission`). For `.check`/`.switch` inside `.field`, use `.field .check`.
- **Card click area:** the title link's `::after` covers the whole card, measured from `.card`. Don't make anything between them `position: relative`; the job-card art uses a grid on `.card__head` for this reason.
- **Grid placement:** in `.card__head`, children are pinned to explicit rows; otherwise auto-placement pushes them below the art.
- **Popovers:** `.acct-card` must not use `overflow: hidden`, or dropdowns and the date picker get clipped.
- **Changing height above the viewport:** the browser's scroll anchoring may or may not compensate on its own. Set `overflow-anchor: none` on `<html>` for the change, shift by the measured difference, then restore it (see the door collapse in `app.js`).
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

Every number must be real and checkable. The Admin → Stats page is the source of truth:

- **"Engaged members":** saved or tracked at least one listing.
- **"Vetted":** about 990 listings have been reviewed, and 752 were checked one by one in the research pass. Vet about 200 more new ones to say 1k+ honestly.
- **"50+ interns":** only count students marked "placed" under Admin → Intern applications. Applications don't count. Reword the line if the number isn't reached.
- **Strongest metric:** "students accepted to programs they found on Open Ajar", from the tracker prompt.

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
- [ ] Confirm email delivery from `hello@openajar.org` (see Current state).
- [ ] Google Search Console: add `openajar.org` as a Domain property, add Google's TXT record in Shopify DNS, then submit `https://www.openajar.org/sitemap.xml`. Then import into Bing Webmaster Tools.
- [ ] Link `www.openajar.org` from the team's social profiles and school pages (helps it rank for "Open Ajar").
- [ ] Admin accounts for teammates: `flask --app app create-admin their@email` in the Render Shell.
- [ ] Ideas not built yet:
  - A weekly "deadlines this month" email digest.
  - Privacy-friendly traffic analytics, such as Plausible.
  - A one-page flyer with a QR code for counselors.
  - A link-preview image (`og:image`) for shared links.
- [ ] Monthly listing refresh: add new listings and expire stale ones.
