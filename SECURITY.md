# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.2.x   | Yes       |
| 0.1.x   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability in Abbai Flow, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email: **security@sachshaus.net**

You should receive a response within 48 hours. We'll work with you to understand the issue and coordinate a fix before any public disclosure.

## Security Considerations

- **PIN authentication** is designed for family convenience (kids), not enterprise security. PINs are stored locally and are not transmitted over the network.
- **Your server owns app data** — family records, photos, and integration settings are stored in the configured data directory.
- **Connected services are optional** — when configured, calendar, weather, meal, music, and reminder providers may receive requests from the app server.
- **Integration secrets** are stored server-side in `/data/integration-settings.json` with owner-only permissions. Runtime configuration and settings responses omit secret values.
- **State-changing requests** use a same-origin check, with explicitly configured extra origins available for native shells and reverse proxies.

## Best Practices

- Keep the app server and connected services updated.
- Use HTTPS when exposing the app outside your local network.
- Restrict network access to the app server to the devices and services that need it.
