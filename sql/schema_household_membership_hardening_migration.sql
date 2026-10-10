-- ==============================================================================
-- TIFFIN SYSTEM: HOUSEHOLD MEMBERSHIP HARDENING & AUTHORITY MIGRATION
-- ==============================================================================
-- Run this script in your Supabase Dashboard -> SQL Editor
-- This migration fixes:
-- 1. Makes `household_members` table the authoritative source of membership truth.
-- 2. Prevents stale `app_users.household_id` from resurrecting access to removed households.
-- 3. Ensures `accept_household_invitation` initializes primary household if NULL.
-- 4. Reconciles orphan `app_users.household_id` references.
-- ==============================================================================

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

    -- Members can view households they belong to:
    -- Authoritatively via household_members; falls back to app_users only if no memberships exist.
    RETURN QUERY
    SELECT DISTINCT h.*
    FROM public.households h
    WHERE h.is_active = true
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

-- 3. STORED PROCEDURE: ACCEPT HOUSEHOLD INVITATION (INITIALIZE PRIMARY HOUSEHOLD IF NULL)
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

-- 4. RECONCILIATION: CLEAN UP ORPHANED PRIMARY HOUSEHOLD REFERENCES
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
