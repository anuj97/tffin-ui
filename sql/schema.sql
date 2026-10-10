-- ==============================================================================
-- TIFFIN KITCHEN ADMIN: SUPABASE POSTGRESQL SCHEMA & AUTHENTICATION
-- MULTI-HOUSEHOLD SUPPORT ENABLED
-- ==============================================================================
-- Run this script in your Supabase Dashboard -> SQL Editor
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. HOUSEHOLDS TABLE
CREATE TABLE IF NOT EXISTS households (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    code TEXT UNIQUE,                             -- e.g. 'HH-01', 'APT-402'
    contact_name TEXT,
    contact_phone TEXT,
    address TEXT,
    default_headcount INT DEFAULT 2 CHECK (default_headcount > 0),
    dietary_notes TEXT,                           -- e.g. 'Jain (no onion/garlic)', 'Gluten-free'
    color_tag TEXT DEFAULT '#6366f1',             -- UI badge color for planner
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default household
INSERT INTO households (name, code, contact_name, default_headcount, dietary_notes, color_tag)
VALUES 
    ('Main Household', 'HH-01', 'Primary Contact', 3, 'Standard diet', '#6366f1'),
    ('Verma Residence', 'HH-02', 'Amit Verma', 4, 'Vegetarian, mild spice', '#10b981'),
    ('Apartment 402', 'HH-03', 'Priya Patel', 2, 'Jain, no onion/garlic', '#f59e0b')
ON CONFLICT (name) DO NOTHING;

-- 3. AUTHENTICATION & USERS TABLE
CREATE TABLE IF NOT EXISTS app_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    email TEXT,
    password_hash TEXT NOT NULL,
    full_name TEXT DEFAULT 'Kitchen Admin',
    role TEXT DEFAULT 'admin', -- 'admin', 'chef', 'staff', 'household_member'
    household_id UUID REFERENCES households(id) ON DELETE SET NULL,
    avatar_url TEXT,
    phone TEXT,
    dietary_preferences TEXT,
    bio TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Many-to-Many Household Membership
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

-- Stored procedure for secure credential verification (verifies bcrypt hash and returns authorized households)
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

-- Seed default admin user:
-- Username: admin
-- Password: admin123
INSERT INTO app_users (username, password_hash, full_name, role)
VALUES ('admin', crypt('admin123', gen_salt('bf')), 'Kitchen Admin', 'admin')
ON CONFLICT (username) DO NOTHING;

-- 4. CORE KITCHEN MASTER TABLES
CREATE TABLE IF NOT EXISTS ingredients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    category TEXT DEFAULT 'produce', -- 'produce', 'dairy', 'spices', 'staples'
    unit TEXT DEFAULT 'g'            -- 'g', 'kg', 'pcs', 'ml'
);

CREATE TABLE IF NOT EXISTS inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingredient_id UUID REFERENCES ingredients(id) ON DELETE CASCADE UNIQUE,
    quantity NUMERIC DEFAULT 0,
    min_threshold NUMERIC DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dishes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    cook_notes TEXT,
    household_id UUID REFERENCES households(id) ON DELETE CASCADE -- NULL = shared dish; NOT NULL = custom household dish
);

-- 5. RECIPE INGREDIENTS (Many-to-Many)
CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dish_id UUID REFERENCES dishes(id) ON DELETE CASCADE,
    ingredient_id UUID REFERENCES ingredients(id) ON DELETE CASCADE,
    qty_per_person NUMERIC NOT NULL,
    UNIQUE(dish_id, ingredient_id)
);

-- 6. MULTI-HOUSEHOLD DAILY MEAL SCHEDULE
CREATE TABLE IF NOT EXISTS meal_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    schedule_date DATE NOT NULL,
    meal_type TEXT CHECK (meal_type IN ('breakfast', 'lunch', 'dinner')),
    dish_id UUID REFERENCES dishes(id),
    headcount INT DEFAULT 3,
    UNIQUE(household_id, schedule_date, meal_type)
);

CREATE INDEX IF NOT EXISTS idx_meal_schedule_hh_date ON meal_schedule(household_id, schedule_date);
CREATE INDEX IF NOT EXISTS idx_meal_schedule_date ON meal_schedule(schedule_date);
CREATE INDEX IF NOT EXISTS idx_households_active ON households(is_active);

-- 7. HELPER STORED PROCEDURE: Update Headcount via Bot/Dashboard
CREATE OR REPLACE FUNCTION update_meal_headcount(
    p_household_id UUID, 
    p_date DATE, 
    p_meal TEXT, 
    p_delta INT
)
RETURNS INT AS $$
DECLARE
    v_count INT;
