# CaseTrace Logbook (web)

A personal anesthesia case logbook as a static site. It signs in and stores data in a Supabase project (Postgres with row-level security), so there is no server in this repository.

- Open the published page, sign in, log cases, filter, edit, export CSV.
- `config.js` holds the Supabase project URL and the public (anon) key. Never put a `service_role` or secret key there; the page refuses to start if it sees one.
- The data is not in this repository.

Never enter patient names, file numbers or dates of birth. Describe the operation only.
