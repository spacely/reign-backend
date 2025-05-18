-- Ensure profile_items.user_id is UUID type and properly references users.id
DO $$ 
BEGIN 
    -- Drop existing foreign key if it exists
    IF EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'profile_items_user_id_fkey'
        AND table_name = 'profile_items'
    ) THEN
        ALTER TABLE profile_items DROP CONSTRAINT profile_items_user_id_fkey;
    END IF;

    -- Alter column type to UUID if it's not already
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'profile_items' 
        AND column_name = 'user_id'
        AND data_type != 'uuid'
    ) THEN 
        ALTER TABLE profile_items ALTER COLUMN user_id TYPE UUID USING user_id::uuid;
    END IF;

    -- Add foreign key constraint
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'profile_items_user_id_fkey'
        AND table_name = 'profile_items'
    ) THEN
        ALTER TABLE profile_items 
        ADD CONSTRAINT profile_items_user_id_fkey 
        FOREIGN KEY (user_id) 
        REFERENCES users(id) 
        ON DELETE CASCADE;
    END IF;
END $$; 