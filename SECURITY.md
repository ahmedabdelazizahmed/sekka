# Security notes

**What is enforced in the database (tested in `tests/db/sekka.test.mjs`, 137 checks)**
- Every personal table (students, subscriptions, payments, requests, outbox, audit log, GPS pings…) has row-level security switched on with **no API policy** and all table grants revoked from the public roles. Nothing can read or write them directly; access exists only through `SECURITY DEFINER` functions.
- Staff powers come from the `staff` table, which no API role can write. Each staff function checks the role itself: the owner sees revenue and the audit log, the dispatcher runs trips and the fleet but sees **masked phone numbers** and no money, the accountant sees subscriptions and payments but not the fleet. A signed-in user who is not staff reads nothing.
- Students identify with phone + student code. Wrong attempts are counted and locked after 5 failures in 15 minutes. Answers never include another student's data.
- The tracking link uses a private 32-character token per student; the driver link uses a private token per trip. Driver GPS pings are kept ≤ 10 minutes and only while the trip runs.
- Internal helpers (risk scoring, planning, report building, clock) are not executable by the API roles.
- Every sensitive staff action writes an audit row (who, what, when).
- No national ID or similar column exists in the schema.

**Not covered (do before real student data)**
- Request rate limiting per IP (use the hosting firewall).
- Backups, point-in-time recovery and a retention policy for student data.
- Staff password policy and MFA (Supabase Auth supports MFA; enable it for the owner).
- WhatsApp Business API credentials must live in a server-side function, never in the browser.
- A legal review of the privacy notice for students' personal data in the company's country.
- The assistant is rule-based and answers only from the database; if it is ever replaced by a language model, keep the same rule: it must call the same verified functions and never get table access.

Report issues privately to the repository owner rather than opening a public issue.
