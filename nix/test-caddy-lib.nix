# Regression test for the Caddyfile generator (nix/caddy.nix): the generated
# text is pinned so directive or whitespace drift fails `nix flake check`.
{
  pkgs,
  caddySite,
}:

let
  frontend = "/nix/store/00000000000000000000000000000000-elo-frontend";

  expectedProd = ''
    @elo-api path /elo-web-service /elo-web-service/*
    handle @elo-api {
      uri strip_prefix /elo-web-service
      reverse_proxy http://localhost:8080
    }

    @elo-ui path /elo /elo/*
    handle @elo-ui {
      uri strip_prefix /elo
      root * ${frontend}
      try_files {path} {path}.html {path}/index.html /index.html
      file_server
    }
  '';

  expectedStage = ''
    @elo-stage-api path /elo-web-service-stage /elo-web-service-stage/*
    handle @elo-stage-api {
      uri strip_prefix /elo-web-service-stage
      reverse_proxy http://localhost:8081
    }

    @elo-stage-ui path /elo-stage /elo-stage/*
    handle @elo-stage-ui {
      uri strip_prefix /elo-stage
      root * ${frontend}
      try_files {path} {path}.html {path}/index.html /index.html
      file_server
    }
  '';

  expectedDedicated = ''
    https://elo.example.com {
      @elo-api path /elo-web-service /elo-web-service/*
      handle @elo-api {
        uri strip_prefix /elo-web-service
        reverse_proxy http://localhost:8080
      }

      @elo-ui path /elo /elo/*
      handle @elo-ui {
        uri strip_prefix /elo
        root * ${frontend}
        try_files {path} {path}.html {path}/index.html /index.html
        file_server
      }

      log output
    }
  '';

  actualProd = caddySite {
    backendAddress = "localhost:8080";
    frontendRoot = frontend;
  };

  actualStage = caddySite {
    name = "elo-stage";
    basePath = "/elo-stage";
    apiPath = "/elo-web-service-stage";
    backendAddress = "localhost:8081";
    frontendRoot = frontend;
  };

  actualDedicated = caddySite {
    backendAddress = "localhost:8080";
    frontendRoot = frontend;
    siteAddresses = [ "https://elo.example.com" ];
    extraDirectives = "log output";
  };

in
pkgs.runCommand "caddy-lib-tests" { } ''
  assertCase() {
    local name="$1"
    if ! diff -u "$name-expected" "$name-actual"; then
      echo "FAIL: caddySite $name drifted from the pinned Caddyfile" >&2
      exit 1
    fi
  }

  cat >prod-expected <<'EOF'
${expectedProd}
EOF
  cat >prod-actual <<'EOF'
${actualProd}
EOF
  assertCase prod

  cat >stage-expected <<'EOF'
${expectedStage}
EOF
  cat >stage-actual <<'EOF'
${actualStage}
EOF
  assertCase stage

  cat >dedicated-expected <<'EOF'
${expectedDedicated}
EOF
  cat >dedicated-actual <<'EOF'
${actualDedicated}
EOF
  assertCase dedicated

  touch "$out"
''
