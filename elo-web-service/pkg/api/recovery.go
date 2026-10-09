package api

import (
	"fmt"
	"log"
	"net/http"
	"runtime/debug"

	"github.com/gin-gonic/gin"
)

// JSONRecovery is the panic-recovery middleware answering in the common
// {"status":"fail","message":...} envelope. gin.Default()'s built-in
// Recovery aborts with a bare 500 and an empty body, which clients then
// choke on parsing; the panic value is included in the message the same
// way errorMiddleware passes err.Error() through for returned errors.
func JSONRecovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("panic recovered: %v\n%s", r, debug.Stack())
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
					"status":  StatusFail,
					"message": fmt.Sprintf("panic: %v", r),
				})
			}
		}()
		c.Next()
	}
}
