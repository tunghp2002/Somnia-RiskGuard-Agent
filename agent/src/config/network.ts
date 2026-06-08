import dns from "node:dns";
import net from "node:net";

// Some hosts (e.g. this dev machine) advertise IPv6 (AAAA) records but have no
// working IPv6 route. Node's default Happy-Eyeballs (autoSelectFamily=true) then
// attempts the unreachable IPv6 address and hangs until ETIMEDOUT instead of
// falling back cleanly, which surfaces as "fetch failed" for outbound calls such
// as Telegram long-polling (api.telegram.org has both A and AAAA records).
//
// Forcing IPv4-first DNS ordering and disabling auto-select-family makes fetch
// connect to the working IPv4 address. IPv4 is reachable for every external
// service this agent talks to, so this is safe on normal dual-stack machines too.
dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamily(false);
