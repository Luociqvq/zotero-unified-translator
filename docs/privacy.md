# Privacy and Credentials

Instant translation providers receive selected text. Full translation may send
the entire PDF to the configured backend and then to the backend's LLM
provider. Users should not upload confidential documents to a provider whose
retention policy they have not reviewed.

The plugin configuration stores references to credentials, not raw secrets.
The production Zotero adapter must use the host credential store
(Services.logins or an equivalent OS-backed mechanism). The backend stores LLM
credentials in environment variables or Docker secrets and never returns them
from the health endpoint.

Task files are stored below ZUT_DATA_DIR and are eligible for cleanup after
ZUT_ARTIFACT_TTL_DAYS. Logs must not contain request bodies, PDF contents, or
authorization headers.
