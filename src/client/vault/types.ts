export type SecretMap = Record<string, string>

/**
 * Represents a client for interacting with a vault.
 */
export interface VaultClient {
  /**
   * Retrieves secrets from the vault based on the provided key names.
   * @param keyNames - An array of key names representing the secrets to retrieve.
   * @returns A promise that resolves to a map of secrets.
   */
  getSecrets(keyNames: string[]): Promise<SecretMap>
}
