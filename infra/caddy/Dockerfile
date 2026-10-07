# Caddy with the layer4 module, so port 443 can be shared between HTTPS and LiveKit's
# TURN/TLS (routed by SNI). Both base images are multi-arch (arm64 included).
FROM caddy:2.11-builder AS builder
RUN xcaddy build --with github.com/mholt/caddy-l4@v0.1.2

FROM caddy:2.11
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
