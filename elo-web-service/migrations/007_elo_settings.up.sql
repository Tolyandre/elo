CREATE TABLE IF NOT EXISTS elo_settings (
    effective_date TIMESTAMP WITH TIME ZONE NOT NULL PRIMARY KEY,
    elo_const_k FLOAT NOT NULL,
    elo_const_d FLOAT NOT NULL
);

-- Insert default settings with minimum possible timestamp
INSERT INTO elo_settings (effective_date, elo_const_k, elo_const_d)
VALUES ('-infinity'::timestamp, 32, 400);
