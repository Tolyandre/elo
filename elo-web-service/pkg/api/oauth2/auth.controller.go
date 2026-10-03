package api

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/tolyandre/elo-web-service/pkg/api"
	cfg "github.com/tolyandre/elo-web-service/pkg/configuration"
)

type UserResponse struct {
	ID   string `json:"id,omitempty"`
	Name string `json:"name,omitempty"`
}

func (a *OAUTH2) LogoutUser(ctx *gin.Context) {
	setTokenCookie(ctx, "", -1)
	api.SuccessMessageResponse(ctx, http.StatusOK, "User logged out successfully")
}

// DefaultTokenCookieName is the auth cookie name used when cookie_name is not
// configured. The effective name is cfg.Config.CookieName (see configuration).
const DefaultTokenCookieName = "elo-web-service-token"

// oauthCallbackSuffix is the frontend route of the OAuth callback page. Every
// deployment mirror serves the same static app, so the callback URL of a
// mirror is always its base URI plus this path (ADR-29).
const oauthCallbackSuffix = "/oauth2-callback"

// frontendCallbackUri builds the Google redirect_uri for a mirror base URI.
func frontendCallbackUri(frontendUri string) string {
	return strings.TrimSuffix(frontendUri, "/") + oauthCallbackSuffix
}

// resolveMirror validates a mirror URI against the deployment's allowlist and
// returns its base URI, or the empty string when it is not allowed.
func resolveMirror(uri string) string {
	if !allowedFrontendUri(uri) {
		return ""
	}
	return strings.TrimSuffix(uri, "/")
}

func (a *OAUTH2) Login(ctx *gin.Context) {
	// The mirror the user started on, carried through Google as "state" and
	// used to derive the per-mirror redirect_uri — Google returns each user
	// to the callback of their own mirror (ADR-29).
	var from string = cfg.Config.FrontendUri

	if ctx.Query("from") != "" {
		if mirror := resolveMirror(ctx.Query("from")); mirror != "" {
			from = mirror
		} else {
			api.ErrorResponse(ctx, http.StatusBadRequest, fmt.Errorf("invalid 'from' domain"))
			return
		}
	}

	scope := cfg.Config.Oauth2Scopes
	values := url.Values{
		"redirect_uri":  []string{frontendCallbackUri(from)},
		"client_id":     []string{cfg.Config.Oauth2ClientId},
		"access_type":   []string{"offline"},
		"response_type": []string{"code"},
		"prompt":        []string{"consent"},
		"state":         []string{from},
		"scope":         []string{scope},
	}

	u, err := url.Parse(cfg.Config.Oauth2AuthUri)
	if err != nil {
		api.ErrorResponse(ctx, http.StatusBadRequest, err)
		return
	}

	u.RawQuery = values.Encode()
	ctx.Redirect(http.StatusTemporaryRedirect, u.String())
}

// GoogleOAuth is called by the callback page of the mirror the user logged in
// from (top-level navigation from Google landed there): it exchanges the code
// for tokens and sets the session cookie. The exchange must present the same
// redirect_uri the authorization request used — the callback URL of the mirror
// in the state (ADR-29). The cookie is set in the mirror's own first-party
// context, which is what keeps strict browser cookie protection (Firefox ETP,
// Opera) working; on the API domain there is no frontend at all.
func (a *OAUTH2) GoogleOAuth(ctx *gin.Context) {
	code := ctx.Query("code")
	if code == "" {
		api.ErrorResponse(ctx, http.StatusBadRequest, "Authorization code not provided")
		return
	}

	// State is our own Login's output, but this endpoint is browser-reachable:
	// only an allowlisted mirror's callback URL may be presented as the
	// exchange redirect_uri. Anything else (or a missing state) falls back to
	// the primary mirror, which then simply fails the Google exchange with a
	// redirect_uri mismatch for a forged code/state pair.
	redirectUri := frontendCallbackUri(cfg.Config.FrontendUri)
	if mirror := resolveMirror(ctx.Query("state")); mirror != "" {
		redirectUri = frontendCallbackUri(mirror)
	}

	tokenRes, err := GetOauthTokenWithRedirect(code, redirectUri)
	if err != nil {
		api.ErrorResponse(ctx, http.StatusBadRequest, err)
		return
	}

	googleUser, err := GetGoogleUser(tokenRes.Access_token, tokenRes.Id_token)
	if err != nil {
		api.ErrorResponse(ctx, http.StatusInternalServerError, err)
		return
	}

	userId, err := a.UserService.CreateOrUpdateGoogleUser(ctx, googleUser.Id, googleUser.Name)
	if err != nil {
		api.ErrorResponse(ctx, http.StatusInternalServerError, err)
		return
	}

	token, err := CreateJwt(time.Duration(cfg.Config.CookieTtlSeconds)*time.Second, string(userId), cfg.Config.CookieJwtSecret)
	if err != nil {
		api.ErrorResponse(ctx, http.StatusInternalServerError, err)
		return
	}

	setTokenCookie(ctx, token, cfg.Config.CookieTtlSeconds)
	api.SuccessMessageResponse(ctx, http.StatusOK, "User logged in successfully")
}

func setTokenCookie(ctx *gin.Context, token string, maxAge int) {
	http.SetCookie(ctx.Writer, &http.Cookie{
		Name:     cfg.Config.CookieName,
		Value:    url.QueryEscape(token),
		MaxAge:   maxAge,
		Path:     "/",
		Domain:   "",
		SameSite: http.SameSiteNoneMode,
		Secure:   true,
		HttpOnly: true,
	})
}

// allowedFrontendUri reports whether uri's origin (scheme://host[:port])
// matches frontend_uri or one of allowed_frontend_uris. The "from" URI selects
// the mirror the user logs in from and returns to, so only origins this
// deployment actually serves may be used.
func allowedFrontendUri(uri string) bool {
	origin := uriOrigin(uri)
	if origin == "" {
		return false
	}
	allowed := append([]string{cfg.Config.FrontendUri}, cfg.Config.AllowedFrontendUris...)
	for _, candidate := range allowed {
		if uriOrigin(candidate) == origin {
			return true
		}
	}
	return false
}

func uriOrigin(uri string) string {
	u, err := url.Parse(uri)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}
