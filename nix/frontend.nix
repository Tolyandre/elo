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
  #   - wasm        : the offline settlement engine artifact (nix/wasm.nix, ADR-38),
  #                   copied into public/wasm/ so `next build` ships it; the
  #                   service worker precaches it with a content-hash revision.
{
  lib,
  stdenvNoCC,
  nodejs_24,
  pnpm,
  fetchPnpmDeps,
  pnpmConfigHook,
  wasm,
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
    hash = "sha256-etAT64tyc1BpXJmzdJVAcGuD/8XHiGbaG0v7fe2tH9E=";
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
    # The settlement engine artifact (ADR-38) is not in the flake source (it
    # is gitignored); bring in the wasm derivation's copy before the build so
    # `next build` ships it under /wasm/ and the SW precaches it.
    mkdir -p public/wasm
    cp -rL ${wasm}/. public/wasm/
    pnpm build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cp -r out $out
    runHook postInstall
  '';
})
