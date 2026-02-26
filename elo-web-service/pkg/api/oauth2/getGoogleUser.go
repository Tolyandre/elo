package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	cfg "github.com/tolyandre/elo-web-service/pkg/configuration"
)

type GoogleUserResult struct {
	Id             string
	Email          string
	Verified_email bool
	Name           string
	Given_name     string
	Family_name    string
	Picture        string
}

func GetGoogleUser(access_token string, id_token string) (*GoogleUserResult, error) {
	rootUrl := fmt.Sprintf("%s?alt=json&access_token=%s", cfg.Config.Oauth2UserinfoUri, access_token)

	req, err := http.NewRequest("GET", rootUrl, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", id_token))

	client := http.Client{
		Timeout: time.Second * 30,
	}

	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}

	if res.StatusCode != http.StatusOK {
		return nil, errors.New("could not retrieve user")
	}

	var resBody bytes.Buffer
	_, err = io.Copy(&resBody, res.Body)
	if err != nil {
		return nil, err
	}

	var GoogleUserRes map[string]interface{}

	if err := json.Unmarshal(resBody.Bytes(), &GoogleUserRes); err != nil {
		return nil, err
	}

	// Support both OIDC standard ("sub") and Google v1 API ("id").
	id, _ := GoogleUserRes["sub"].(string)
	if id == "" {
		id, _ = GoogleUserRes["id"].(string)
	}
	if id == "" {
		return nil, errors.New("could not extract user id from userinfo response")
	}

	name, _       := GoogleUserRes["name"].(string)
	givenName, _  := GoogleUserRes["given_name"].(string)
	familyName, _ := GoogleUserRes["family_name"].(string)
	picture, _    := GoogleUserRes["picture"].(string)

	return &GoogleUserResult{
		Id:          id,
		Name:        name,
		Given_name:  givenName,
		Family_name: familyName,
		Picture:     picture,
	}, nil
}
