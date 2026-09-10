package api

import "context"

// Table routes are handled by raw Gin handlers on *API (not via StrictServer),
// so these strict interface stubs are never invoked at runtime.

func (s *StrictServer) ListTables(_ context.Context, _ ListTablesRequestObject) (ListTablesResponseObject, error) {
	panic("unreachable: tables routed directly")
}

func (s *StrictServer) CreateTable(_ context.Context, _ CreateTableRequestObject) (CreateTableResponseObject, error) {
	panic("unreachable: tables routed directly")
}

func (s *StrictServer) DeleteTable(_ context.Context, _ DeleteTableRequestObject) (DeleteTableResponseObject, error) {
	panic("unreachable: tables routed directly")
}

func (s *StrictServer) GetTable(_ context.Context, _ GetTableRequestObject) (GetTableResponseObject, error) {
	panic("unreachable: tables routed directly")
}

func (s *StrictServer) SubmitTable(_ context.Context, _ SubmitTableRequestObject) (SubmitTableResponseObject, error) {
	panic("unreachable: tables routed directly")
}

func (s *StrictServer) JoinTable(_ context.Context, _ JoinTableRequestObject) (JoinTableResponseObject, error) {
	panic("unreachable: tables routed directly")
}

func (s *StrictServer) UpdateTableState(_ context.Context, _ UpdateTableStateRequestObject) (UpdateTableStateResponseObject, error) {
	panic("unreachable: tables routed directly")
}

func (s *StrictServer) TakeoverTable(_ context.Context, _ TakeoverTableRequestObject) (TakeoverTableResponseObject, error) {
	panic("unreachable: tables routed directly")
}
