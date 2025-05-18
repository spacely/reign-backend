-- Add name column if it doesn't exist
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name = 'name'
    ) THEN 
        ALTER TABLE users ADD COLUMN name VARCHAR(255);
    END IF;
END $$; 