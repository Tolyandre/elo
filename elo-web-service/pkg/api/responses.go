package api

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
)

func ErrorResponse(c *gin.Context, code int, err any) {
	var message string
	switch v := err.(type) {
	case error:
		message = v.Error()
	case string:
		message = v
	default:
		message = fmt.Sprintf("%v", v)
	}

	c.JSON(code, gin.H{
		"status":  "fail",
		"message": message,
	})
}

func SuccessMessageResponse(c *gin.Context, code int, message string) {
	c.JSON(code, gin.H{
		"status":  "success",
		"message": message,
	})
}

func SuccessDataResponse(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "Successfully retrieved data",
		"data":    data,
	})
}
