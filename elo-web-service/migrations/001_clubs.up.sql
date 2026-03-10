CREATE TABLE IF NOT EXISTS clubs (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

INSERT INTO clubs (id, name) VALUES
(1, 'Синие люди'),
(2, 'Весёлые карточные игры');

SELECT setval('clubs_id_seq', (SELECT MAX(id) FROM clubs));
