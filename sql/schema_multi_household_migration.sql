-- ==============================================================================
-- TIFFIN SYSTEM: MULTI-HOUSEHOLD DATABASE SCHEMA MIGRATION
-- ==============================================================================
-- Run this script in your Supabase Dashboard -> SQL Editor to upgrade an existing
-- single-household database to full multi-household support.
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. CREATE HOUSEHOLDS TABLE
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

-- 3. SEED DEFAULT HOUSEHOLD & SAMPLE HOUSEHOLDS
INSERT INTO households (name, code, contact_name, default_headcount, dietary_notes, color_tag)
VALUES 
    ('Main Household', 'HH-01', 'Primary Contact', 3, 'Standard diet', '#6366f1'),
    ('Verma Residence', 'HH-02', 'Amit Verma', 4, 'Vegetarian, mild spice', '#10b981'),
    ('Apartment 402', 'HH-03', 'Priya Patel', 2, 'Jain, no onion/garlic', '#f59e0b')
ON CONFLICT (name) DO NOTHING;

-- 4. ASSOCIATE USERS WITH HOUSEHOLDS (Optional multi-tenant / POC linkage)
ALTER TABLE app_users 
ADD COLUMN IF NOT EXISTS household_id UUID REFERENCES households(id) ON DELETE SET NULL;

-- Update verify_app_user RPC to return household_id
CREATE OR REPLACE FUNCTION verify_app_user(p_username TEXT, p_password TEXT)
RETURNS TABLE (
    id UUID,
    username TEXT,
    full_name TEXT,
    role TEXT,
    household_id UUID
) AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.username, u.full_name, u.role, u.household_id
    FROM app_users u
    WHERE lower(trim(u.username)) = lower(trim(p_username))
      AND u.password_hash = crypt(p_password, u.password_hash);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. EXTEND DISHES FOR OPTIONAL HOUSEHOLD CUSTOMIZATION
-- NULL household_id = shared master recipe available to all; NOT NULL = custom household dish
ALTER TABLE dishes 
ADD COLUMN IF NOT EXISTS household_id UUID REFERENCES households(id) ON DELETE CASCADE;

-- 6. MIGRATE MEAL_SCHEDULE TO MULTI-HOUSEHOLD
-- Step 6a: Add household_id column
ALTER TABLE meal_schedule 
ADD COLUMN IF NOT EXISTS household_id UUID REFERENCES households(id) ON DELETE CASCADE;

-- Step 6b: Backfill existing records with the default household
DO $$
DECLARE
    v_default_hh_id UUID;
BEGIN
    SELECT id INTO v_default_hh_id FROM households WHERE name = 'Main Household' LIMIT 1;
    IF v_default_hh_id IS NOT NULL THEN
        UPDATE meal_schedule 
        SET household_id = v_default_hh_id 
        WHERE household_id IS NULL;
    END IF;
END $$;

-- Step 6c: Enforce NOT NULL on household_id
ALTER TABLE meal_schedule 
ALTER COLUMN household_id SET NOT NULL;

-- Step 6d: Drop legacy single-household unique constraint
ALTER TABLE meal_schedule 
DROP CONSTRAINT IF EXISTS meal_schedule_schedule_date_meal_type_key;

-- Step 6e: Add new multi-household composite unique constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'meal_schedule_household_date_meal_type_key'
    ) THEN
        ALTER TABLE meal_schedule 
        ADD CONSTRAINT meal_schedule_household_date_meal_type_key 
        UNIQUE (household_id, schedule_date, meal_type);
    END IF;
END $$;

-- 7. UPDATE STORED PROCEDURE: update_meal_headcount FOR MULTI-HOUSEHOLD
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

-- Backward-compatibility fallback for legacy single-household callers
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

-- 8. INDEXES FOR HIGH-EFFICIENCY CALENDAR QUERYING
CREATE INDEX IF NOT EXISTS idx_meal_schedule_hh_date ON meal_schedule(household_id, schedule_date);
CREATE INDEX IF NOT EXISTS idx_meal_schedule_date ON meal_schedule(schedule_date);
CREATE INDEX IF NOT EXISTS idx_households_active ON households(is_active);
