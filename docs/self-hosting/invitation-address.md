# Where participants connect (the invitation address)

> Part of the [self-hosting guides](README.md). The variables are in
> [configuration → invitation address](configuration.md#invitation-address).

Participants' phones open the address on the QR code / join link. The host
picks it in the console lobby (**Invitation address**); this table says what to
expect in each setup and what to configure so the right address is offered.

| Setup | What the console offers | Configure |
| --- | --- | --- |
| **Docker Desktop on a Mac or PC** (the usual local setup) | Nothing detected — the VM hides the computer's network; the console explains where to read the IP (System Settings / Settings › Network) | `HOST_LAN_IPS=<your IP>` in `.env`, or `-e HOST_LAN_IPS=<your IP>` on `docker run` — or just type it in the console |
| **Server with a domain** (reverse proxy, TLS) | The public address first | `APP_PUBLIC_URL=https://quiz.example.org` |
| **Linux server on the LAN**, no domain (compose or standalone) | The machine's LAN IPs, detected (`network_mode: host` or the standalone image see the host's interfaces) | nothing — or `HOST_LAN_IPS` to pin one |
| **Docker on Linux, bridge network** | Nothing detected (the container only sees `172.x`) | `HOST_LAN_IPS=192.168.1.20` |
| **Dev stack** (`docker compose up`, Vite on :15173) | As above, with the port of the page you are on | `HOST_LAN_IPS` in `.env` |
| **Console opened on `localhost`** | "This page" is useless for phones: the console opens the help by itself and pre-selects a LAN address when one is known | — |

Behind a reverse proxy nothing needs configuring: "this page" is the address the
browser resolved through the proxy (scheme and host included), and it is what
the console proposes. A remembered address or a LAN candidate is only applied
by itself when the console runs on `localhost`. In every case the host can
type any address (`Other address…`); it is kept on the session (console, projection and share link agree), frozen once the
session starts, and remembered by the browser for the next one. Phones must be
on the same network as the machine, and its firewall must let the port through.
Over HTTPS, an `http://` LAN address triggers a warning on phones: a public
address with a certificate is the clean way.
