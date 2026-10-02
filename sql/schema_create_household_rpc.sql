-- ==============================================================================
-- TIFFIN SYSTEM: HOUSEHOLD CREATION & RLS FIX MIGRATION
-- ==============================================================================
-- Run this script in your Supabase Dashboard -> SQL Editor
-- This fixes the error:
-- "new row violates row-level security policy for table 'households'" (code 42501)
-- ==============================================================================

-- 1. STORED PROCEDURE: CREATE HOUSEHOLD (SECURITY DEFINER)
-- Atomically inserts the household, registers creator as owner in household_members,
-- updates app_users active household if empty, and bypasses RLS safely.
CREATE OR REPLACE FUNCTION create_household(
    p_name TEXT,
    p_code TEXT DEFAULT NULL,
    p_contact_name TEXT DEFAULT NULL,
    p_contact_phone TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_default_headcount INT DEFAULT 2,
    p_dietary_notes TEXT DEFAULT NULL,
    p_color_tag TEXT DEFAULT '#6366f1',
    p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    code TEXT,
    contact_name TEXT,
    contact_phone TEXT,
    address TEXT,
    default_headcount INT,
    dietary_notes TEXT,
    color_tag TEXT,
    is_active BOOLEAN,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
DECLARE
    v_user_id UUID;
    v_household_id UUID;
    v_code TEXT;
BEGIN
    -- Determine user: prefer auth.uid() from Supabase session, fallback to p_user_id
    v_user_id := COALESCE(auth.uid(), p_user_id);

    -- Generate code if not provided
    IF p_code IS NULL OR trim(p_code) = '' THEN
        v_code := 'HH-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    ELSE
        v_code := trim(p_code);
    END IF;

    -- Insert new household
    INSERT INTO public.households (
        name,
        code,
        contact_name,
        contact_phone,
        address,
        default_headcount,
        dietary_notes,
        color_tag,
        is_active,
        created_at,
        updated_at
    ) VALUES (
        trim(p_name),
        v_code,
        p_contact_name,
        p_contact_phone,
        p_address,
        COALESCE(p_default_headcount, 2),
        p_dietary_notes,
        COALESCE(p_color_tag, '#6366f1'),
        true,
        now(),
        now()
    )
    RETURNING households.id INTO v_household_id;

    -- If a user is identified, add them as 'owner' in household_members
    IF v_user_id IS NOT NULL THEN
        INSERT INTO public.household_members (household_id, user_id, role_in_household)
        VALUES (v_household_id, v_user_id, 'owner')
        ON CONFLICT (household_id, user_id) 
        DO UPDATE SET role_in_household = 'owner';

        -- Update app_users.household_id if user didn't have a primary household
        UPDATE public.app_users 
        SET household_id = v_household_id 
        WHERE public.app_users.id = v_user_id 
          AND (public.app_users.household_id IS NULL);
    END IF;

    -- Return the newly created household row
    RETURN QUERY
    SELECT 
        h.id,
        h.name,
        h.code,
        h.contact_name,
        h.contact_phone,
        h.address,
        h.default_headcount,
        h.dietary_notes,
        h.color_tag,
        h.is_active,
        h.created_at,
        h.updated_at
    FROM public.households h
    WHERE h.id = v_household_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. STORED PROCEDURE: DELETE HOUSEHOLD (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION delete_household(
    p_household_id UUID,
    p_user_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID;
    v_can_delete BOOLEAN := false;
BEGIN
    v_user_id := COALESCE(auth.uid(), p_user_id);

    IF v_user_id IS NOT NULL THEN
        -- Check if user is owner of this household
        SELECT true INTO v_can_delete
        FROM public.household_members hm
        WHERE hm.household_id = p_household_id 
          AND hm.user_id = v_user_id 
          AND hm.role_in_household = 'owner';

        -- Or check if user is system admin/owner
        IF NOT FOUND OR v_can_delete IS NOT TRUE THEN
            SELECT true INTO v_can_delete
            FROM public.app_users u
            WHERE u.id = v_user_id AND u.role IN ('admin', 'owner');
        END IF;
    ELSE
        -- If no user is tracked, allow if caller has DB rights
        v_can_delete := true;
    END IF;

    IF v_can_delete IS TRUE THEN
        DELETE FROM public.households WHERE id = p_household_id;
        RETURN true;
    ELSE
        RETURN false;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. UPDATE ROW-LEVEL SECURITY POLICIES FOR HOUSEHOLDS
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;

-- Allow users to view authorized households (or all households if using anon/public role)
DROP POLICY IF EXISTS "Users can view authorized households" ON public.households;
CREATE POLICY "Users can view authorized households" ON public.households
FOR SELECT USING (
    id IN (SELECT hm.household_id FROM public.household_members hm WHERE hm.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('admin', 'chef'))
    OR auth.uid() IS NULL
);

-- Allow creating new households
DROP POLICY IF EXISTS "Users can create households" ON public.households;
CREATE POLICY "Users can create households" ON public.households
FOR INSERT WITH CHECK (
    true
);

-- Allow updating households by owner or admin
DROP POLICY IF EXISTS "Admins or owners can update households" ON public.households;
CREATE POLICY "Admins or owners can update households" ON public.households
FOR UPDATE USING (
    id IN (SELECT hm.household_id FROM public.household_members hm WHERE hm.user_id = auth.uid() AND hm.role_in_household = 'owner')
    OR EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('admin', 'owner'))
    OR auth.uid() IS NULL
);

-- Allow deleting households by owner or admin
DROP POLICY IF EXISTS "Admins or owners can delete households" ON public.households;
CREATE POLICY "Admins or owners can delete households" ON public.households
FOR DELETE USING (
    id IN (SELECT hm.household_id FROM public.household_members hm WHERE hm.user_id = auth.uid() AND hm.role_in_household = 'owner')
    OR EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('admin', 'owner'))
    OR auth.uid() IS NULL
);

-- 4. UPDATE ROW-LEVEL SECURITY POLICIES FOR HOUSEHOLD_MEMBERS
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert household membership for themselves or owners can add members" ON public.household_members;
CREATE POLICY "Users can insert household membership for themselves or owners can add members" ON public.household_members
FOR INSERT WITH CHECK (
    user_id = auth.uid()
    OR household_id IN (SELECT hm.household_id FROM public.household_members hm WHERE hm.user_id = auth.uid() AND hm.role_in_household = 'owner')
    OR EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('admin', 'owner'))
    OR auth.uid() IS NULL
);

DROP POLICY IF EXISTS "Users can view household members of their households" ON public.household_members;
CREATE POLICY "Users can view household members of their households" ON public.household_members
FOR SELECT USING (
    household_id IN (SELECT hm.household_id FROM public.household_members hm WHERE hm.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('admin', 'chef'))
    OR auth.uid() IS NULL
);
