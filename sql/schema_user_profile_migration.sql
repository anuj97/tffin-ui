-- ==============================================================================
-- TIFFIN SYSTEM: USER PROFILE & PASSWORD MANAGEMENT MIGRATION
-- ==============================================================================
-- Run this script in your Supabase Dashboard -> SQL Editor
-- ==============================================================================

-- 1. ADD PROFILE COLUMNS TO APP_USERS IF NOT PRESENT
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'app_users' AND column_name = 'phone'
    ) THEN
        ALTER TABLE public.app_users ADD COLUMN phone TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'app_users' AND column_name = 'dietary_preferences'
    ) THEN
        ALTER TABLE public.app_users ADD COLUMN dietary_preferences TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'app_users' AND column_name = 'bio'
    ) THEN
        ALTER TABLE public.app_users ADD COLUMN bio TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'app_users' AND column_name = 'avatar_url'
    ) THEN
        ALTER TABLE public.app_users ADD COLUMN avatar_url TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'app_users' AND column_name = 'email'
    ) THEN
        ALTER TABLE public.app_users ADD COLUMN email TEXT UNIQUE;
    END IF;
END $$;

-- 2. SECURE STORED PROCEDURE FOR PASSWORD UPDATES
CREATE OR REPLACE FUNCTION public.update_app_user_password(
    p_user_id UUID,
    p_current_password TEXT,
    p_new_password TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    v_stored_hash TEXT;
    v_is_valid BOOLEAN := false;
BEGIN
    -- Retrieve existing hash
    SELECT password_hash INTO v_stored_hash
    FROM public.app_users
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- If user was oauth_managed or has no password hash set yet, allow setting initial password
    IF v_stored_hash IS NULL OR v_stored_hash = 'oauth_managed' OR p_current_password IS NULL OR p_current_password = '' THEN
        v_is_valid := true;
    ELSE
        -- Validate current password with crypt
        v_is_valid := (v_stored_hash = crypt(p_current_password, v_stored_hash));
    END IF;

    IF v_is_valid THEN
        UPDATE public.app_users
        SET password_hash = crypt(p_new_password, gen_salt('bf'))
        WHERE id = p_user_id;
        RETURN true;
    ELSE
        RETURN false;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. ROW-LEVEL SECURITY POLICIES FOR APP_USERS
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view app_users" ON public.app_users;
CREATE POLICY "Users can view app_users" ON public.app_users
FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.app_users;
CREATE POLICY "Users can update own profile" ON public.app_users
FOR UPDATE USING (
    id = auth.uid() 
    OR auth.uid() IS NULL 
    OR EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = auth.uid() AND u.role = 'admin')
) WITH CHECK (
    id = auth.uid() 
    OR auth.uid() IS NULL 
    OR EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = auth.uid() AND u.role = 'admin')
);
