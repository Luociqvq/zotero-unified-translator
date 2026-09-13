export interface CredentialStore {
  get(reference: string): Promise<string | undefined>;
  set(reference: string, value: string): Promise<void>;
  delete(reference: string): Promise<void>;
}

export class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();

  async get(reference: string): Promise<string | undefined> {
    return this.values.get(reference);
  }

  async set(reference: string, value: string): Promise<void> {
    this.values.set(reference, value);
  }

  async delete(reference: string): Promise<void> {
    this.values.delete(reference);
  }
}

interface LoginEntry {
  username: string;
  password: string;
}

interface LoginManager {
  findLogins(
    hostname: string,
    formSubmitURL: string | null,
    httpRealm: string | null,
  ): LoginEntry[];
  addLoginAsync(login: unknown): Promise<unknown>;
  modifyLogin(oldLogin: unknown, newLogin: unknown): void;
  removeLogin(login: unknown): void;
}

const credentialHost = "chrome://zotero-unified-translator";

class ZoteroLoginCredentialStore implements CredentialStore {
  private readonly services: { logins: LoginManager };
  private readonly components: {
    classes: Record<string, { createInstance(interfaceType: unknown): { init(...args: unknown[]): void } }>;
    interfaces: Record<string, unknown>;
  };

  constructor(
    services: { logins: LoginManager },
    components: ZoteroLoginCredentialStore["components"],
  ) {
    this.services = services;
    this.components = components;
  }

  async get(reference: string): Promise<string | undefined> {
    const login = this.find(reference);
    return login?.password;
  }

  async set(reference: string, value: string): Promise<void> {
    const current = this.find(reference);
    const factory = this.components.classes["@mozilla.org/login-manager/loginInfo;1"];
    if (!factory) {
      throw new Error("Zotero login manager is unavailable");
    }
    const loginInfo = factory.createInstance(this.components.interfaces.nsILoginInfo);
    loginInfo.init(credentialHost, null, "ZUT credentials", reference, value, "", "");
    if (current) {
      this.services.logins.modifyLogin(current, loginInfo);
    } else {
      await this.services.logins.addLoginAsync(loginInfo);
    }
  }

  async delete(reference: string): Promise<void> {
    const current = this.find(reference);
    if (current) {
      this.services.logins.removeLogin(current);
    }
  }

  private find(reference: string): LoginEntry | undefined {
    return this.services.logins
      .findLogins(credentialHost, null, "ZUT credentials")
      .find((login) => login.username === reference);
  }
}

/**
 * The Zotero bootstrap layer should provide a Services.logins-backed adapter.
 * Secrets must never be written through ConfigStore/Zotero.Prefs.
 */
export function createCredentialStore(): CredentialStore {
  const host = globalThis as typeof globalThis & {
    Services?: { logins?: LoginManager };
    Components?: ZoteroLoginCredentialStore["components"];
  };
  if (host.Services?.logins && host.Components) {
    return new ZoteroLoginCredentialStore(host.Services as { logins: LoginManager }, host.Components);
  }
  throw new Error("Zotero 凭据存储不可用，无法安全保存密钥");
}
