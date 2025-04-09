-- Ensure the database exists and connect to it
CREATE DATABASE IF NOT EXISTS users_db;
\c users_db;

-- Create the students table if it doesn't exist
CREATE TABLE IF NOT EXISTS students (
    student_id SERIAL PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create an index on the email column if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);