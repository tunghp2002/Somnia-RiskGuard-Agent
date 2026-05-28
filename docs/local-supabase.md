# Local Supabase Setup

Use local Supabase first so API storage, RLS, and Telegram check-in can be tested without production keys.

1. Install Supabase CLI.

   ```powershell
   winget install Supabase.CLI
   ```

2. Start local Supabase if you want a disposable local database.

   ```powershell
   supabase init
   supabase start
   ```

3. Run the setup SQL in Supabase SQL Editor.

   Use `infra/supabase/setup.sql`. It creates the required tables if they do not exist.

4. Copy the local values printed by `supabase status` into `.env`.

   ```env
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_SERVICE_ROLE_KEY=<local service_role key>
   SESSION_KEY_ENCRYPTION_KEY=0x1111111111111111111111111111111111111111111111111111111111111111
   THIRDWEB_SECRET_KEY=<backend-only thirdweb secret key>
   ```

5. Keep the frontend API URL local while testing.

   ```env
   NEXT_PUBLIC_AGENT_API_URL=http://localhost:3001
   ```

The backend uses the service role key only on the server. The `anon` and `authenticated` roles have no direct table access; browser calls must go through the agent API.
