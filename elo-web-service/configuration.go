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
	Oauth2ClientId          string `mapstructure:"oauth2_client_id"`
	Oauth2ClientSecret      string `mapstructure:"oauth2_client_secret"`
	Oauth2TokenUri          string `mapstructure:"oauth2_token_uri"`
	Oauth2AuthUri           string `mapstructure:"oauth2_auth_uri"`
	Oauth2RedirectUri       string `mapstructure:"oauth2_redirect_uri"`
	CookieJwtSecret         string `mapstructure:"cookie_jwt_secret"`
	FrontendUri             string `mapstructure:"frontend_uri"`
}

var Config Configuration

func ReadConfiguration() {
	var configPath = flag.String("config-path", "config.yaml", "Path to the configuration file")

	flag.Parse()

	viper.SetConfigFile(*configPath)
	viper.SetDefault("address", "localhost:8080")
	viper.SetEnvPrefix("ELO_WEB_SERVICE")
	viper.AutomaticEnv()

	// for some reason AutomaticEnv does not bind to the environment variables. We need to do it manually
	if err := viper.BindEnv("google_service_account_key", "ELO_WEB_SERVICE_GOOGLE_SERVICE_ACCOUNT_KEY"); err != nil {
		log.Fatalf("failed to bind env ELO_WEB_SERVICE_GOOGLE_SERVICE_ACCOUNT_KEY: %v", err)
	}
	if err := viper.BindEnv("doc_id", "ELO_WEB_SERVICE_DOC_ID"); err != nil {
		log.Fatalf("failed to bind env ELO_WEB_SERVICE_DOC_ID: %v", err)
	}
	if err := viper.BindEnv("address", "ELO_WEB_SERVICE_ADDRESS"); err != nil {
		log.Fatalf("failed to bind env ELO_WEB_SERVICE_ADDRESS: %v", err)
	}
	if err := viper.BindEnv("oauth2_client_id", "ELO_WEB_SERVICE_OAUTH2_CLIENT_ID"); err != nil {
		log.Fatalf("failed to bind env ELO_WEB_SERVICE_OAUTH2_CLIENT_ID: %v", err)
	}
	if err := viper.BindEnv("oauth2_client_secret", "ELO_WEB_SERVICE_OAUTH2_CLIENT_SECRET"); err != nil {
		log.Fatalf("failed to bind env ELO_WEB_SERVICE_OAUTH2_CLIENT_SECRET: %v", err)
	}
	if err := viper.BindEnv("oauth2_token_uri", "ELO_WEB_SERVICE_OAUTH2_TOKEN_URI"); err != nil {
		log.Fatalf("failed to bind env ELO_WEB_SERVICE_OAUTH2_TOKEN_URI: %v", err)
	}
	if err := viper.BindEnv("oauth2_auth_uri", "ELO_WEB_SERVICE_OAUTH2_AUTH_URI"); err != nil {
		log.Fatalf("failed to bind env ELO_WEB_SERVICE_OAUTH2_AUTH_URI: %v", err)
	}
	if err := viper.BindEnv("oauth2_redirect_uri", "ELO_WEB_SERVICE_OAUTH2_REDIRECT_URI"); err != nil {
		log.Fatalf("failed to bind env ELO_WEB_SERVICE_OAUTH2_REDIRECT_URI: %v", err)
	}
	if err := viper.BindEnv("cookie_jwt_secret", "ELO_WEB_SERVICE_COOKIE_JWT_SECRET"); err != nil {
		log.Fatalf("failed to bind env ELO_WEB_SERVICE_COOKIE_JWT_SECRET: %v", err)
	}
	if err := viper.BindEnv("frontend_uri", "ELO_WEB_SERVICE_FRONTEND_URI"); err != nil {
		log.Fatalf("failed to bind env ELO_WEB_SERVICE_FRONTEND_URI: %v", err)
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

	// Validate that all config fields are non-empty (at least a non-empty string)
	var missing []string
	if Config.GoogleServiceAccountKey == "" {
		missing = append(missing, "google_service_account_key")
	}
	if Config.DocID == "" {
		missing = append(missing, "doc_id")
	}
	if Config.Address == "" {
		missing = append(missing, "address")
	}
	if Config.Oauth2ClientId == "" {
		missing = append(missing, "oauth2_client_id")
	}
	if Config.Oauth2ClientSecret == "" {
		missing = append(missing, "oauth2_client_secret")
	}
	if Config.Oauth2TokenUri == "" {
		missing = append(missing, "oauth2_token_uri")
	}
	if Config.Oauth2AuthUri == "" {
		missing = append(missing, "oauth2_auth_uri")
	}
	if Config.Oauth2RedirectUri == "" {
		missing = append(missing, "oauth2_redirect_uri")
	}
	if Config.CookieJwtSecret == "" {
		missing = append(missing, "cookie_jwt_secret")
	}
	if Config.FrontendUri == "" {
		missing = append(missing, "frontend_uri")
	}

	if len(missing) > 0 {
		log.Fatalf("missing required configuration values: %v", missing)
		os.Exit(1)
	}
}
