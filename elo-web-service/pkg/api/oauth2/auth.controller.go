package api

import (
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/tolyandre/elo-web-service/pkg/api"
	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

type UserResponse struct {
	ID   string `json:"id,omitempty"`
	Name string `json:"name,omitempty"`
}

func LogoutUser(ctx *gin.Context) {
	setTokenCookie(ctx, "", -1)
	api.SuccessMessageResponse(ctx, http.StatusOK, "User logged out successfully")
}

var (
	oauth2ClientId     string
	oauth2ClientSecret string
	oauth2AuthURI      string
	oauth2RedirectURI  string
	oauth2TokenURL     string
	cookieJwtSecret    string
	frontendDomain     string
)

func InitOauth(clientId string, clientSecret string, authURI string, redirectURI string, tokenURL string, jwtSecret string, domain string) {
	oauth2ClientId = clientId
	oauth2ClientSecret = clientSecret
	oauth2AuthURI = authURI
	oauth2RedirectURI = redirectURI
	oauth2TokenURL = tokenURL
	cookieJwtSecret = jwtSecret
	frontendDomain = domain
}

const TokenCookieName = "elo-web-service-token"

func GoogleOAuth(ctx *gin.Context) {
	code := ctx.Query("code")

	if code == "" {
		api.ErrorResponse(ctx, http.StatusBadRequest, "Authorization code not provided")
		return
	}

	tokenRes, err := GetOauthToken(code)

	if err != nil {
		api.ErrorResponse(ctx, http.StatusBadRequest, err)
		return
	}

	google_user, err := GetGoogleUser(tokenRes.Access_token, tokenRes.Id_token)

	if err != nil {
		api.ErrorResponse(ctx, http.StatusInternalServerError, err)
		return
	}

	const ttlSeconds = 3600 * 24
	token, err := CreateJwt(time.Duration(ttlSeconds)*time.Second, google_user.Id, cookieJwtSecret)
	if err != nil {
		api.ErrorResponse(ctx, http.StatusInternalServerError, err)
		return
	}

	googlesheet.AddOrUpdate(google_user.Id, google_user.Name)

	setTokenCookie(ctx, token, ttlSeconds)
	api.SuccessMessageResponse(ctx, http.StatusOK, "User logged in successfully")
}

func Login(ctx *gin.Context) {

	var from string = frontendDomain

	if ctx.Query("from") != "" {
		from = ctx.Query("from")

		if from != "" {
			getHost := func(s string) string {
				if u, err := url.Parse(s); err == nil && u.Host != "" {
					return u.Hostname()
				}
				return s
			}

			if getHost(from) != getHost(frontendDomain) {
				api.ErrorResponse(ctx, http.StatusBadRequest, fmt.Errorf("invalid 'from' domain"))
				return
			}
		}
	}

	scope := fmt.Sprintf("%s %s",
		"https://www.googleapis.com/auth/userinfo.profile",
		"",
		/*"https://www.googleapis.com/auth/userinfo.email"*/)
	values := url.Values{
		"redirect_uri":  []string{oauth2RedirectURI},
		"client_id":     []string{oauth2ClientId},
		"access_type":   []string{"offline"},
		"response_type": []string{"code"},
		"prompt":        []string{"consent"},
		"state":         []string{from},
		"scope":         []string{scope},
	}

	u, err := url.Parse(oauth2AuthURI)
	if err != nil {
		api.ErrorResponse(ctx, http.StatusBadRequest, err)
		return
	}

	u.RawQuery = values.Encode()
	ctx.Redirect(http.StatusTemporaryRedirect, u.String())
}

func setTokenCookie(ctx *gin.Context, token string, maxAge int) {
	http.SetCookie(ctx.Writer, &http.Cookie{
		Name:     TokenCookieName,
		Value:    url.QueryEscape(token),
		MaxAge:   maxAge,
		Path:     "/",
		Domain:   "",
		SameSite: http.SameSiteNoneMode,
		Secure:   true,
		HttpOnly: true,
	})
}
