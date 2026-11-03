# admin-users function

Lets an administrator create, edit, disable and delete users, and reset passwords, from the POS Users page.
It runs on Supabase so the secret key never reaches the app. Only users whose role is administrator can use it.
Until it is deployed, the Users page shows "The admin-users function is not deployed yet".

## Easiest: deploy from the Supabase website (nothing to install)
1. Open your project at supabase.com > **Edge Functions** > **Deploy a new function** > **Via Editor**.
2. Name it exactly `admin-users`.
3. Delete the sample code and paste the whole of `index.ts` from this folder. Click **Deploy**.
4. Open the function's settings and turn **Verify JWT** OFF, then save. (The function checks the sign-in itself, and
   projects using the newer API keys can have the website's JWT check reject valid users.)
5. In the POS, open Users and try adding a user.

No secrets need to be set: Supabase gives the function its own address and keys.

## With the command line instead
1. `npx supabase@latest login`
2. `npx supabase@latest link --project-ref YOUR-PROJECT-REF`
3. `npx supabase@latest functions deploy admin-users --no-verify-jwt`
