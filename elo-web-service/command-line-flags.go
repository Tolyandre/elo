package main

import (
	"flag"
	"log"
)

var DocId *string
var KeyFilePath *string
var BindAddress *string

func ParseCommandLineFlags() {

	KeyFilePath = flag.String("google-service-account-key", "", "Path to the credentials file")
	DocId = flag.String("doc-id", "", "Google sheets document ID (identifier after /d/ in url)")
	BindAddress = flag.String("bind-address", "localhost:8080", "Interface and port to bind to")
	flag.Parse()

	if *KeyFilePath == "" {
		log.Fatal("google-service-account-key flag is required and cannot be empty")
	}

	if *DocId == "" {
		log.Fatal("doc-id is requred and cannot be empty")
	}
}
