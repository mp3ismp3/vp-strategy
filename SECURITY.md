# Security Policy

## Supported versions

Security fixes are applied to the latest commit on `main`. Older commits,
forks, preview deployments, and locally modified installations are not
supported by the maintainers.

## Reporting a vulnerability

Do not open a public issue for suspected vulnerabilities or include secrets,
personal data, provider payloads, or exploit details in logs or screenshots.
Use GitHub's private vulnerability reporting feature for this repository. If
that feature is unavailable, contact a maintainer privately through the
repository owner's verified contact channel.

Include the affected revision, route or component, reproduction conditions,
impact, and a minimal proof of concept. Use test credentials only. The project
does not operate a bug bounty and cannot promise a disclosure deadline, but it
will acknowledge valid reports and coordinate disclosure when practical.

## Deployment responsibility

Operators must protect all secrets, apply the current Supabase migrations,
configure a trusted reverse proxy, keep payment checkout disabled until the
documented provider validation is complete, and review logs for personal or
billing data. See `docs/API.md` and `services/frontend/README.md`.
