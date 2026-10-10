-- ==============================================================================
-- TIFFIN SYSTEM: HOUSEHOLD MEMBERSHIP HARDENING & AUTHORITY MIGRATION
-- ==============================================================================
-- Run this script in your Supabase Dashboard -> SQL Editor
-- This migration fixes:
-- 1. Makes `household_members` table the authoritative source of membership truth.
-- 2. Solves infinite RLS recursion on `household_members` and `households`.
-- 3. Adds SECURITY DEFINER RPCs `get_user_memberships` and `get_household_members`.
-- 4. Ensures `get_authorized_households` handles NULL is_active and client-passed user_id.
-- 5. Ensures every household has at least one 'owner' in household_members.
-- 6. Ensures `accept_household_invitation` initializes primary household if NULL.
-- 7. Grants EXECUTE permissions to authenticated and anon roles.
-- ==============================================================================

-- 0. SCHEMA SAFETY: Ensure email and avatar_url exist on app_users
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'app_users' AND column_name = 'email'
    ) THEN
        ALTER TABLE public.app_users ADD COLUMN email TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'app_users' AND column_name = 'avatar_url'
    ) THEN
        ALTER TABLE public.app_users ADD COLUMN avatar_url TEXT;
    END IF;
END $$;

-- 1. HELPER FUNCTION TO GET AUTHORIZED HOUSEHOLD IDS (AUTHORITATIVE & NON-RECURSIVE)
-- Defined as SECURITY DEFINER so PostgreSQL will not trigger recursive RLS policies.
CREATE OR REPLACE FUNCTION get_user_household_ids(p_user_id UUID)
RETURNS SETOF UUID AS $$
    -- If user has records in household_members, those are strictly authoritative
    SELECT household_id FROM public.household_members WHERE user_id = p_user_id
    UNION
    -- Fallback to app_users.household_id ONLY if user has no entries in household_members
    SELECT household_id FROM public.app_users 
    WHERE id = p_user_id 
      AND household_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.household_members WHERE user_id = p_user_id);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 2. STORED PROCEDURE: GET AUTHORIZED HOUSEHOLDS FOR USER (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION get_authorized_households(p_user_id UUID DEFAULT NULL)
RETURNS SETOF public.households AS $$
DECLARE
    v_user_id UUID;
    v_role TEXT;
BEGIN
    v_user_id := COALESCE(p_user_id, auth.uid());

    IF v_user_id IS NULL THEN
        -- If unauthenticated / anon, return active households
        RETURN QUERY SELECT * FROM public.households WHERE COALESCE(is_active, true) = true ORDER BY name;
        RETURN;
    END IF;

    -- Check user role
    SELECT role INTO v_role FROM public.app_users WHERE id = v_user_id;

    -- Kitchen Admins / Chefs can view all active households
    IF v_role IN ('admin', 'chef') THEN
        RETURN QUERY SELECT * FROM public.households WHERE COALESCE(is_active, true) = true ORDER BY name;
        RETURN;
    END IF;

    -- Members can view households they belong to:
    -- Authoritatively via household_members; falls back to app_users only if no memberships exist.
    RETURN QUERY
    SELECT DISTINCT h.*
    FROM public.households h
    WHERE COALESCE(h.is_active, true) = true
      AND (
          h.id IN (SELECT hm.household_id FROM public.household_members hm WHERE hm.user_id = v_user_id)
          OR (
              NOT EXISTS (SELECT 1 FROM public.household_members hm WHERE hm.user_id = v_user_id)
              AND h.id = (SELECT u.household_id FROM public.app_users u WHERE u.id = v_user_id)
          )
      )
    ORDER BY h.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. STORED PROCEDURE: GET USER MEMBERSHIPS (SECURITY DEFINER)
-- Allows direct retrieval of user's household memberships without hitting RLS policies.
CREATE OR REPLACE FUNCTION get_user_memberships(p_user_id UUID DEFAULT NULL)
RETURNS TABLE (
    household_id UUID,
    role_in_household TEXT
) AS $$
DECLARE
    v_user_id UUID;
BEGIN
    v_user_id := COALESCE(p_user_id, auth.uid());

    IF v_user_id IS NULL THEN
        RETURN;
    END IF;

    -- 1. Authoritative rows from household_members
    RETURN QUERY
    SELECT hm.household_id, COALESCE(hm.role_in_household, 'owner')::TEXT
    FROM public.household_members hm
    WHERE hm.user_id = v_user_id;

    -- 2. Fallback to app_users.household_id ONLY if no records exist in household_members
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT u.household_id, 'owner'::TEXT
        FROM public.app_users u
        WHERE u.id = v_user_id AND u.household_id IS NOT NULL;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. STORED PROCEDURE: GET HOUSEHOLD MEMBERS (SECURITY DEFINER)
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
        COALESCE(hm.role_in_household, 'owner')::TEXT AS role_in_household,
        hm.created_at,
        COALESCE(u.username, 'member')::TEXT AS username,
        COALESCE(u.full_name, u.username, 'Member')::TEXT AS full_name,
        u.email::TEXT AS email
    FROM public.household_members hm
    LEFT JOIN public.app_users u ON u.id = hm.user_id
    WHERE hm.household_id = p_household_id
    ORDER BY hm.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. ROW-LEVEL SECURITY (RLS) POLICIES FOR HOUSEHOLD_MEMBERS (NON-RECURSIVE)
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view household members of their households" ON public.household_members;
CREATE POLICY "Users can view household members of their households" ON public.household_members
FOR SELECT USING (
    -- User can always directly view their own membership rows without any subquery!
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

-- 6. ROW-LEVEL SECURITY (RLS) POLICIES FOR HOUSEHOLDS (NON-RECURSIVE)
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view authorized households" ON public.households;
CREATE POLICY "Users can view authorized households" ON public.households
FOR SELECT USING (
    id IN (SELECT get_user_household_ids(auth.uid()))
    OR EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('admin', 'chef'))
    OR auth.uid() IS NULL
);

-- 7. ROW-LEVEL SECURITY (RLS) POLICIES FOR MEAL_SCHEDULE (NON-RECURSIVE)
ALTER TABLE public.meal_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view authorized meal schedules" ON public.meal_schedule;
CREATE POLICY "Users can view authorized meal schedules" ON public.meal_schedule
FOR SELECT USING (
    household_id IN (SELECT get_user_household_ids(auth.uid()))
    OR EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('admin', 'chef'))
    OR auth.uid() IS NULL
);

