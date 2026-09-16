INSERT INTO match_filters (id,date_from,date_to,game_ids,tag_ids,tournament_id) VALUES
	 ('5e9d008c-35c4-4075-a7f5-ca4723164534'::uuid,NULL,NULL,NULL,'{01a09d04-e2a3-772c-97fa-59ac147df7be}',NULL);

INSERT INTO arenas (id,"name",match_filter_id,settings,settings_schema_version,game_id,tournament_id,recalc_from,stale_at) VALUES
	 ('5e9d008c-35c4-4075-a7f5-ca4723164534'::uuid,'Кланк!','5e9d008c-35c4-4075-a7f5-ca4723164534'::uuid,'{"leagues": [{"tau": 50, "kind": "newbie", "goal_gap": 16, "earned_max": 64, "earned_min": 2}, {"kind": "amateur"}], "starting_rating": 900}',1,NULL,NULL,NULL,NULL);
