# Builds the Next.js frontend as a static export (`output: 'export'`), the same
# artifact GitHub Pages deploys. All deployment-specific values are baked at
# build time via NEXT_PUBLIC_* env vars, so the result is a plain directory of
# static files that Caddy (or GitHub Pages) can serve.
#
# Parameterized so the same build powers multiple installs:
#   - basePath    : URL prefix the app is served under (e.g. "/elo").
#   - apiBaseUrl  : absolute URL of the elo-web-service backend.
#   - bannerText  : optional top banner label (e.g. "Тестовый сервер"); empty hides it.
#   - revision    : versions the service-worker precache so a new deploy invalidates caches.
{
  lib,
  stdenvNoCC,
  nodejs_24,
  pnpm,
  fetchPnpmDeps,
  pnpmConfigHook,
  basePath ? "/elo",
  apiBaseUrl,
  bannerText ? "",
  revision ? "dev",
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "elo-frontend";
  version = revision;

  src = lib.cleanSourceWith {
    src = ../nextjs;
    filter =
      path: _type:
      let
        base = baseNameOf path;
      in
      !(builtins.elem base [
        "node_modules"
        ".next"
        "out"
      ]);
  };

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    fetcherVersion = 3;
    hash = "sha256-LnydQ9SokqrERgVhbCP6W/A3QdaW8GCehjXRDEWxQ58=";
  };

  nativeBuildInputs = [
    nodejs_24
    pnpm
    pnpmConfigHook
  ];

  env = {
    NEXT_PUBLIC_BASE_PATH = basePath;
    NEXT_PUBLIC_ELO_WEB_SERVICE_BASE_URL = apiBaseUrl;
    NEXT_PUBLIC_ENV_BANNER = bannerText;
    # next.config.ts reads GITHUB_SHA as the precache revision.
    GITHUB_SHA = revision;
    NEXT_TELEMETRY_DISABLED = "1";
  };

  buildPhase = ''
    runHook preBuild
    pnpm build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cp -r out $out
    runHook postInstall
  '';
})