-- 8. STORED PROCEDURE: ACCEPT HOUSEHOLD INVITATION (INITIALIZE PRIMARY HOUSEHOLD IF NULL)
CREATE OR REPLACE FUNCTION accept_household_invitation(
    p_invite_code TEXT,
    p_user_id UUID
)
RETURNS TABLE (
    success BOOLEAN,
    message TEXT,
    household_id UUID,
    household_name TEXT,
    role_in_household TEXT
) AS $$
DECLARE
    v_inv RECORD;
    v_hh_name TEXT;
BEGIN
    SELECT i.*, h.name as hh_name INTO v_inv
    FROM household_invitations i
    JOIN households h ON h.id = i.household_id
    WHERE upper(trim(i.invite_code)) = upper(trim(p_invite_code));

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'Invitation code not found'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    IF v_inv.status != 'pending' THEN
        RETURN QUERY SELECT false, ('Invitation is already ' || v_inv.status)::TEXT, v_inv.household_id, v_inv.hh_name, v_inv.role_in_household;
        RETURN;
    END IF;

    IF v_inv.expires_at < now() THEN
        UPDATE household_invitations SET status = 'expired' WHERE id = v_inv.id;
        RETURN QUERY SELECT false, 'Invitation has expired'::TEXT, v_inv.household_id, v_inv.hh_name, v_inv.role_in_household;
        RETURN;
    END IF;

    -- Add user to household_members join table
    INSERT INTO household_members (household_id, user_id, role_in_household)
    VALUES (v_inv.household_id, p_user_id, COALESCE(v_inv.role_in_household, 'member'))
    ON CONFLICT (household_id, user_id) 
    DO UPDATE SET role_in_household = EXCLUDED.role_in_household;

    -- Mark invitation as accepted
    UPDATE household_invitations 
    SET status = 'accepted', accepted_at = now(), accepted_by = p_user_id
    WHERE id = v_inv.id;

    -- Update app_users.household_id if user currently has no primary household
    UPDATE public.app_users
    SET household_id = v_inv.household_id
    WHERE id = p_user_id AND household_id IS NULL;

    RETURN QUERY SELECT true, 'Successfully joined household'::TEXT, v_inv.household_id, v_inv.hh_name, v_inv.role_in_household;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. RECONCILIATION: CLEAN UP ROLES & ORPHANED PRIMARY REFERENCES
-- Ensure every household has at least one 'owner' in household_members:
-- If a household has members but no member marked as 'owner', promote the earliest member to 'owner'
UPDATE public.household_members hm
SET role_in_household = 'owner'
WHERE hm.id IN (
    SELECT DISTINCT ON (household_id) id
    FROM public.household_members
    WHERE household_id NOT IN (
        SELECT DISTINCT household_id FROM public.household_members WHERE role_in_household = 'owner'
    )
    ORDER BY household_id, created_at ASC
);

-- Default any NULL role_in_household to 'owner'
UPDATE public.household_members
SET role_in_household = 'owner'
WHERE role_in_household IS NULL;

-- If a user has memberships in household_members, but their app_users.household_id points
-- to a household they are NO LONGER a member of, update it to their first active membership.
UPDATE public.app_users u
SET household_id = (
    SELECT hm.household_id 
    FROM public.household_members hm 
    WHERE hm.user_id = u.id 
    ORDER BY hm.created_at ASC 
    LIMIT 1
)
WHERE u.household_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.household_members hm WHERE hm.user_id = u.id)
  AND NOT EXISTS (
      SELECT 1 FROM public.household_members hm 
      WHERE hm.user_id = u.id AND hm.household_id = u.household_id
  );

-- Also backfill app_users.household_id if currently NULL but household_members has rows
UPDATE public.app_users u
SET household_id = (
    SELECT hm.household_id 
    FROM public.household_members hm 
    WHERE hm.user_id = u.id 
    ORDER BY hm.created_at ASC 
    LIMIT 1
)
WHERE u.household_id IS NULL
  AND EXISTS (SELECT 1 FROM public.household_members hm WHERE hm.user_id = u.id);

-- 10. PERMISSIONS GRANT
GRANT EXECUTE ON FUNCTION get_user_household_ids(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_authorized_households(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_user_memberships(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_household_members(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION accept_household_invitation(TEXT, UUID) TO authenticated, anon;
