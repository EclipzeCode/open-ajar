# Opportunity providers

A **provider** is how listings get into Open Ajar from somewhere other than the submission form
(an Airtable base, a partner API, a PostgreSQL table, a spreadsheet export).

```js
// server/providers/airtable.js  (example shape, not included)
export const name = 'airtable';          // becomes source = "import:airtable"
export async function* fetch() {
  // yield one object per listing, using the same field names as the submission form:
  yield {
    externalId: 'rec123',                // required. The id in the upstream system. Makes re-imports idempotent.
    title, org, type, summary, eligibility, requirements: [...], interests: [...], grades: [...],
    cost, costNote, format, location, commitment, commitmentNote, deadlineDate, deadlineNote, url,
  };
}
```

Run it with:

```
node server/scripts/import.js airtable
```

## Guarantees the importer enforces

- **Nothing goes public automatically.** Imported rows are always `pending_review`; an admin approves them.
- **Idempotent.** Keyed by `(source, externalId)`. Re-running refreshes content but never changes an existing row's status.
- **Validated.** Each row passes the same validation as the submission form. Bad rows are skipped and reported.
- **Traceable.** `source` and `external_id` stay on the row so admins can see where a listing came from.

## Demo data

`demo.js` is the only provider allowed to publish directly, because its rows are fictional, flagged `is_demo`,
labelled "Demo" in the UI, and have no application link. Remove them with `node server/scripts/seed-demo.js --purge`.
Production never seeds demo data unless `SEED_DEMO=1` is set explicitly.
