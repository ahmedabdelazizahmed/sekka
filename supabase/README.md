# Supabase setup

1. Create a project at supabase.com (the free plan is fine for a demo; free projects pause after about a week of inactivity).
2. **SQL editor** → run `migrations/0001_sekka_core.sql`, then `seed.sql`. `seed.sql` holds a **fictional** company (4 universities, 5 lines, 31 stops, 7 time slots): edit it to the real company's lines, stops and prices first.
3. **Authentication → Users → Add user** for each staff member (email + password, tick *Auto confirm*). Turn **off** public sign-ups (Authentication → Providers → Email → *Enable sign ups*): staff accounts are created by you.
4. Register them with a role (replace the ids with the ones Supabase shows):
   ```sql
   insert into public.staff (id, full_name, role) values ('<owner-uuid>',      '…', 'owner');
   insert into public.staff (id, full_name, role) values ('<dispatcher-uuid>', '…', 'dispatcher');
   insert into public.staff (id, full_name, role) values ('<accountant-uuid>', '…', 'accountant');
   ```
   No API writes to `staff` — a signed-in user who is not listed there can read nothing.
5. Optional demo data: run `seed-sample-data.sql` **on a separate demo project only** (480 fictional students, a fleet, history, a running trip). It also sets a demo clock; in production keep `company_settings.demo_mode = false`, which locks the simulator and the demo clock.
6. Copy the project URL and **anon** key into `.env.local` (see `.env.local.example`). Never put the service-role key in the front end.
7. In `company_settings` set `site_url` (links in messages use it), `phone`, `whatsapp`, `owner_phone`, the term dates and the operating days.

## What is not connected yet
- **WhatsApp**: every automatic message is written to the `outbox` table with `whatsapp_enabled = false`. Sending needs a WhatsApp Business API account and a small server-side function that reads `outbox` and marks rows sent. Keep the credentials server-side only.
- **Scheduling**: the automations (renewal reminders, expiry, urgent-bus work orders, daily report) run when `staff_run_automations()` is called. In production call it from a Supabase scheduled function (pg_cron) every 15–30 minutes. Every automation is idempotent, so extra runs are harmless.
- **Live GPS**: the driver page can send the phone's location, which students then see on the map. Without it the position comes from the driver's stop check-ins.

## Moving to production
- Run the SQL through the Supabase CLI migrations instead of pasting it, so changes are versioned.
- Enable daily backups (paid plan) before real student data goes in.
- Add rate limiting in front of the public RPCs (Cloudflare / Vercel firewall); the database already rate-limits identity checks per student, but it cannot throttle by IP.
