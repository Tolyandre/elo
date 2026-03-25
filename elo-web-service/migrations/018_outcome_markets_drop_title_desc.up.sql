-- Remove description column; title is now generated in Go at creation time.
ALTER TABLE outcome_markets DROP COLUMN description;
