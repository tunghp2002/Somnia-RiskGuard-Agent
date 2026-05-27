# Local Supabase Setup

Use local Supabase first so API storage, RLS, and Telegram check-in can be tested without production keys.

1. Install Supabase CLI.

   ```powershell
   winget install Supabase.CLI
   ```

2. Initialize the local Supabase project if the CLI asks for config, then start it from the repo root.

   ```powershell
   supabase init
   supabase start
   supabase db reset
   ```

3. Copy the local values printed by `supabase status` into `.env`.

   ```env
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_SERVICE_ROLE_KEY=<local service_role key>
   SESSION_KEY_ENCRYPTION_KEY=0x1111111111111111111111111111111111111111111111111111111111111111
   ```

4. Keep the frontend API URL local while testing.

   ```env
   NEXT_PUBLIC_AGENT_API_URL=http://localhost:3001
   ```

The backend uses the service role key only on the server. The `anon` and `authenticated` roles have no direct table access; browser calls must go through the agent API.
