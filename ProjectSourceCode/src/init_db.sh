#!/bin/bash
# DO NOT PUSH THIS FILE TO GITHUB
# This file contains sensitive information and should be kept private
# TODO: Set your PostgreSQL URI - Use the External Database URL from the Render dashboard
PG_URI="postgresql://bird_r1rw_user:WT5oSnwJmfApjBljiSpdbcfs7tc61DDi@dpg-d0016rali9vc739esecg-a.oregon-postgres.render.com/bird_r1rw"
# Execute each .sql file in the directory
for file in init_data/*.sql; do
    echo "Executing $file..."
    psql $PG_URI -f "$file"
done