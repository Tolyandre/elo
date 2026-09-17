package elo

import "errors"

var (
	ErrTooFewPlayers                    = errors.New("партия требует минимум 2 игрока")
	ErrDateChangeTooLarge               = errors.New("изменение даты партии не может превышать 3 дня")
	ErrMatchDateOutOfRange              = errors.New("дата партии не может быть в будущем или старше 30 дней")
	ErrBetLimitExceeded                 = errors.New("ставка превысит лимит бронирования")
	ErrMarketNotOpen                    = errors.New("рынок не открыт")
	ErrMarketOutcomeNotFound            = errors.New("указанный исход не существует на этом рынке")
	ErrProbabilityChanged               = errors.New("цена изменилась, обновите страницу и повторите ставку")
	ErrMarketNeedsGuarantor             = errors.New("рынок ждёт поручителей: пока ставок нет, встать поручителем можно на странице рынка")
	ErrGuaranteeRiskNotPositive         = errors.New("размер риска поручителя должен быть положительным")
	ErrGuaranteeFeeOutOfRange           = errors.New("комиссия поручителя должна быть от 0% до 25%")
	ErrPlayerHasNoLinkedPlayer          = errors.New("у пользователя нет привязанного игрока")
	ErrPlayerAlreadyLinked              = errors.New("player already linked to another user")
	ErrHistoryChangeConflict            = errors.New("изменение истории невозможно: ставка была сделана до того, как рынок был разрешён в результате новой даты партии")
	ErrHistoryChangeConflictBettingLock = errors.New("изменение истории невозможно: приём ставок был закрыт до того, как рынок был разрешён в результате новой даты партии")
	ErrMatchNotFound                    = errors.New("матч не найден")

	// Camp arenas (ADR-27).
	ErrCampDatesRequired       = errors.New("кэмпу нужны дата начала и дата конца")
	ErrCampDatesInvalid        = errors.New("дата начала кэмпа должна быть раньше даты конца")
	ErrCampDatesExcludeMatch   = errors.New("даты кэмпа не охватывают уже сыгранные партии")
	ErrCampLeaguesNotAllowed   = errors.New("кэмп не может иметь лиги")
	ErrCampArenaInvalid        = errors.New("указанный кэмп не существует или дата партии вне его дат")
	ErrMatchOutsideCampWindows = errors.New("дата партии вне дат кэмпа, в котором она учтена — исключите её из кэмпа в этом же изменении")

	ErrGlobalArenaIsPermanent = errors.New("глобальную арену нельзя изменить или удалить")
	ErrArenaIsAutoManaged     = errors.New("арена игры или турнира управляется автоматически и не может быть изменена")
	ErrArenaNameTaken         = errors.New("арена с таким названием уже существует")
)
