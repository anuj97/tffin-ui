-- ==============================================================================
-- TIFFIN SYSTEM: HOUSEHOLD INVITATIONS & MEMBER MANAGEMENT MIGRATION
-- ==============================================================================
-- Run this script in your Supabase Dashboard -> SQL Editor
-- ==============================================================================

-- 1. HOUSEHOLD INVITATIONS TABLE
CREATE TABLE IF NOT EXISTS household_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    invited_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    invite_code TEXT UNIQUE NOT NULL,
    email TEXT,
    role_in_household TEXT DEFAULT 'member', -- 'owner', 'member', 'viewer'
    status TEXT DEFAULT 'pending',           -- 'pending', 'accepted', 'revoked', 'expired'
    expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days'),
    created_at TIMESTAMPTZ DEFAULT now(),
    accepted_at TIMESTAMPTZ,
    accepted_by UUID REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invitations_code ON household_invitations(invite_code);
CREATE INDEX IF NOT EXISTS idx_invitations_household ON household_invitations(household_id);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON household_invitations(status);

-- 2. STORED PROCEDURE: CREATE HOUSEHOLD INVITATION
CREATE OR REPLACE FUNCTION create_household_invitation(
    p_household_id UUID,
    p_invited_by UUID,
    p_role TEXT DEFAULT 'member',
    p_email TEXT DEFAULT NULL,
    p_valid_days INT DEFAULT 7
)
RETURNS TABLE (
    id UUID,
    household_id UUID,
    invite_code TEXT,
    role_in_household TEXT,
    status TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ
) AS $$
DECLARE
    v_code TEXT;
    v_id UUID;
    v_expires TIMESTAMPTZ;
    v_created TIMESTAMPTZ;
BEGIN
    -- Generate random alphanumeric invite code e.g. TFFN-XXXXXX
    v_code := 'TFFN-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    v_expires := now() + (COALESCE(p_valid_days, 7) || ' days')::INTERVAL;
    v_created := now();

    INSERT INTO household_invitations (
        household_id, 
        invited_by, 
        invite_code, 
        email, 
        role_in_household, 
        status,
        expires_at,
        created_at
    )
    VALUES (
        p_household_id, 
        p_invited_by, 
        v_code, 
        p_email, 
        COALESCE(p_role, 'member'), 
        'pending',
        v_expires,
        v_created
    )
    RETURNING 
        household_invitations.id, 
        household_invitations.household_id,
        household_invitations.invite_code, 
        household_invitations.role_in_household,
        household_invitations.status,
        household_invitations.expires_at,
        household_invitations.created_at
    INTO v_id, p_household_id, v_code, p_role, p_email, v_expires, v_created;

    RETURN QUERY SELECT v_id, p_household_id, v_code, p_role, 'pending'::TEXT, v_expires, v_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. STORED PROCEDURE: ACCEPT HOUSEHOLD INVITATION
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

    RETURN QUERY SELECT true, 'Successfully joined household'::TEXT, v_inv.household_id, v_inv.hh_name, v_inv.role_in_household;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. ROW-LEVEL SECURITY (RLS) POLICIES FOR INVITATIONS
ALTER TABLE household_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view household invitations" ON household_invitations;
DROP POLICY IF EXISTS "Owners can create household invitations" ON household_invitations;
DROP POLICY IF EXISTS "Public can view valid invitation codes" ON household_invitations;

-- Members/Owners can view invitations for their household
CREATE POLICY "Members can view household invitations" ON household_invitations
FOR SELECT USING (
    household_id IN (SELECT hm.household_id FROM household_members hm WHERE hm.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('admin', 'chef'))
);

-- Owners and Admins can create invitations
CREATE POLICY "Owners can create household invitations" ON household_invitations
FOR INSERT WITH CHECK (
    household_id IN (
        SELECT hm.household_id 
        FROM household_members hm 
        WHERE hm.user_id = auth.uid() AND hm.role_in_household IN ('owner', 'admin')
    )
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'admin')
);

-- Anyone can check a code to join
CREATE POLICY "Anyone can check invitation by code" ON household_invitations
FOR SELECT USING (
    status = 'pending' AND expires_at > now()
);
