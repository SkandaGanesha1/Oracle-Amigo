import type { SecretStore } from "./SecretStore.js";

export class MacKeychainStore implements SecretStore {
  readonly kind = "mac-keychain";

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
    return new Error("MAC_KEYCHAIN_STORE_NOT_IMPLEMENTED: implement macOS Keychain storage before selecting SECRET_STORE=mac-keychain");
  }
}
