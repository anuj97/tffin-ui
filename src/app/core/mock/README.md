# TFFIN Reference Mock Dataset

> **Note**: Local debug mode has been completely removed from runtime application workflows. TFFIN runs against the Supabase cloud backend in all runtime environments.

This directory contains the reference mock dataset used for testing, development seeding, and data contract specifications.

---

## Files

- **`mock-data.ts`**: The canonical TypeScript mock dataset providing typed models for:
  - Users / Personas (`MOCK_USERS`)
  - Households (`MOCK_HOUSEHOLDS`)
  - Household Memberships (`MOCK_HOUSEHOLD_MEMBERS`)
  - Household Invitations (`MOCK_INVITATIONS`)
  - Ingredients (`MOCK_INGREDIENTS`)
  - Inventory Stock Levels (`MOCK_INVENTORY`)
  - Dishes with Ingredient Recipes (`MOCK_DISHES`)
  - Dynamic Meal Schedules Generator (`generateMockSchedules`)
- **`sql/seed_mock_data.sql`**: Companion SQL script to seed this exact dataset into a Supabase PostgreSQL database.

---

## Mock Entities Overview

### 1. Users & Personas (`MOCK_USERS`)
| Key | Username | Role | Household Scope | Description |
| :--- | :--- | :--- | :--- | :--- |
| `admin` | `admin` | `admin` | Unrestricted (all) | Kitchen Super Admin with full management permissions |
| `chef` | `chef_rajesh` | `chef` | Unrestricted (all) | Head Chef responsible for preparation across all households |
| `verma` | `amit_verma` | `household_member` | `mock-hh-02` | Owner of Verma Residence |
| `priya` | `priya_patel` | `household_member` | `mock-hh-03` | Owner of Apartment 301 (Jain diet) |
| `multi` | `kiran_manager` | `household_member` | `mock-hh-02`, `mock-hh-03` | Coordinator member of multiple households |
| `new_user`| `rohan_new` | `household_member` | None (`[]`) | Onboarding user without an assigned household |

### 2. Households (`MOCK_HOUSEHOLDS`)
| ID | Code | Name | Headcount | Dietary Notes |
| :--- | :--- | :--- | :--- | :--- |
| `mock-hh-01` | `HH-01` | Main Household | 3 | Standard diet, medium spice |
| `mock-hh-02` | `HH-02` | Verma Residence | 4 | Pure Vegetarian, mild spice |
| `mock-hh-03` | `HH-03` | Apartment 301 | 2 | Jain (strictly no onion, no garlic) |

### 3. Kitchen Ingredients & Inventory (`MOCK_INGREDIENTS`, `MOCK_INVENTORY`)
- 11 ingredients spanning dairy, staples, produce, and spices (Paneer, Basmati Rice, Toor Dal, Onions, Tomatoes, Potatoes, Ghee, Cumin Seeds, Garam Masala, Atta, Green Peas).
- Inventory tracking on-hand quantities and minimum threshold alerts.

### 4. Dishes & Recipes (`MOCK_DISHES`)
- `dish-01`: Dal Tadka & Jeera Rice
- `dish-02`: Paneer Butter Masala
- `dish-03`: Aloo Matar with Roti
- `dish-04`: Poha with Roasted Peanuts
- `dish-05`: Idli & Sambar

---

## Usage in Testing
Unit tests import this dataset to initialize test fixtures and verify permissions, calculations, and state transitions deterministically without network dependencies.
