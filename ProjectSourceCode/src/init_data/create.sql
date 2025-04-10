\c users_db;

CREATE TABLE IF NOT EXISTS students (
    student_id SERIAL PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(100) NOT NULL,
    bio TEXT, 
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);

CREATE TABLE IF NOT EXISTS website_settings (
    id SERIAL PRIMARY KEY,
    theme VARCHAR(50) DEFAULT 'light', -- Default theme
    language VARCHAR(10) DEFAULT 'en'   -- Default language
);

-- Insert an initial row if the table is empty
INSERT INTO website_settings (id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM website_settings);

