package elo

import (
	"reflect"
	"testing"

	"github.com/tolyandre/elo-web-service/pkg/db"
)

// The arena read queries share one 15-column projection (see arenas.sql), so
// every generated row struct must keep the identical field sequence — the
// arenaFrom*Row adapters fan out into arenaFromParts positionally, and a
// swapped same-typed column would compile silently. This test fails when one
// query's column list drifts (a renamed, added, or reordered column).
// ListArenasRow may append derived columns after the shared prefix.
func TestArenaRowStructsKeepSharedColumnList(t *testing.T) {
	shared := reflect.TypeOf(db.GetArenaRow{})
	sharedFields := shared.NumField()

	for _, row := range []any{
		db.GetArenaByGameRow{},
		db.GetArenaByTournamentRow{},
		db.GetArenaForUpdateRow{},
		db.ListArenasForGameRow{},
		db.ListStaleArenasRow{},
	} {
		typ := reflect.TypeOf(row)
		if typ.NumField() != sharedFields {
			t.Errorf("%s has %d fields, want %d — the shared arena column list drifted", typ.Name(), typ.NumField(), sharedFields)
			continue
		}
		for i := 0; i < sharedFields; i++ {
			got, want := typ.Field(i), shared.Field(i)
			if got.Name != want.Name || got.Type != want.Type {
				t.Errorf("%s field %d = %s %s, want %s %s", typ.Name(), i, got.Name, got.Type, want.Name, want.Type)
			}
		}
	}

	list := reflect.TypeOf(db.ListArenasRow{})
	if list.NumField() < sharedFields {
		t.Fatalf("ListArenasRow has %d fields, want at least the %d shared ones", list.NumField(), sharedFields)
	}
	for i := 0; i < sharedFields; i++ {
		got, want := list.Field(i), shared.Field(i)
		if got.Name != want.Name || got.Type != want.Type {
			t.Errorf("ListArenasRow field %d = %s %s, want %s %s", i, got.Name, got.Type, want.Name, want.Type)
		}
	}
}
