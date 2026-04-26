package api

import "context"

// Skull King routes are handled by raw Gin handlers on *API (not via StrictServer),
// so these strict interface stubs are never invoked at runtime.

func (s *StrictServer) ParseSkullKingCardImage(_ context.Context, _ ParseSkullKingCardImageRequestObject) (ParseSkullKingCardImageResponseObject, error) {
	panic("unreachable: skull king routed directly")
}

func (s *StrictServer) ListSkullKingTables(_ context.Context, _ ListSkullKingTablesRequestObject) (ListSkullKingTablesResponseObject, error) {
	panic("unreachable: skull king routed directly")
}

func (s *StrictServer) CreateSkullKingTable(_ context.Context, _ CreateSkullKingTableRequestObject) (CreateSkullKingTableResponseObject, error) {
	panic("unreachable: skull king routed directly")
}

func (s *StrictServer) DeleteSkullKingTable(_ context.Context, _ DeleteSkullKingTableRequestObject) (DeleteSkullKingTableResponseObject, error) {
	panic("unreachable: skull king routed directly")
}

func (s *StrictServer) GetSkullKingTable(_ context.Context, _ GetSkullKingTableRequestObject) (GetSkullKingTableResponseObject, error) {
	panic("unreachable: skull king routed directly")
}

func (s *StrictServer) SubmitSkullKingBid(_ context.Context, _ SubmitSkullKingBidRequestObject) (SubmitSkullKingBidResponseObject, error) {
	panic("unreachable: skull king routed directly")
}

func (s *StrictServer) JoinSkullKingTable(_ context.Context, _ JoinSkullKingTableRequestObject) (JoinSkullKingTableResponseObject, error) {
	panic("unreachable: skull king routed directly")
}

func (s *StrictServer) SubmitSkullKingResult(_ context.Context, _ SubmitSkullKingResultRequestObject) (SubmitSkullKingResultResponseObject, error) {
	panic("unreachable: skull king routed directly")
}

func (s *StrictServer) UpdateSkullKingTableState(_ context.Context, _ UpdateSkullKingTableStateRequestObject) (UpdateSkullKingTableStateResponseObject, error) {
	panic("unreachable: skull king routed directly")
}
