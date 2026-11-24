// Gives the browser the public Supabase settings.
// The anon key is meant to be public: Row Level Security in schema.sql protects the data.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || ''
  });
}
