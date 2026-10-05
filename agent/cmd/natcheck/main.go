// Command natcheck reports whether this network's NAT keeps the same public
// address:port for one local socket whatever the destination
// ("endpoint-independent mapping", hole-punch friendly) or changes it per
// destination ("endpoint-dependent", i.e. symmetric: a direct WebRTC path
// will usually fail and TURN is needed). It sends a STUN binding request from
// a single UDP socket to several STUN servers on different IPs and compares
// what each one saw. Exists because stuntman-client isn't packaged in Debian
// trixie, and the old `stun` client implements the obsolete RFC 3489 tests.
package main

import (
	"flag"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"github.com/pion/stun/v4"
)

func main() {
	servers := flag.String("servers", "stun.l.google.com:19302,stun.cloudflare.com:3478,stun.nextcloud.com:443",
		"comma-separated STUN servers, ideally on different IP addresses")
	network := flag.String("net", "udp4", "udp4 or udp6")
	flag.Parse()

	conn, err := net.ListenUDP(*network, nil)
	if err != nil {
		fmt.Println("listen:", err)
		os.Exit(1)
	}
	defer conn.Close()
	fmt.Println("local socket:", conn.LocalAddr())

	mapped := map[string]bool{}
	answered := 0
	for _, server := range strings.Split(*servers, ",") {
		server = strings.TrimSpace(server)
		addr, err := net.ResolveUDPAddr(*network, server)
		if err != nil {
			fmt.Printf("%-28s resolve failed: %v\n", server, err)
			continue
		}
		seen, err := bind(conn, addr)
		if err != nil {
			fmt.Printf("%-28s %-22s no answer: %v\n", server, addr, err)
			continue
		}
		answered++
		mapped[seen] = true
		fmt.Printf("%-28s %-22s sees us as %s\n", server, addr, seen)
	}

	switch {
	case answered < 2:
		fmt.Println("result: inconclusive (need answers from at least two servers)")
	case len(mapped) == 1:
		fmt.Println("result: endpoint-independent mapping (same public address:port for every server): hole punching should work")
	default:
		fmt.Println("result: endpoint-dependent mapping (public address:port changes per server, i.e. symmetric NAT): expect to need TURN")
	}
}

func bind(conn *net.UDPConn, server *net.UDPAddr) (string, error) {
	req := stun.MustBuild(stun.TransactionID, stun.BindingRequest)
	buf := make([]byte, 1500)
	for attempt := 0; attempt < 3; attempt++ {
		if _, err := conn.WriteToUDP(req.Raw, server); err != nil {
			return "", err
		}
		_ = conn.SetReadDeadline(time.Now().Add(time.Second))
		for {
			n, from, err := conn.ReadFromUDP(buf)
			if err != nil {
				break // timed out: resend
			}
			if !from.IP.Equal(server.IP) {
				continue
			}
			res := &stun.Message{Raw: append([]byte(nil), buf[:n]...)}
			if err := res.Decode(); err != nil || res.TransactionID != req.TransactionID {
				continue
			}
			var xor stun.XORMappedAddress
			if err := xor.GetFrom(res); err != nil {
				return "", err
			}
			return xor.String(), nil
		}
	}
	return "", fmt.Errorf("timed out")
}
