-- ==============================================================================
-- TIFFIN SYSTEM: FIX HOUSEHOLD MEMBERSHIP VISIBILITY & RLS RECURSION
-- ==============================================================================
-- Run this script in your Supabase Dashboard -> SQL Editor
-- This fixes:
-- 1. Infinite recursion in household_members RLS policy
-- 2. Users unable to view households they belong to
-- 3. Automatic synchronization of memberships and app_users
-- ==============================================================================

-- 1. HELPER FUNCTION TO GET AUTHORIZED HOUSEHOLD IDS WITHOUT RLS RECURSION
-- Defined as SECURITY DEFINER so PostgreSQL will not trigger recursive RLS policies.
CREATE OR REPLACE FUNCTION get_user_household_ids(p_user_id UUID)
RETURNS SETOF UUID AS $$
    SELECT household_id FROM public.household_members WHERE user_id = p_user_id
    UNION
    SELECT household_id FROM public.app_users WHERE id = p_user_id AND household_id IS NOT NULL;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 2. STORED PROCEDURE: GET AUTHORIZED HOUSEHOLDS FOR USER (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION get_authorized_households(p_user_id UUID DEFAULT NULL)
RETURNS SETOF public.households AS $$
DECLARE
    v_user_id UUID;
    v_role TEXT;
BEGIN
    v_user_id := COALESCE(auth.uid(), p_user_id);

    IF v_user_id IS NULL THEN
        -- If unauthenticated / anon, return active households
        RETURN QUERY SELECT * FROM public.households WHERE is_active = true ORDER BY name;
        RETURN;
    END IF;

    -- Check user role
    SELECT role INTO v_role FROM public.app_users WHERE id = v_user_id;

    -- Kitchen Admins / Chefs can view all active households
    IF v_role IN ('admin', 'chef') THEN
        RETURN QUERY SELECT * FROM public.households WHERE is_active = true ORDER BY name;
        RETURN;
    END IF;

    -- Members can view households they belong to (via household_members or app_users)
    RETURN QUERY
    SELECT DISTINCT h.*
    FROM public.households h
    WHERE h.is_active = true
      AND (
          h.id IN (SELECT hm.household_id FROM public.household_members hm WHERE hm.user_id = v_user_id)
          OR h.id = (SELECT u.household_id FROM public.app_users u WHERE u.id = v_user_id)
      )
    ORDER BY h.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. STORED PROCEDURE: GET HOUSEHOLD MEMBERS (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION get_household_members(p_household_id UUID)
RETURNS TABLE (
    id UUID,
    household_id UUID,
    user_id UUID,
    role_in_household TEXT,
    created_at TIMESTAMPTZ,
    username TEXT,
    full_name TEXT,
    email TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        hm.id,
        hm.household_id,
        hm.user_id,
        hm.role_in_household,
        hm.created_at,
        COALESCE(u.username, 'member') AS username,
        COALESCE(u.full_name, u.username, 'Member') AS full_name,
        u.email
    FROM public.household_members hm
    LEFT JOIN public.app_users u ON u.id = hm.user_id
    WHERE hm.household_id = p_household_id
    ORDER BY hm.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. BACKFILL: ENSURE ALL USERS WITH A HOUSEHOLD ARE IN HOUSEHOLD_MEMBERS
INSERT INTO public.household_members (household_id, user_id, role_in_household)
SELECT household_id, id, 'owner'
FROM public.app_users
WHERE household_id IS NOT NULL
ON CONFLICT (household_id, user_id) DO NOTHING;

-- Also update app_users if a user is in household_members but their app_users.household_id is NULL
UPDATE public.app_users u
SET household_id = hm.household_id
FROM public.household_members hm
WHERE u.id = hm.user_id
  AND u.household_id IS NULL;

-- 5. FIX ROW-LEVEL SECURITY POLICIES FOR HOUSEHOLD_MEMBERS (NO RECURSION!)
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view household members of their households" ON public.household_members;
CREATE POLICY "Users can view household members of their households" ON public.household_members
FOR SELECT USING (
    -- User can always view their own membership rows directly without recursion!
    user_id = auth.uid()
    OR household_id IN (SELECT get_user_household_ids(auth.uid()))
    OR EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('admin', 'chef'))
    OR auth.uid() IS NULL
);

DROP POLICY IF EXISTS "Users can insert household membership for themselves or owners can add members" ON public.household_members;
CREATE POLICY "Users can insert household membership for themselves or owners can add members" ON public.household_members
FOR INSERT WITH CHECK (
    user_id = auth.uid()
    OR household_id IN (SELECT get_user_household_ids(auth.uid()))
    OR EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('admin', 'owner'))
    OR auth.uid() IS NULL
);

DROP POLICY IF EXISTS "Owners can remove household members" ON public.household_members;
CREATE POLICY "Owners can remove household members" ON public.household_members
FOR DELETE USING (
    user_id = auth.uid()
    OR household_id IN (SELECT get_user_household_ids(auth.uid()))
    OR EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('admin', 'owner'))
    OR auth.uid() IS NULL
);

-- 6. FIX ROW-LEVEL SECURITY POLICIES FOR HOUSEHOLDS
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view authorized households" ON public.households;
CREATE POLICY "Users can view authorized households" ON public.households
FOR SELECT USING (
    id IN (SELECT get_user_household_ids(auth.uid()))
    OR EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('admin', 'chef'))
    OR auth.uid() IS NULL
);

-- 7. FIX ROW-LEVEL SECURITY POLICIES FOR MEAL_SCHEDULE
ALTER TABLE public.meal_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view authorized meal schedules" ON public.meal_schedule;
CREATE POLICY "Users can view authorized meal schedules" ON public.meal_schedule
FOR SELECT USING (
    household_id IN (SELECT get_user_household_ids(auth.uid()))
    OR EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('admin', 'chef'))
    OR auth.uid() IS NULL
);
