-- ==============================================================================
-- TIFFIN KITCHEN ADMIN: REFERENCE MOCK DATA SEED SCRIPT
-- ==============================================================================
-- Run this script in your Supabase Dashboard -> SQL Editor to populate sample
-- households, users, ingredients, inventory, dishes, and recipe links.
-- ==============================================================================

-- 1. HOUSEHOLDS
INSERT INTO households (name, code, contact_name, contact_phone, address, default_headcount, dietary_notes, color_tag, is_active)
VALUES 
    ('Main Household', 'HH-01', 'Aditi Sharma', '+91 98765 43210', 'B-104, Sunrise Heights', 3, 'Standard diet, medium spice', '#6366f1', true),
    ('Verma Residence', 'HH-02', 'Amit Verma', '+91 98123 45678', 'Flat 402, Oakwood Towers', 4, 'Pure Vegetarian, mild spice', '#10b981', true),
    ('Apartment 301', 'HH-03', 'Priya Patel', '+91 99887 76655', '301, Palm Grove Apartments', 2, 'Jain (strictly no onion, no garlic)', '#f59e0b', true)
ON CONFLICT (name) DO UPDATE SET 
    code = EXCLUDED.code,
    contact_name = EXCLUDED.contact_name,
    default_headcount = EXCLUDED.default_headcount,
    dietary_notes = EXCLUDED.dietary_notes,
    color_tag = EXCLUDED.color_tag;

-- 2. APP USERS
-- Passwords set to '<username>123' (e.g. admin123, chef123, verma123, priya123)
INSERT INTO app_users (username, password_hash, full_name, role)
VALUES 
    ('admin', crypt('admin123', gen_salt('bf')), 'Kitchen Super Admin', 'admin'),
    ('chef_rajesh', crypt('chef123', gen_salt('bf')), 'Chef Rajesh', 'chef'),
    ('amit_verma', crypt('verma123', gen_salt('bf')), 'Amit Verma', 'household_member'),
    ('priya_patel', crypt('priya123', gen_salt('bf')), 'Priya Patel', 'household_member'),
    ('kiran_manager', crypt('kiran123', gen_salt('bf')), 'Kiran Manager', 'household_member'),
    ('rohan_new', crypt('rohan123', gen_salt('bf')), 'Rohan Sharma', 'household_member')
ON CONFLICT (username) DO NOTHING;

-- Associate users with households
DO $$
DECLARE
    v_hh1 UUID;
    v_hh2 UUID;
    v_hh3 UUID;
    v_user_admin UUID;
    v_user_chef UUID;
    v_user_verma UUID;
    v_user_priya UUID;
    v_user_kiran UUID;
BEGIN
    SELECT id INTO v_hh1 FROM households WHERE code = 'HH-01' LIMIT 1;
    SELECT id INTO v_hh2 FROM households WHERE code = 'HH-02' LIMIT 1;
    SELECT id INTO v_hh3 FROM households WHERE code = 'HH-03' LIMIT 1;

    SELECT id INTO v_user_admin FROM app_users WHERE username = 'admin' LIMIT 1;
    SELECT id INTO v_user_chef FROM app_users WHERE username = 'chef_rajesh' LIMIT 1;
    SELECT id INTO v_user_verma FROM app_users WHERE username = 'amit_verma' LIMIT 1;
    SELECT id INTO v_user_priya FROM app_users WHERE username = 'priya_patel' LIMIT 1;
    SELECT id INTO v_user_kiran FROM app_users WHERE username = 'kiran_manager' LIMIT 1;

    -- Update primary household references
    UPDATE app_users SET household_id = v_hh1 WHERE id = v_user_admin;
    UPDATE app_users SET household_id = v_hh2 WHERE id = v_user_verma;
    UPDATE app_users SET household_id = v_hh3 WHERE id = v_user_priya;

    -- Household memberships
    INSERT INTO household_members (household_id, user_id, role_in_household) VALUES
        (v_hh1, v_user_admin, 'owner'),
        (v_hh1, v_user_chef, 'member'),
        (v_hh2, v_user_verma, 'owner'),
        (v_hh2, v_user_kiran, 'member'),
        (v_hh3, v_user_priya, 'owner'),
        (v_hh3, v_user_kiran, 'member')
    ON CONFLICT (household_id, user_id) DO NOTHING;

    -- Household Invitations
    INSERT INTO household_invitations (household_id, invited_by, invite_code, email, role_in_household, status, expires_at) VALUES
        (v_hh2, v_user_verma, 'TFFN-VERMA77', 'rohit.verma@example.com', 'member', 'pending', now() + INTERVAL '7 days'),
        (v_hh3, v_user_priya, 'TFFN-APT301', 'guest@example.com', 'member', 'pending', now() + INTERVAL '5 days')
    ON CONFLICT (invite_code) DO NOTHING;
