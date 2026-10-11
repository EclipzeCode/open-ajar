# Open Ajar: project handoff

Context for picking this project up in a new chat. The technical setup is in `README.md`; this file covers history, current state, the gotchas we hit and what's next.

## What it is

Open Ajar is a free site where high-school students find internships, programs, scholarships, competitions and teen jobs, then track their applications. Students can also apply to be placed as interns with partner businesses.

- **Live site:** https://open-ajar.onrender.com (hosted on Render, deployed automatically from `main`)
- **Repo:** https://github.com/EclipzeCode/open-ajar (private)
- **Stack:** Flask 3.1 + SQLite (stdlib `sqlite3`) + Jinja templates + plain CSS/JS. No build step.
- **Email:** Resend, sent with stdlib `urllib`. Without a key, emails go to `/dev/inbox`.

## History (short)

1. The original site was on Fly (repo `jaybray27/Open-Ajar`). We added a Render blueprint, then moved to the new repo `EclipzeCode/open-ajar`.
2. The site was rebuilt from scratch with full feature parity, on Flask + vanilla JS.
3. It was restyled after thealumhub.com:
   - Fonts: Inter for body text, Plus Jakarta Sans for headings. Blue gradient `#1E6CE5 → #308AF5`.
   - A floating pill-shaped header and custom styled dropdowns.
   - On the home page: a cycling search animation, a door that opens as you scroll, a grid-cell cursor effect, the testimonials section and a mobile restyle.
4. Deployed on Render. Listings were imported in the Render Shell and the owner (madishetty.vrishank2008@gmail.com) was made admin.
5. Polish pass (PR #3):
   - Styled form errors instead of browser defaults.
   - Account, Become an intern, Submit and Tracker pages share one layout: a fixed blue side panel, with only the cards scrolling.
6. **Research pass** on all 752 flagged listings, also in PR #3:
   - Each listing was checked against its official page.
   - About 600 were rewritten with real eligibility, cost, dates and links.
   - 146 were unpublished, each with a reason (ended, college-only, generic pointer, unconfirmable, duplicate).
   - The fixes live in `data/corrections.json` and are applied with `flask --app app apply-corrections data/corrections.json`.
7. Filter counts now apply the other active filters. The home stats show opportunities and jobs separately (PR #3).
8. **Metrics (PR #4):**
   - An Admin → Stats page.
   - An optional "school" field on signup and the profile.
   - The tracker asks "Did you find this on Open Ajar?" when a card reaches Accepted/Completed.
   - Daily active tracking in the `user_days` table.
   - The privacy policy was updated to match.

## Current state (Oct 2026)

- Locally: 839 live listings (462 opportunities, 377 jobs), 50 states.
- PRs #1–#4 are merged into `main`.
- **Check this first:** after PR #3 deployed, did someone run `flask --app app apply-corrections data/corrections.json` in the Render Shell? If not, the live site still has the old listing text. The command is safe to re-run.

## How the code is organized

See the file table in `README.md`. Key pieces:

- **`core.py` `_filters(f, skip)`:** builds the search WHERE clause. `facets(f)` uses it to count each filter's options with every *other* filter applied.
- **`admin.py` `stats()`:** straight database counts, plus an 8-week trend that runs on UTC dates.
- **`app.py` `init_db`:** runs `schema.sql`, then adds any columns created after launch with `ALTER TABLE`. Add new columns to both places.
- **`app.py` `apply_correction_file`:** applies listing fixes through the same validation as the admin editor. It skips fixes already applied and accepts a listing's new title as already renamed.

## Gotchas we hit (don't repeat them)

- **CSP is strict:** no inline `<script>` and no `style="..."` attributes. Use classes and `static/app.js`; setting styles from JS is fine.
- **Background thread:** the maintenance thread starts lazily on the first request. Starting it at app creation deadlocks gunicorn on Render, which preloads the app before forking.
- **Endpoint names:** `/opportunities` and `/jobs` must stay separate endpoints (`site.browse`, `site.jobs`).
- **CSRF:** an empty token must be rejected.
- **CSS order:** phone styles go at the end of `style.css`, or the base rules override them. For `.check`/`.switch` inside `.field`, use `.field .check`.
- **Tracker autosave JS:** use `form.getAttribute('action')`, because a button named `action` shadows `form.action`.
- **Tests:** the sign-in rate limiter is held in process memory. `setUp` clears `core._hits`.
- **Dates:** `user_days` and `created_at` are UTC, so compare against UTC dates.

## Rules the owner set

- Never enter API keys, passwords or card details into websites for them. They do that.
- Confirm before anything that costs money or deploys a paid service.
- Placeholder testimonials must never reach production. A test enforces this.
- Don't invent facts in listings. If a listing can't be confirmed, unpublish it with a reason.
- They usually want changes pushed as a branch, then a PR merged into `main`.

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
| Business partnerships | Interns placed | Pitch 5 businesses; mark placements in admin |
| Student success | Acceptances found here | Follow up with users; collect wins and quotes |

## Open to-dos

- [ ] Confirm `apply-corrections` has run on production (see Current state).
- [x] Testimonial photos (96px JPEGs in `static/img/testimonials/`). Nate John and Sam Lui still show initials; send their photos to add them.
- [ ] Admin accounts for teammates: `flask --app app create-admin their@email` in the Render Shell.
- [ ] Ideas not built yet:
  - A weekly "deadlines this month" email digest.
  - Privacy-friendly traffic analytics, such as Plausible.
  - A one-page flyer with a QR code for counselors.
- [ ] Monthly listing refresh: add new listings and expire stale ones.
