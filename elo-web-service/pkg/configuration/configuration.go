package configuration

import (
	"errors"
	"flag"
	"log"
	"os"
	"strings"

	"github.com/spf13/viper"
)

type Configuration struct {
	Address                      string  `mapstructure:"address"`
	Oauth2ClientId               string  `mapstructure:"oauth2_client_id"`
	Oauth2ClientSecret           string  `mapstructure:"oauth2_client_secret"`
	Oauth2TokenUri               string  `mapstructure:"oauth2_token_uri"`
	Oauth2AuthUri                string  `mapstructure:"oauth2_auth_uri"`
	Oauth2RedirectUri            string  `mapstructure:"oauth2_redirect_uri"`
	Oauth2UserinfoUri            string  `mapstructure:"oauth2_userinfo_uri"`
	Oauth2Scopes                 string  `mapstructure:"oauth2_scopes"`
	CookieJwtSecret              string  `mapstructure:"cookie_jwt_secret"`
	CookieTtlSeconds             int     `mapstructure:"cookie_ttl_seconds"`
	CookieName                   string  `mapstructure:"cookie_name"`
	FrontendUri                  string  `mapstructure:"frontend_uri"`
	PostgresDSN                  string  `mapstructure:"postgres_dsn"`
	PostgresPassword             string  `mapstructure:"postgres_password"`
	OllamaBaseUrl                string  `mapstructure:"ollama_base_url"`
	OllamaModel                  string  `mapstructure:"ollama_model"`
	OllamaVisionModel            string  `mapstructure:"ollama_vision_model"`
	SkullKingConfidenceThreshold float64 `mapstructure:"skull_king_confidence_threshold"`
}

var Config Configuration

// MigrateDB indicates whether the process should run database migrations using the full config and exit.
var MigrateDB bool

// MigrateDBDSN, when non-empty, causes the process to run migrations against
// the given DSN and exit without loading the rest of the configuration.
// Intended for local dev (make dev-migrate) and integration tests.
var MigrateDBDSN string

func ReadConfiguration() {
	var configPath = flag.String("config-path", "config.yaml", "Path to the configuration file")
	var migrateFlag = flag.Bool("migrate-db", false, "Run DB migrations (using full config) and exit")
	var migrateDSNFlag = flag.String("migrate-db-dsn", "", "Run DB migrations against the given DSN and exit (no config file required)")

	flag.Parse()
	MigrateDB = *migrateFlag
	MigrateDBDSN = *migrateDSNFlag

	// --migrate-db-dsn does not require a config file — return early.
	if MigrateDBDSN != "" {
		return
	}

	viper.SetConfigFile(*configPath)
	viper.SetDefault("address", "localhost:8080")
	viper.SetDefault("ollama_base_url", "http://127.0.0.1:11434")
	viper.SetDefault("ollama_model", "qwen2.5")
	viper.SetDefault("ollama_vision_model", "llava")
	viper.SetDefault("skull_king_confidence_threshold", 0.75)
	viper.SetEnvPrefix("ELO_WEB_SERVICE")
	viper.AutomaticEnv()

	// Bind every mapstructure key to its ELO_WEB_SERVICE_<KEY> env var. Viper's
	// AutomaticEnv does not pick up keys absent from the config file, so we bind
	// them explicitly. The same key table drives the required-field validation
	// below, keeping the two in sync (previously they were two separate
	// hand-maintained lists that drifted).
	for _, key := range configKeys {
		if err := viper.BindEnv(key, "ELO_WEB_SERVICE_"+strings.ToUpper(key)); err != nil {
			log.Fatalf("failed to bind env ELO_WEB_SERVICE_%s: %v", strings.ToUpper(key), err)
		}
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

	// Default the auth cookie name when not configured, so existing deployments
	// (and dev configs) keep the original cookie and users stay logged in.
	if Config.CookieName == "" {
		Config.CookieName = "elo-web-service-token"
	}

	// Validate that required string fields are non-empty.
	var missing []string
	for _, key := range requiredKeys {
		if viper.GetString(key) == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		log.Fatalf("missing required configuration values: %v", missing)
		os.Exit(1)
	}

	if Config.CookieTtlSeconds < 60*5 {
		log.Fatalf("cookie_ttl_seconds must be at least 300 seconds")
		os.Exit(1)
	}
}

// configKeys is the complete set of mapstructure keys for the Configuration
// struct, in declaration order. Every key binds to an ELO_WEB_SERVICE_<KEY>
// environment variable.
var configKeys = []string{
	"address",
	"oauth2_client_id",
	"oauth2_client_secret",
	"oauth2_token_uri",
	"oauth2_auth_uri",
	"oauth2_redirect_uri",
	"oauth2_userinfo_uri",
	"oauth2_scopes",
	"cookie_jwt_secret",
	"cookie_ttl_seconds",
	"cookie_name",
	"frontend_uri",
	"postgres_dsn",
	"postgres_password",
	"ollama_base_url",
	"ollama_model",
	"ollama_vision_model",
	"skull_king_confidence_threshold",
}

// requiredKeys are the string fields that must be non-empty at startup. Note
// this is a subset of configKeys: cookie_name/oauth2_scopes/postgres_password
// and the ollama/skull-king tuning knobs are intentionally optional.
var requiredKeys = []string{
	"address",
	"oauth2_client_id",
	"oauth2_client_secret",
	"oauth2_token_uri",
	"oauth2_auth_uri",
	"oauth2_redirect_uri",
	"oauth2_userinfo_uri",
	"cookie_jwt_secret",
	"frontend_uri",
	"postgres_dsn",
}
