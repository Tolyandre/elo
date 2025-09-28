package main

import (
	"context"
	"flag"
	"fmt"
	"io/ioutil"
	"log"

	"golang.org/x/oauth2/google"
	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

var sheetsService *sheets.Service

func InitGoogleSheetsService() {
	keyFilePath := flag.String("google-service-account-key", "", "Path to the credentials file")
	flag.Parse()

	if *keyFilePath == "" {
		log.Fatal("google-service-account-key flag is required and cannot be empty")
	}

	ctx := context.Background()
	credentials, err := ioutil.ReadFile(*keyFilePath)
	if err != nil {
		log.Fatal("unable to read key file:", err)
	}

	scopes := []string{
		"https://www.googleapis.com/auth/spreadsheets.readonly",
	}
	config, err := google.JWTConfigFromJSON(credentials, scopes...)
	if err != nil {
		log.Fatal("unable to create JWT configuration:", err)
	}

	sheetsService, err = sheets.NewService(ctx, option.WithHTTPClient(config.Client(ctx)))
	if err != nil {
		log.Fatalf("unable to retrieve sheets service: %v", err)
	}
}

func Demo() {
	docId := "1bf6bmd63dvO9xjtnoTGmkcWJJE0NetQRjKkgcQvovQQ"
	doc, err := sheetsService.Spreadsheets.Get(docId).Do()
	if err != nil {
		log.Fatalf("unable to retrieve data from document: %v", err)
	}
	fmt.Printf("The title of the doc is: %s\n", doc.Properties.Title)

	val, err := sheetsService.Spreadsheets.Values.Get(docId, "Rank!A:C").Do()
	if err != nil {
		log.Fatalf("unable to retrieve range from document: %v", err)
	}

	fmt.Printf("Selected major dimension=%v, range=%v\n", val.MajorDimension, val.Range)
	for _, row := range val.Values {
		fmt.Println(row)
	}
}
