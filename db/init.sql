-- SQL schema for reference
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, descriptor TEXT, photo_path TEXT);
CREATE TABLE attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, timestamp TEXT, photo_path TEXT);