END $$;

-- 3. INGREDIENTS
INSERT INTO ingredients (name, category, unit) VALUES
    ('Paneer', 'dairy', 'g'),
    ('Basmati Rice', 'staples', 'g'),
    ('Toor Dal', 'staples', 'g'),
    ('Onions', 'produce', 'g'),
    ('Tomatoes', 'produce', 'g'),
    ('Potatoes', 'produce', 'g'),
    ('Ghee', 'dairy', 'g'),
    ('Cumin Seeds', 'spices', 'g'),
    ('Garam Masala', 'spices', 'g'),
    ('Wheat Flour (Atta)', 'staples', 'g'),
    ('Green Peas', 'produce', 'g')
ON CONFLICT (name) DO NOTHING;

-- 4. INVENTORY
INSERT INTO inventory (ingredient_id, quantity, min_threshold)
SELECT id, 400, 500 FROM ingredients WHERE name = 'Paneer'
ON CONFLICT (ingredient_id) DO UPDATE SET quantity = 400, min_threshold = 500;

INSERT INTO inventory (ingredient_id, quantity, min_threshold)
SELECT id, 2500, 1000 FROM ingredients WHERE name = 'Basmati Rice'
ON CONFLICT (ingredient_id) DO UPDATE SET quantity = 2500, min_threshold = 1000;

INSERT INTO inventory (ingredient_id, quantity, min_threshold)
SELECT id, 300, 600 FROM ingredients WHERE name = 'Toor Dal'
ON CONFLICT (ingredient_id) DO UPDATE SET quantity = 300, min_threshold = 600;

INSERT INTO inventory (ingredient_id, quantity, min_threshold)
SELECT id, 1800, 800 FROM ingredients WHERE name = 'Onions'
ON CONFLICT (ingredient_id) DO UPDATE SET quantity = 1800, min_threshold = 800;

INSERT INTO inventory (ingredient_id, quantity, min_threshold)
SELECT id, 700, 500 FROM ingredients WHERE name = 'Tomatoes'
ON CONFLICT (ingredient_id) DO UPDATE SET quantity = 700, min_threshold = 500;

INSERT INTO inventory (ingredient_id, quantity, min_threshold)
SELECT id, 2000, 1000 FROM ingredients WHERE name = 'Potatoes'
ON CONFLICT (ingredient_id) DO UPDATE SET quantity = 2000, min_threshold = 1000;

INSERT INTO inventory (ingredient_id, quantity, min_threshold)
SELECT id, 450, 300 FROM ingredients WHERE name = 'Ghee'
ON CONFLICT (ingredient_id) DO UPDATE SET quantity = 450, min_threshold = 300;

INSERT INTO inventory (ingredient_id, quantity, min_threshold)
SELECT id, 150, 100 FROM ingredients WHERE name = 'Cumin Seeds'
ON CONFLICT (ingredient_id) DO UPDATE SET quantity = 150, min_threshold = 100;

INSERT INTO inventory (ingredient_id, quantity, min_threshold)
SELECT id, 80, 100 FROM ingredients WHERE name = 'Garam Masala'
ON CONFLICT (ingredient_id) DO UPDATE SET quantity = 80, min_threshold = 100;

INSERT INTO inventory (ingredient_id, quantity, min_threshold)
SELECT id, 4000, 2000 FROM ingredients WHERE name = 'Wheat Flour (Atta)'
ON CONFLICT (ingredient_id) DO UPDATE SET quantity = 4000, min_threshold = 2000;

INSERT INTO inventory (ingredient_id, quantity, min_threshold)
SELECT id, 200, 300 FROM ingredients WHERE name = 'Green Peas'
ON CONFLICT (ingredient_id) DO UPDATE SET quantity = 200, min_threshold = 300;

-- 5. DISHES
INSERT INTO dishes (name, cook_notes) VALUES
    ('Dal Tadka & Jeera Rice', 'Cook dal with turmeric, temper with cumin, garlic and ghee.'),
    ('Paneer Butter Masala', 'Rich tomato cashew gravy. Use fresh paneer cubes.'),
    ('Aloo Matar with Roti', 'Comfort food homestyle potato and peas curry with soft rotis.'),
    ('Poha with Roasted Peanuts', 'Light breakfast tempered with mustard, curry leaves, and green chillies.'),
    ('Idli & Sambar', 'Steamed fermented rice cakes with vegetable lentil stew.')
