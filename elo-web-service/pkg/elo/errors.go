package elo

import "errors"

var (
	ErrTooFewPlayers           = errors.New("партия требует минимум 2 игрока")
	ErrDateChangeTooLarge      = errors.New("изменение даты партии не может превышать 3 дня")
	ErrBetLimitExceeded        = errors.New("ставка превысит лимит бронирования")
	ErrMarketNotOpen           = errors.New("рынок не открыт")
	ErrPlayerHasNoLinkedPlayer = errors.New("у пользователя нет привязанного игрока")
	ErrHistoryChangeConflict   = errors.New("изменение истории невозможно: ставка была сделана до того, как рынок был разрешён в результате новой даты партии")
)
