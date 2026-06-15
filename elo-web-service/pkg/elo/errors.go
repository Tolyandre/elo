package elo

import "errors"

var (
	ErrTooFewPlayers                    = errors.New("партия требует минимум 2 игрока")
	ErrDateChangeTooLarge               = errors.New("изменение даты партии не может превышать 3 дня")
	ErrMatchDateOutOfRange              = errors.New("дата партии не может быть в будущем или старше 30 дней")
	ErrBetLimitExceeded                 = errors.New("ставка превысит лимит бронирования")
	ErrMarketNotOpen                    = errors.New("рынок не открыт")
	ErrPlayerHasNoLinkedPlayer          = errors.New("у пользователя нет привязанного игрока")
	ErrHistoryChangeConflict            = errors.New("изменение истории невозможно: ставка была сделана до того, как рынок был разрешён в результате новой даты партии")
	ErrHistoryChangeConflictBettingLock = errors.New("изменение истории невозможно: приём ставок был закрыт до того, как рынок был разрешён в результате новой даты партии")
	ErrMatchNotFound                    = errors.New("матч не найден")

	ErrTournamentMemberHasMatches    = errors.New("нельзя удалить участника, сыгравшего партии в турнире")
	ErrTournamentDatesNarrowEloRange = errors.New("даты турнира не охватывают уже сыгранные партии")
	ErrTournamentHasMembers          = errors.New("нельзя удалить турнир с участниками")
)
