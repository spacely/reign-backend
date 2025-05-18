-- Drop all tables and clean up the database
DO $$ 
DECLARE 
    r RECORD;
BEGIN
    -- Drop all tables with CASCADE
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename != 'spatial_ref_sys') 
    LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;

    -- Drop the uuid-ossp extension
    DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE;
    
    -- Drop the PostGIS related extensions
    DROP EXTENSION IF EXISTS cube CASCADE;
    DROP EXTENSION IF EXISTS earthdistance CASCADE;
END $$; 