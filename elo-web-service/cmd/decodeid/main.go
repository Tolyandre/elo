// Command decodeid converts entity ids between their two forms: the canonical
// UUID stored in the database and the Base58 wire form used by the HTTP API
// (ADR-12). It accepts either form and any number of ids; for each it prints
// the canonical UUID, the Base58 form and — for UUIDv7 ids — the creation
// timestamp embedded in the id. With -canonical it prints only the canonical
// UUID, one per line, for use in shell pipelines:
//
//	go run ./cmd/decodeid 4kRhVeNBDGBSMYcmWf7NxB
//	go run ./cmd/decodeid -canonical 4kRhVeNBDGBSMYcmWf7NxB
package main

import (
	"encoding/binary"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

func main() {
	canonicalOnly := flag.Bool("canonical", false, "print only the canonical UUID, one per line")
	flag.Parse()

	if flag.NArg() == 0 {
		fmt.Fprintln(os.Stderr, "usage: decodeid [-canonical] <id> [<id>...]")
		os.Exit(2)
	}

	exit := 0
	for _, arg := range flag.Args() {
		canonical, err := id.ParseTolerant(arg)
		if err != nil {
			fmt.Fprintf(os.Stderr, "decodeid: %v\n", err)
			exit = 1
			continue
		}
		if *canonicalOnly {
			fmt.Println(canonical)
			continue
		}
		fmt.Printf("%s\n  base58:  %s\n", canonical, id.ToBase58(canonical.String()))
		if ts, ok := uuidv7Timestamp(canonical.String()); ok {
			fmt.Printf("  created: %s (uuidv7)\n", ts.Format(time.RFC3339))
		}
	}
	os.Exit(exit)
}

// uuidv7Timestamp extracts the millisecond Unix timestamp embedded in the
// first 48 bits of a UUIDv7.
func uuidv7Timestamp(s string) (time.Time, bool) {
	u, err := uuid.Parse(s)
	if err != nil || u.Version() != 7 {
		return time.Time{}, false
	}
	b := u[:]
	ms := binary.BigEndian.Uint64(append([]byte{0, 0}, b[:6]...))
	return time.UnixMilli(int64(ms)).UTC(), true
}
