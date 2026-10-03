-- ==============================================================================
-- TIFFIN SYSTEM: REMOVE DEFAULT HOUSEHOLD AUTO-ASSIGNMENT ON USER SIGNUP
-- ==============================================================================
-- Run this script in your Supabase Dashboard -> SQL Editor
-- This updates handle_new_auth_user() so that new users start with NO household
-- (household_id = NULL) and are prompted to create or join a household.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
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

    -- Upsert user record into app_users with household_id = NULL
    -- New signups start unassigned and are directed to Create or Join a household
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
        NULL,
        v_avatar_url
    )
    ON CONFLICT (id) DO UPDATE SET
        email = COALESCE(EXCLUDED.email, public.app_users.email),
        full_name = COALESCE(EXCLUDED.full_name, public.app_users.full_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.app_users.avatar_url);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-attach trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
