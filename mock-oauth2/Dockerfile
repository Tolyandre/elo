FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY main.go .
RUN go build -o mock-oauth2 .

FROM alpine:3.19
COPY --from=builder /app/mock-oauth2 /mock-oauth2
EXPOSE 8080
CMD ["/mock-oauth2"]