BEGIN
    UPDATE meal_schedule
    SET headcount = GREATEST(headcount + p_delta, 0)
    WHERE household_id = p_household_id 
      AND schedule_date = p_date 
      AND meal_type = p_meal
    RETURNING headcount INTO v_count;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backward-compatibility overload
CREATE OR REPLACE FUNCTION update_meal_headcount(
    p_date DATE, 
    p_meal TEXT, 
    p_delta INT
)
RETURNS INT AS $$
DECLARE
    v_default_hh UUID;
    v_count INT;
BEGIN
    SELECT id INTO v_default_hh FROM households ORDER BY created_at ASC LIMIT 1;
    
    UPDATE meal_schedule
    SET headcount = GREATEST(headcount + p_delta, 0)
    WHERE household_id = v_default_hh
      AND schedule_date = p_date 
      AND meal_type = p_meal
    RETURNING headcount INTO v_count;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. HOUSEHOLD INVITATIONS
CREATE TABLE IF NOT EXISTS household_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    invited_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    invite_code TEXT UNIQUE NOT NULL,
    email TEXT,
    role_in_household TEXT DEFAULT 'member',
    status TEXT DEFAULT 'pending',
    expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days'),
    created_at TIMESTAMPTZ DEFAULT now(),
    accepted_at TIMESTAMPTZ,
    accepted_by UUID REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invitations_code ON household_invitations(invite_code);
CREATE INDEX IF NOT EXISTS idx_invitations_household ON household_invitations(household_id);

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
    v_code := 'TFFN-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    v_expires := now() + (COALESCE(p_valid_days, 7) || ' days')::INTERVAL;
    v_created := now();

    INSERT INTO household_invitations (household_id, invited_by, invite_code, email, role_in_household, status, expires_at, created_at)
    VALUES (p_household_id, p_invited_by, v_code, p_email, COALESCE(p_role, 'member'), 'pending', v_expires, v_created)
    RETURNING household_invitations.id, household_invitations.household_id, household_invitations.invite_code, household_invitations.role_in_household, household_invitations.status, household_invitations.expires_at, household_invitations.created_at
    INTO v_id, p_household_id, v_code, p_role, p_email, v_expires, v_created;

    RETURN QUERY SELECT v_id, p_household_id, v_code, p_role, 'pending'::TEXT, v_expires, v_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

    INSERT INTO household_members (household_id, user_id, role_in_household)
    VALUES (v_inv.household_id, p_user_id, COALESCE(v_inv.role_in_household, 'member'))
    ON CONFLICT (household_id, user_id) 
    DO UPDATE SET role_in_household = EXCLUDED.role_in_household;

    UPDATE household_invitations 
    SET status = 'accepted', accepted_at = now(), accepted_by = p_user_id
    WHERE id = v_inv.id;

    UPDATE public.app_users
    SET household_id = v_inv.household_id
    WHERE id = p_user_id AND household_id IS NULL;

    RETURN QUERY SELECT true, 'Successfully joined household'::TEXT, v_inv.household_id, v_inv.hh_name, v_inv.role_in_household;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. NON-RECURSIVE MEMBERSHIP HELPERS & RPCs (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION get_user_household_ids(p_user_id UUID)
RETURNS SETOF UUID AS $$
    SELECT household_id FROM public.household_members WHERE user_id = p_user_id
    UNION
    SELECT household_id FROM public.app_users 
    WHERE id = p_user_id 
      AND household_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.household_members WHERE user_id = p_user_id);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_authorized_households(p_user_id UUID DEFAULT NULL)
RETURNS SETOF public.households AS $$
DECLARE
    v_user_id UUID;
    v_role TEXT;
BEGIN
    v_user_id := COALESCE(p_user_id, auth.uid());

    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT * FROM public.households WHERE COALESCE(is_active, true) = true ORDER BY name;
        RETURN;
    END IF;

    SELECT role INTO v_role FROM public.app_users WHERE id = v_user_id;

    IF v_role IN ('admin', 'chef') THEN
        RETURN QUERY SELECT * FROM public.households WHERE COALESCE(is_active, true) = true ORDER BY name;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT DISTINCT h.*
    FROM public.households h
    WHERE COALESCE(h.is_active, true) = true
      AND h.id IN (SELECT get_user_household_ids(v_user_id))
    ORDER BY h.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

    RETURN QUERY
    SELECT hm.household_id, COALESCE(hm.role_in_household, 'owner')::TEXT
    FROM public.household_members hm
    WHERE hm.user_id = v_user_id;

    IF NOT FOUND THEN
        RETURN QUERY
        SELECT u.household_id, 'owner'::TEXT
        FROM public.app_users u
        WHERE u.id = v_user_id AND u.household_id IS NOT NULL;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
    WITH all_members AS (
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

        UNION ALL

        SELECT 
            gen_random_uuid() AS id,
            u.household_id,
            u.id AS user_id,
            CASE WHEN u.role = 'owner' THEN 'owner' ELSE 'member' END AS role_in_household,
            COALESCE(u.created_at, now()) AS created_at,
            COALESCE(u.username, 'member')::TEXT AS username,
            COALESCE(u.full_name, u.username, 'Member')::TEXT AS full_name,
            u.email::TEXT AS email
        FROM public.app_users u
        WHERE u.household_id = p_household_id
          AND NOT EXISTS (
              SELECT 1 FROM public.household_members hm 
              WHERE hm.household_id = p_household_id AND hm.user_id = u.id
          )
    )
    SELECT * FROM all_members
    ORDER BY created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. ROW-LEVEL SECURITY POLICIES (NON-RECURSIVE)
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view authorized households" ON households;
CREATE POLICY "Users can view authorized households" ON households
FOR SELECT USING (
    id IN (SELECT get_user_household_ids(auth.uid()))
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('admin', 'chef'))
    OR auth.uid() IS NULL
);

