# Rental Desk

Track rented items, customers, before and after photos, return dates, and automatic reminder emails.

- Website and daily email job: **Vercel**
- Database, sign in and photo storage: **Supabase** (free plan is fine)
- Sending emails: **Resend** (free plan: 100 emails a day)

## 1. Set up Supabase (database, login, photos)

1. Go to https://supabase.com, sign up and click **New project**. Pick a name and a database password, then wait for it to finish.
2. Open **SQL Editor**, click **New query**, paste everything from `schema.sql`, and click **Run**.
3. Create your login: **Authentication > Users > Add user > Create new user**. Enter your email and a password and tick **Auto Confirm User**.
4. Stop strangers from signing up: **Authentication > Sign In / Providers**, then turn off **Allow new users to sign up**.
5. Copy your keys from **Project Settings > API** (or **API Keys**):
   - Project URL → `SUPABASE_URL`
   - `anon` `public` key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (keep this one secret)

## 2. Set up Resend (emails)

1. Sign up at https://resend.com and create an **API key** → `RESEND_API_KEY`.
2. To email customers you need to add and verify your own domain under **Domains** (for example `yourshop.com`). Then use a sender like `Rental Desk <reminders@yourshop.com>` as `FROM_EMAIL`.
3. No domain yet? Use `FROM_EMAIL = Rental Desk <onboarding@resend.dev>`. With that sender, Resend only delivers to the email you signed up to Resend with, so only you get reminders and customers won't.

## 3. Deploy to Vercel

**Option A: with GitHub (easiest to update later)**
1. Create a new GitHub repository and upload all the files in this folder.
2. In Vercel click **Add New > Project**, import the repository, keep **Framework Preset: Other**, and leave the build settings empty.

**Option B: with the Vercel command line**
```bash
npm i -g vercel
cd rental-desk-vercel
vercel        # first time: answer the questions, defaults are fine
vercel --prod
```

### Environment variables
In Vercel open **Project > Settings > Environment Variables** and add:

| Name | Value |
|---|---|
| `SUPABASE_URL` | from Supabase |
| `SUPABASE_ANON_KEY` | from Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase (secret) |
| `RESEND_API_KEY` | from Resend |
| `FROM_EMAIL` | e.g. `Rental Desk <reminders@yourshop.com>` |
| `CRON_SECRET` | any long random text, e.g. from https://generate-secret.vercel.app/32 |
| `OWNER_EMAIL` | your email (used if you leave it blank on the Email setup page) |
| `BUSINESS_NAME` | optional, your shop name for customer emails |
| `TIMEZONE` | optional, default `America/Los_Angeles` |

Then go to **Deployments** and click **Redeploy** so the new variables are used.

## 4. Use it

Open your Vercel URL, sign in with the user you created in Supabase, and add rentals.

## Automatic emails

`vercel.json` runs `/api/send-reminders` once a day at 17:00 UTC (9 AM Pacific in winter, 10 AM in summer). On Vercel's free Hobby plan it can run any time within that hour. To change the time, edit the `schedule` (it is in UTC) and redeploy.

Each morning it:
- finds active rentals with a reminder dated today (or up to 3 days ago if a run was missed),
- emails you the item, customer, phone and return date,
- emails the customer too, if you ticked "Also email the customer" and they have an email,
- marks the reminder as **Sent** so it goes out only once.

**Test it now** (replace the values):
```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://YOUR-APP.vercel.app/api/send-reminders
```
It replies with what it sent. To test, make a rental with a reminder for today first.

You can also see each run under **Vercel > Project > Settings > Cron Jobs** (and its logs).

## Files

- `public/index.html`, `public/app.js`: the app
- `api/config.js`: passes the public Supabase settings to the app
- `api/send-reminders.js`: the daily email job
- `schema.sql`: database tables, security rules and photo storage
- `vercel.json`: the daily schedule
