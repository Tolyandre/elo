package googlesheet

import (
	"errors"
	"fmt"

	"google.golang.org/api/sheets/v4"
)

func AddOrUpdate(ID string, Name string) error {

	// Read the whole users sheet
	usersResp, err := sheetsService.Spreadsheets.Values.Get(docId, "Пользователи!A:C").Do()
	if err != nil {
		return err
	}

	// If sheet empty -> just append
	if len(usersResp.Values) == 0 {
		if err := appendUserRow(UserRow{
			ID:   ID,
			Name: Name,
		}); err != nil {
			return err
		}
		return nil
	}

	// Search for existing user by ID (skip header row at index 0)
	for i, row := range usersResp.Values {
		if i < 1 {
			continue
		}
		if len(row) == 0 {
			continue
		}
		existingID := fmt.Sprintf("%v", row[0])
		if existingID != ID {
			continue
		}

		// Found by ID — compare fields
		var existingName string
		var existingCanEdit bool
		if len(row) > 1 {
			existingName = fmt.Sprintf("%v", row[1])
		}
		if len(row) > 2 {
			existingCanEdit = parseBool(row[2])
		}

		// If identical — nothing to do
		if existingName == Name {
			return nil
		}

		// Otherwise update the specific row
		spreadsheetRow := i + 1 // sheet rows are 1-based; header is row 1
		updateRange := fmt.Sprintf("Пользователи!A%d:C%d", spreadsheetRow, spreadsheetRow)
		newRow := []interface{}{ID, Name, existingCanEdit}
		_, err := sheetsService.Spreadsheets.Values.Update(docId, updateRange, &sheets.ValueRange{
			Values: [][]interface{}{newRow},
		}).ValueInputOption("USER_ENTERED").Do()
		if err != nil {
			return fmt.Errorf("unable to update user: %v", err.Error())
		}
		InvalidateCache()
		return nil
	}

	// Not found -> append new user
	if err := appendUserRow(UserRow{
		ID:      ID,
		Name:    Name,
		CanEdit: false,
	}); err != nil {
		return err
	}
	return nil
}

// appendUserRow appends a user row to the users sheet and invalidates cache.
func appendUserRow(user UserRow) error {
	row := []interface{}{user.ID, user.Name, user.CanEdit}
	appendRange := "Пользователи!A:Z"
	_, err := sheetsService.Spreadsheets.Values.Append(docId, appendRange, &sheets.ValueRange{
		Values: [][]interface{}{row},
	}).ValueInputOption("USER_ENTERED").InsertDataOption("OVERWRITE").Do()
	if err != nil {
		return fmt.Errorf("unable to append user: %v", err.Error())
	}
	InvalidateCache()
	return nil
}

func parseUsersSheet() ([]UserRow, error) {
	usersResp, err := sheetsService.Spreadsheets.Values.Get(docId, "Пользователи!A:Z").Do()
	if err != nil {
		return nil, err
	}

	if len(usersResp.Values) == 0 {
		return nil, errors.New("users sheet is empty")
	}

	var userRows []UserRow
	for i, row := range usersResp.Values {
		if i < 1 {
			continue
		}
		userRows = append(userRows, UserRow{
			ID:      fmt.Sprintf("%v", row[0]),
			Name:    fmt.Sprintf("%v", row[1]),
			CanEdit: parseBool(row[2]),
		})
	}
	return userRows, nil
}
