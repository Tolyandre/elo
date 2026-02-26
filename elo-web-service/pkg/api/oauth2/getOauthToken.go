package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"time"

	cfg "github.com/tolyandre/elo-web-service/pkg/configuration"
)

type OauthToken struct {
	Access_token string
	Id_token     string
}

func GetOauthToken(code string) (*OauthToken, error) {

	values := url.Values{}
	values.Add("grant_type", "authorization_code")
	values.Add("code", code)
	values.Add("client_id", cfg.Config.Oauth2ClientId)
	values.Add("client_secret", cfg.Config.Oauth2ClientSecret)
	values.Add("redirect_uri", cfg.Config.Oauth2RedirectUri)

	query := values.Encode()

	req, err := http.NewRequest("POST", cfg.Config.Oauth2TokenUri, bytes.NewBufferString(query))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := http.Client{
		Timeout: time.Second * 30,
	}

	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}

	if res.StatusCode != http.StatusOK {
		return nil, errors.New("could not retrieve token")
	}

	var resBody bytes.Buffer
	_, err = io.Copy(&resBody, res.Body)
	if err != nil {
		return nil, err
	}

	var GoogleOauthTokenRes map[string]interface{}

	if err := json.Unmarshal(resBody.Bytes(), &GoogleOauthTokenRes); err != nil {
		return nil, err
	}

	accessToken, _ := GoogleOauthTokenRes["access_token"].(string)
	idToken, _     := GoogleOauthTokenRes["id_token"].(string)
	tokenBody := &OauthToken{
		Access_token: accessToken,
		Id_token:     idToken,
	}

	return tokenBody, nil
}
