# Town Red Supabase

Town Red keeps its database schema in `supabase/migrations/`. Commit these files to Git; do not commit `supabase/.temp/`.

## Local development

From the repository root:

```bash
npm install
npx supabase start
npx supabase db reset
```

`db reset` rebuilds the local database from the checked-in migrations. Use it to validate that a fresh Town Red backend can be recreated entirely from Git.

## Link a development checkout to the hosted project

Authenticate the CLI and link this checkout to the hosted Supabase project:

```bash
npx supabase login
npx supabase link --project-ref oikkiayjonjouernvjhw
```

The link creates local state under `supabase/.temp/`, which must remain ignored by Git.

## One-time migration-history baseline for the existing hosted project

The hosted Town Red database was originally created manually before the migration files were added to this repository. That means its *schema* may already contain the changes represented by the first migrations even if Supabase's migration-history table does not record them.

Before the first `db push`, inspect local versus remote migration history:

```bash
npx supabase migration list
```

If the hosted project already contains the schema from these two migrations but they are shown as local-only:

```text
20260819180000_initial_collaborative_schema.sql
20260819181000_anonymous_invites.sql
```

mark those versions as already applied on the remote project:

```bash
npx supabase migration repair --status applied 20260819180000
npx supabase migration repair --status applied 20260819181000
```

Then run `migration list` again. The local and remote history should agree for those versions.

Do **not** mark a migration applied merely to silence an error: only repair history when the corresponding schema change is genuinely already present in the hosted database.

## Deploy pending migrations

Once migration history is baselined, preview what would be applied:

```bash
npx supabase db push --dry-run
```

Then deploy pending migrations:

```bash
npx supabase db push
```

For the friendly-name feature, the pending migration is:

```text
20260819193000_profiles.sql
```

It creates `public.profiles`, enables RLS, lets users create/update only their own display profile, and permits profile-name reads only between users who share access to at least one Town Red map.

## Normal workflow after the baseline

For future database changes:

1. Add a new timestamped migration under `supabase/migrations/`.
2. Run `npx supabase db reset` locally.
3. Test the frontend against the local database where practical.
4. Commit the migration with the application change.
5. Run `npx supabase db push --dry-run` against the linked hosted project.
6. Run `npx supabase db push` to deploy it.

Never put a service-role or secret key in the frontend or in committed environment files.
