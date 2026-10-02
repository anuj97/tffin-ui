-- ==============================================================================
-- TIFFIN SYSTEM: USER HOUSEHOLD MEMBERSHIP & ROW-LEVEL AUTHORIZATION
-- ==============================================================================
-- Run this script in your Supabase Dashboard -> SQL Editor
-- ==============================================================================

-- 1. HOUSEHOLD MEMBERS TABLE (Many-to-Many User-to-Household Mapping)
CREATE TABLE IF NOT EXISTS household_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    role_in_household TEXT DEFAULT 'member', -- 'owner', 'member', 'viewer'
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(household_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_household_members_user ON household_members(user_id);
CREATE INDEX IF NOT EXISTS idx_household_members_household ON household_members(household_id);

-- 2. MIGRATE EXISTING USERS: Associate app_users.household_id into household_members
INSERT INTO household_members (household_id, user_id, role_in_household)
SELECT household_id, id, 'owner'
FROM app_users
WHERE household_id IS NOT NULL
ON CONFLICT (household_id, user_id) DO NOTHING;

-- 3. UPDATE VERIFY_APP_USER RPC TO RETURN AUTHORIZED HOUSEHOLD IDS
CREATE OR REPLACE FUNCTION verify_app_user(p_username TEXT, p_password TEXT)
RETURNS TABLE (
    id UUID,
    username TEXT,
    full_name TEXT,
    role TEXT,
    household_id UUID,
    household_ids UUID[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id, 
        u.username, 
        u.full_name, 
        u.role, 
        u.household_id,
        COALESCE(
            ARRAY(
                SELECT hm.household_id 
                FROM household_members hm 
                WHERE hm.user_id = u.id
            ),
            CASE WHEN u.household_id IS NOT NULL THEN ARRAY[u.household_id] ELSE ARRAY[]::UUID[] END
        ) AS household_ids
    FROM app_users u
    WHERE lower(trim(u.username)) = lower(trim(p_username))
      AND u.password_hash = crypt(p_password, u.password_hash);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. ROW-LEVEL SECURITY (RLS) POLICIES
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_schedule ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view authorized households" ON households;
DROP POLICY IF EXISTS "Users can view authorized meal schedules" ON meal_schedule;

-- Allow users to view only their authorized households (or admins/chefs to view all)
CREATE POLICY "Users can view authorized households" ON households
FOR SELECT USING (
    id IN (SELECT hm.household_id FROM household_members hm WHERE hm.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('admin', 'chef'))
);

-- Allow users to view only meal schedules for their households
CREATE POLICY "Users can view authorized meal schedules" ON meal_schedule
FOR SELECT USING (
    household_id IN (SELECT hm.household_id FROM household_members hm WHERE hm.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('admin', 'chef'))
);

-- Allow admins or household owners to update households
DROP POLICY IF EXISTS "Admins or owners can update households" ON households;
CREATE POLICY "Admins or owners can update households" ON households
FOR UPDATE USING (
    id IN (SELECT hm.household_id FROM household_members hm WHERE hm.user_id = auth.uid() AND hm.role_in_household = 'owner')
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('admin', 'owner'))
);

-- Allow admins or household owners to delete households
DROP POLICY IF EXISTS "Admins or owners can delete households" ON households;
CREATE POLICY "Admins or owners can delete households" ON households
FOR DELETE USING (
    id IN (SELECT hm.household_id FROM household_members hm WHERE hm.user_id = auth.uid() AND hm.role_in_household = 'owner')
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('admin', 'owner'))
);

-- Allow authenticated users to create new households
DROP POLICY IF EXISTS "Users can create households" ON households;
CREATE POLICY "Users can create households" ON households
FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
);

-- Row-level security for household_members
ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view household members of their households" ON household_members;
CREATE POLICY "Users can view household members of their households" ON household_members
FOR SELECT USING (
    household_id IN (SELECT hm.household_id FROM household_members hm WHERE hm.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('admin', 'chef'))
);

DROP POLICY IF EXISTS "Users can insert household membership for themselves or owners can add members" ON household_members;
CREATE POLICY "Users can insert household membership for themselves or owners can add members" ON household_members
FOR INSERT WITH CHECK (
    user_id = auth.uid()
    OR household_id IN (SELECT hm.household_id FROM household_members hm WHERE hm.user_id = auth.uid() AND hm.role_in_household = 'owner')
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('admin', 'owner'))
);

DROP POLICY IF EXISTS "Owners can remove household members" ON household_members;
CREATE POLICY "Owners can remove household members" ON household_members
FOR DELETE USING (
    user_id = auth.uid()
    OR household_id IN (SELECT hm.household_id FROM household_members hm WHERE hm.user_id = auth.uid() AND hm.role_in_household = 'owner')
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('admin', 'owner'))
);


