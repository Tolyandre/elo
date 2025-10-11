package main

import (
	"errors"
	"flag"
	"log"
	"os"

	"github.com/spf13/viper"
)

type Configuration struct {
	GoogleServiceAccountKey string `mapstructure:"google_service_account_key"`
	DocID                   string `mapstructure:"doc_id"`
	Address                 string `mapstructure:"address"`
}

var Config Configuration

func ReadConfiguration() {
	var configPath = flag.String("config-path", "config.yaml", "Path to the configuration file")

	flag.Parse()

	viper.SetConfigFile(*configPath)
	viper.SetDefault("address", "localhost:8080")

	if err := viper.BindEnv("google_service_account_key", "GOOGLE_SERVICE_ACCOUNT_KEY"); err != nil {
		log.Fatalf("failed to bind env GOOGLE_SERVICE_ACCOUNT_KEY: %v", err)
	}
	if err := viper.BindEnv("doc_id", "DOC_ID"); err != nil {
		log.Fatalf("failed to bind env DOC_ID: %v", err)
	}
	if err := viper.BindEnv("address", "ADDRESS"); err != nil {
		log.Fatalf("failed to bind env ADDRESS: %v", err)
	}

	if err := viper.ReadInConfig(); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			log.Printf("Config file is not found: %s", *configPath)
		} else {
			log.Fatalf("Config file read error: %v", err)
			os.Exit(1)
		}
	}

	if err := viper.Unmarshal(&Config); err != nil {
		log.Fatalf("config unmarshal error: %v", err)
		os.Exit(1)
	}

	if Config.GoogleServiceAccountKey == "" {
		log.Fatal("google_service_account_key is required and cannot be empty")
		os.Exit(1)
	}

	if Config.DocID == "" {
		log.Fatal("doc_id is requred and cannot be empty")
		os.Exit(1)
	}
}
