package api

//go:generate go run ../../tools/bundle-openapi ../../../openapi/openapi.yaml ../../../openapi/bundled.json
//go:generate go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen --config=../../oapi-codegen.yaml ../../../openapi/bundled.json