DROP POLICY IF EXISTS "Admins or owners can update households" ON households;
CREATE POLICY "Admins or owners can update households" ON households
FOR UPDATE USING (
    id IN (SELECT get_user_household_ids(auth.uid()))
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('admin', 'owner'))
);

DROP POLICY IF EXISTS "Admins or owners can delete households" ON households;
CREATE POLICY "Admins or owners can delete households" ON households
FOR DELETE USING (
    id IN (SELECT get_user_household_ids(auth.uid()))
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('admin', 'owner'))
);

DROP POLICY IF EXISTS "Users can view authorized meal schedules" ON meal_schedule;
CREATE POLICY "Users can view authorized meal schedules" ON meal_schedule
FOR SELECT USING (
    household_id IN (SELECT get_user_household_ids(auth.uid()))
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('admin', 'chef'))
    OR auth.uid() IS NULL
);

DROP POLICY IF EXISTS "Users can create households" ON households;
CREATE POLICY "Users can create households" ON households
FOR INSERT WITH CHECK (
    true
);

DROP POLICY IF EXISTS "Users can view household members of their households" ON household_members;
CREATE POLICY "Users can view household members of their households" ON household_members
FOR SELECT USING (
    user_id = auth.uid()
    OR household_id IN (SELECT get_user_household_ids(auth.uid()))
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('admin', 'chef'))
    OR auth.uid() IS NULL
);

DROP POLICY IF EXISTS "Users can insert household membership for themselves or owners can add members" ON household_members;
CREATE POLICY "Users can insert household membership for themselves or owners can add members" ON household_members
FOR INSERT WITH CHECK (
    user_id = auth.uid()
    OR household_id IN (SELECT get_user_household_ids(auth.uid()))
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('admin', 'owner'))
    OR auth.uid() IS NULL
);

DROP POLICY IF EXISTS "Owners can remove household members" ON household_members;
CREATE POLICY "Owners can remove household members" ON household_members
FOR DELETE USING (
    user_id = auth.uid()
    OR household_id IN (SELECT get_user_household_ids(auth.uid()))
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('admin', 'owner'))
    OR auth.uid() IS NULL
);

-- ==============================================================================
-- STORED PROCEDURE: CREATE HOUSEHOLD (SECURITY DEFINER)
-- ==============================================================================
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
    v_user_id := COALESCE(auth.uid(), p_user_id);

    IF p_code IS NULL OR trim(p_code) = '' THEN
        v_code := 'HH-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    ELSE
        v_code := trim(p_code);
    END IF;

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

    IF v_user_id IS NOT NULL THEN
        INSERT INTO public.household_members (household_id, user_id, role_in_household)
        VALUES (v_household_id, v_user_id, 'owner')
        ON CONFLICT (household_id, user_id) 
        DO UPDATE SET role_in_household = 'owner';

        UPDATE public.app_users 
        SET household_id = v_household_id 
        WHERE public.app_users.id = v_user_id 
          AND (public.app_users.household_id IS NULL);
    END IF;

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

-- ==============================================================================
-- STORED PROCEDURE: DELETE HOUSEHOLD (SECURITY DEFINER)
-- ==============================================================================
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
        SELECT true INTO v_can_delete
        FROM public.household_members hm
        WHERE hm.household_id = p_household_id 
          AND hm.user_id = v_user_id 
          AND hm.role_in_household = 'owner';

        IF NOT FOUND OR v_can_delete IS NOT TRUE THEN
            SELECT true INTO v_can_delete
            FROM public.app_users u
            WHERE u.id = v_user_id AND u.role IN ('admin', 'owner');
        END IF;
    ELSE
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
