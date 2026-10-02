-- ==============================================================================
-- TIFFIN SYSTEM: GOOGLE OAUTH & SUPABASE AUTH INTEGRATION MIGRATION
-- ==============================================================================
-- Run this script in your Supabase Dashboard -> SQL Editor
-- ==============================================================================

-- 1. MODIFY APP_USERS FOR OAUTH COMPATIBILITY
-- Allow OAuth users who do not have a local password hash
ALTER TABLE public.app_users ALTER COLUMN password_hash DROP NOT NULL;

-- Add optional email and avatar_url to app_users if not present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'app_users' AND column_name = 'email'
    ) THEN
        ALTER TABLE public.app_users ADD COLUMN email TEXT UNIQUE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'app_users' AND column_name = 'avatar_url'
    ) THEN
        ALTER TABLE public.app_users ADD COLUMN avatar_url TEXT;
    END IF;
END $$;

-- 2. TRIGGER FUNCTION TO SYNC SUPABASE AUTH USERS (GOOGLE OAUTH) TO APP_USERS
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
    v_household_id UUID;
    v_full_name TEXT;
    v_username TEXT;
    v_avatar_url TEXT;
    v_base_username TEXT;
    v_counter INT := 0;
BEGIN
    -- Extract profile metadata provided by Google OAuth / Supabase Auth
    v_full_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'name',
        split_part(NEW.email, '@', 1)
    );

    v_avatar_url := COALESCE(
        NEW.raw_user_meta_data->>'avatar_url',
        NEW.raw_user_meta_data->>'picture'
    );

    -- Generate a clean unique username
    v_base_username := lower(regexp_replace(
        COALESCE(NEW.raw_user_meta_data->>'user_name', split_part(NEW.email, '@', 1)),
        '[^a-zA-Z0-9_]',
        '',
        'g'
    ));

    IF v_base_username = '' OR v_base_username IS NULL THEN
        v_base_username := 'user';
    END IF;

    v_username := v_base_username;

    -- Avoid username conflict
    WHILE EXISTS (SELECT 1 FROM public.app_users WHERE username = v_username AND id != NEW.id) LOOP
        v_counter := v_counter + 1;
        v_username := v_base_username || '_' || v_counter::text;
    END LOOP;

    -- Look up default primary household if available
    SELECT id INTO v_household_id FROM public.households ORDER BY created_at ASC LIMIT 1;

    -- Upsert user record into app_users
    INSERT INTO public.app_users (
        id,
        username,
        email,
        password_hash,
        full_name,
        role,
        household_id,
        avatar_url
    )
    VALUES (
        NEW.id,
        v_username,
        NEW.email,
        'oauth_managed',
        v_full_name,
        'household_member',
        v_household_id,
        v_avatar_url
    )
    ON CONFLICT (id) DO UPDATE SET
        email = COALESCE(EXCLUDED.email, public.app_users.email),
        full_name = COALESCE(EXCLUDED.full_name, public.app_users.full_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.app_users.avatar_url);

    -- Ensure household membership in household_members table
    IF v_household_id IS NOT NULL THEN
        INSERT INTO public.household_members (household_id, user_id, role_in_household)
        VALUES (v_household_id, NEW.id, 'member')
        ON CONFLICT (household_id, user_id) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. CREATE OR REPLACE THE TRIGGER ON auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Optional: Backfill any existing auth.users into app_users
INSERT INTO public.app_users (id, username, email, password_hash, full_name, role, household_id)
SELECT 
    u.id,
    lower(regexp_replace(COALESCE(u.raw_user_meta_data->>'user_name', split_part(u.email, '@', 1)), '[^a-zA-Z0-9_]', '', 'g')) || '_' || substr(u.id::text, 1, 4),
    u.email,
    'oauth_managed',
    COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
    'household_member',
    (SELECT id FROM public.households ORDER BY created_at ASC LIMIT 1)
FROM auth.users u
ON CONFLICT (id) DO NOTHING;
