// Runs every morning (see vercel.json). Finds reminders that are due today,
// emails them with Resend, and marks them as sent so they go out only once.

const TZ = process.env.TIMEZONE || 'America/Los_Angeles';
const BUSINESS = process.env.BUSINESS_NAME || 'Rental Desk';

const todayIn = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const asDate = s => new Date(s + 'T00:00:00Z');
const diff = (a, b) => Math.round((asDate(b) - asDate(a)) / 864e5);
const nice = s =>
  asDate(s).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

async function rest(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/' + path, {
    ...opts,
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (await r.text()));
  return r.status === 204 ? null : r.json();
}

async function send(to, subject, text, replyTo) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.FROM_EMAIL, to: [to], subject, text, ...(replyTo ? { reply_to: replyTo } : {}) })
  });
  if (!r.ok) throw new Error('Resend ' + r.status + ': ' + (await r.text()));
}

export default async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'FROM_EMAIL']) {
    if (!process.env[k]) return res.status(500).json({ error: 'Missing environment variable ' + k });
  }

  const today = todayIn();
  const log = [];
  try {
    const settings = await rest('settings?select=*');
    const byOwner = Object.fromEntries(settings.map(s => [s.owner_id, s]));
    const rentals = await rest('rentals?status=eq.active&select=*');

    for (const r of rentals) {
      const rem = Array.isArray(r.reminders) ? r.reminders : [];
      const due = rem.filter(x => !x.sent && x.date <= today);
      if (!due.length) continue;

      // Reminders more than 3 days late are marked skipped instead of sent.
      const fresh = due.filter(x => diff(x.date, today) <= 3);
      const owner = (byOwner[r.owner_id] && byOwner[r.owner_id].owner_email) || process.env.OWNER_EMAIL;
      const left = diff(today, r.end_date);
      const when = left > 0 ? `${left} day${left === 1 ? '' : 's'} left`
        : left === 0 ? 'Due back today' : `${-left} day${left === -1 ? '' : 's'} overdue`;
      const item = r.item_name + (r.item_tag ? ` (tag ${r.item_tag})` : '') + (r.qty > 1 ? ` x ${r.qty}` : '');
      const sentTo = [];

      if (fresh.length) {
        try {
          if (owner) {
            await send(owner, `Collect: ${r.item_name} from ${r.customer_name} by ${nice(r.end_date)}`, [
              `Reminder: ${fresh.map(x => x.label).join(', ')}`,
              '',
              `Item: ${item}`,
              `Customer: ${r.customer_name}`,
              r.customer_phone ? `Phone: ${r.customer_phone}` : '',
              r.customer_email ? `Email: ${r.customer_email}` : '',
              `Rented on: ${r.start_date ? nice(r.start_date) : '-'}`,
              `Return by: ${nice(r.end_date)}`,
              `Status: ${when}`,
              r.deposit != null ? `Deposit held: ${Number(r.deposit).toFixed(2)}` : ''
            ].filter(Boolean).join('\n'));
            sentTo.push(owner);
          }
          if (r.email_customer && r.customer_email) {
            await send(r.customer_email, `Reminder: please return ${r.item_name} by ${nice(r.end_date)}`, [
              `Hi ${r.customer_name},`,
              '',
              `This is a friendly reminder that the ${item} you rented from ${BUSINESS} is due back on ${nice(r.end_date)}.`,
              '',
              'If you need a little more time, just reply to this email and let us know.',
              '',
              'Thank you!',
              BUSINESS
            ].join('\n'), owner);
            sentTo.push(r.customer_email);
          }
        } catch (e) {
          log.push({ id: r.id, item: r.item_name, error: e.message });
          continue; // not marked as sent, so it will try again tomorrow
        }
      }

      const dueIds = new Set(due.map(x => x.id));
      const freshIds = new Set(fresh.map(x => x.id));
      const next = rem.map(x => dueIds.has(x.id)
        ? { ...x, sent: true, sentAt: today, ...(freshIds.has(x.id) ? {} : { skipped: true }) }
        : x);
      await rest('rentals?id=eq.' + encodeURIComponent(r.id), {
        method: 'PATCH', body: JSON.stringify({ reminders: next }), headers: { Prefer: 'return=minimal' }
      });
      log.push({ item: r.item_name, customer: r.customer_name, sentTo });
    }
    res.status(200).json({ today, processed: log });
  } catch (e) {
    res.status(500).json({ today, error: e.message, processed: log });
  }
}
