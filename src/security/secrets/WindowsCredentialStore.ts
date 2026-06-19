import type { SecretStore } from "./SecretStore.js";

export class WindowsCredentialStore implements SecretStore {
  readonly kind = "windows";

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  get(_name: string): string | null {
    throw this.notImplemented();
  }

  set(_name: string, _value: string): void {
    throw this.notImplemented();
  }

  delete(_name: string): void {
    throw this.notImplemented();
  }

  list(_prefix?: string): string[] {
    throw this.notImplemented();
  }

  clearProfile(_profileId: string): void {
    throw this.notImplemented();
  }

  private notImplemented(): Error {
    const message = "WINDOWS_CREDENTIAL_STORE_NOT_IMPLEMENTED: implement Windows Credential Manager or DPAPI-backed storage before selecting SECRET_STORE=windows";
    if (this.env.NODE_ENV === "production") return new Error(message);
    return new Error(message);
  }
}
