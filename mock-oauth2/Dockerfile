FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY main.go .
RUN go mod init mock-oauth2 && go build -o mock-oauth2 .

FROM alpine:3.19
COPY --from=builder /app/mock-oauth2 /mock-oauth2
EXPOSE 8080
CMD ["/mock-oauth2"]