ON CONFLICT (name) DO NOTHING;

-- 6. RECIPE INGREDIENTS
DO $$
DECLARE
    v_dish1 UUID;
    v_dish2 UUID;
    v_dish3 UUID;
    v_dish4 UUID;
    v_dish5 UUID;
    v_ing_paneer UUID;
    v_ing_rice UUID;
    v_ing_dal UUID;
    v_ing_onion UUID;
    v_ing_tomato UUID;
    v_ing_potato UUID;
    v_ing_ghee UUID;
    v_ing_cumin UUID;
    v_ing_garam UUID;
    v_ing_atta UUID;
    v_ing_peas UUID;
BEGIN
    SELECT id INTO v_dish1 FROM dishes WHERE name = 'Dal Tadka & Jeera Rice' LIMIT 1;
    SELECT id INTO v_dish2 FROM dishes WHERE name = 'Paneer Butter Masala' LIMIT 1;
    SELECT id INTO v_dish3 FROM dishes WHERE name = 'Aloo Matar with Roti' LIMIT 1;
    SELECT id INTO v_dish4 FROM dishes WHERE name = 'Poha with Roasted Peanuts' LIMIT 1;
    SELECT id INTO v_dish5 FROM dishes WHERE name = 'Idli & Sambar' LIMIT 1;

    SELECT id INTO v_ing_paneer FROM ingredients WHERE name = 'Paneer' LIMIT 1;
    SELECT id INTO v_ing_rice FROM ingredients WHERE name = 'Basmati Rice' LIMIT 1;
    SELECT id INTO v_ing_dal FROM ingredients WHERE name = 'Toor Dal' LIMIT 1;
    SELECT id INTO v_ing_onion FROM ingredients WHERE name = 'Onions' LIMIT 1;
    SELECT id INTO v_ing_tomato FROM ingredients WHERE name = 'Tomatoes' LIMIT 1;
    SELECT id INTO v_ing_potato FROM ingredients WHERE name = 'Potatoes' LIMIT 1;
    SELECT id INTO v_ing_ghee FROM ingredients WHERE name = 'Ghee' LIMIT 1;
    SELECT id INTO v_ing_cumin FROM ingredients WHERE name = 'Cumin Seeds' LIMIT 1;
    SELECT id INTO v_ing_garam FROM ingredients WHERE name = 'Garam Masala' LIMIT 1;
    SELECT id INTO v_ing_atta FROM ingredients WHERE name = 'Wheat Flour (Atta)' LIMIT 1;
    SELECT id INTO v_ing_peas FROM ingredients WHERE name = 'Green Peas' LIMIT 1;

    -- Dish 1: Dal Tadka & Jeera Rice
    INSERT INTO recipe_ingredients (dish_id, ingredient_id, qty_per_person) VALUES
        (v_dish1, v_ing_dal, 60),
        (v_dish1, v_ing_rice, 80),
        (v_dish1, v_ing_ghee, 10),
        (v_dish1, v_ing_cumin, 5)
    ON CONFLICT (dish_id, ingredient_id) DO NOTHING;

    -- Dish 2: Paneer Butter Masala
    INSERT INTO recipe_ingredients (dish_id, ingredient_id, qty_per_person) VALUES
        (v_dish2, v_ing_paneer, 100),
        (v_dish2, v_ing_tomato, 80),
        (v_dish2, v_ing_ghee, 15),
        (v_dish2, v_ing_garam, 5)
    ON CONFLICT (dish_id, ingredient_id) DO NOTHING;

    -- Dish 3: Aloo Matar with Roti
    INSERT INTO recipe_ingredients (dish_id, ingredient_id, qty_per_person) VALUES
        (v_dish3, v_ing_potato, 100),
        (v_dish3, v_ing_peas, 50),
        (v_dish3, v_ing_atta, 80),
        (v_dish3, v_ing_tomato, 50)
    ON CONFLICT (dish_id, ingredient_id) DO NOTHING;

    -- Dish 4: Poha with Roasted Peanuts
    INSERT INTO recipe_ingredients (dish_id, ingredient_id, qty_per_person) VALUES
        (v_dish4, v_ing_onion, 40),
        (v_dish4, v_ing_potato, 40)
    ON CONFLICT (dish_id, ingredient_id) DO NOTHING;

    -- Dish 5: Idli & Sambar
    INSERT INTO recipe_ingredients (dish_id, ingredient_id, qty_per_person) VALUES
        (v_dish5, v_ing_dal, 50),
        (v_dish5, v_ing_tomato, 40)
    ON CONFLICT (dish_id, ingredient_id) DO NOTHING;
END $$;
