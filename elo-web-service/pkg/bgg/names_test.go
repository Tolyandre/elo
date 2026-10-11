package bgg

import "testing"

// The cases mirror real alternate-name lists observed on live BGG things
// (ids 30549 Pandemic, 266192 Wingspan, 244522 The Isle of Cats, 68448
// 7 Wonders Duel, 822 Carcassonne, 172 Citadels, 13 Catan).
func TestPickRussianName(t *testing.T) {
	tests := []struct {
		name       string
		alternates []string
		want       string
	}{
		{
			name:       "ukrainian rival drops out",
			alternates: []string{"Pandemic", "Пандемия", "Пандемія"},
			want:       "Пандемия",
		},
		{
			name:       "russian-only letter wins a three-way",
			alternates: []string{"Крила", "Криле", "Крылья"},
			want:       "Крылья",
		},
		{
			name:       "ukrainian exclusive letters mark the other candidate",
			alternates: []string{"Влучний хід", "Хитрый ход"},
			want:       "Хитрый ход",
		},
		{
			name:       "single candidate wins outright",
			alternates: []string{"7 Чудес", "7 Wonders"},
			want:       "7 Чудес",
		},
		{
			name:       "several spellings and a re-theme stay unresolved",
			alternates: []string{"Каркасон", "Каркасон", "Каркассон", "Средневековье"},
			want:       "",
		},
		{
			name:       "obsolete localization ties with the ukrainian one",
			alternates: []string{"З молотка!", "Продано!"},
			want:       "",
		},
		{
			name:       "mixed scripts reduce and the russian-only letter picks the classic name",
			alternates: []string{"Catan (Колонизаторы)", "Naseljenici ostrva Katan / Насељеници острва Катан", "Заселниците на Катан", "Катан", "Колонизаторы"},
			want:       "Колонизаторы",
		},
		{
			name:       "latin-only alternates filtered, single cyrillic wins",
			alternates: []string{"Catan", "The Settlers of Catan", "Котан"},
			want:       "Котан",
		},
		{
			name:       "sole ukrainian candidate is not russian",
			alternates: []string{"Пандемія"},
			want:       "",
		},
		{
			name:       "nil list",
			alternates: nil,
			want:       "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := PickRussianName(tt.alternates); got != tt.want {
				t.Errorf("PickRussianName(%q) = %q, want %q", tt.alternates, got, tt.want)
			}
		})
	}
}

func TestExtractCyrillic(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"Пандемия", "Пандемия"},
		{"Catan (Колонизаторы)", "Колонизаторы"},
		{"7 Чудес", "7 Чудес"},
		{"З молотка!", "З молотка"},
		{"Караколумбус / Колумб", ""},
		{"Naseljenici ostrva Katan / Насељеници острва Катан", "Насељеници острва Катан"},
		{"Carcassonne", ""},
		{"2001", ""},
	}
	for _, tt := range tests {
		if got := extractCyrillic(tt.in); got != tt.want {
			t.Errorf("extractCyrillic(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}
